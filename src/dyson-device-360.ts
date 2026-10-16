// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import { BasicInformation } from './matter-clusters.js';
import { RvcCleanMode360 } from './matter-360-modes.js';
import {
    Dyson360CleaningMode,
    Dyson360VacuumMode,
    Dyson360TimelineEvent,
    Dyson360ZoneCleanStatus
} from './dyson-360-types.js';
import {
    DysonDevice360Base,
    Dyson360PowerLevelMap,
    Dyson360CleanSummaryResult
} from './dyson-device-360-base.js';
import { Dyson360CleaningStatus, DysonDevice360ZonesMixin } from './dyson-device-360-zones.js';
import { dysonRenderMap360VisNav } from './dyson-device-360-map.js';
import {
    Dyson360PersistentMapMetadataResponseV1,
    Dyson360PersistentMapResponseV1
} from './dyson-360-cloud-types.js';
import { DysonMqttStatus360 } from './dyson-mqtt-360.js';
import { DysonMqttStatus } from './dyson-mqtt.js';
import { listCleanRecords } from './dyson-clean-history.js';
import { logError } from './log-error.js';
import { assertIsDefined, tryListener } from './utils.js';

// A Dyson 360 Vis Nav device
export class DysonDevice360VisNav extends DysonDevice360ZonesMixin(DysonDevice360Base) {
    static override readonly model = { type: '277', number: 'RB03', name: '360 Vis Nav' };

    override getBatteryPartNumber = () => '967864-02';

    override getProductAppearance = () => ({
        finish:         BasicInformation.ProductFinish.Satin,
        primaryColor:   BasicInformation.Color.Blue
    });

    override getPowerLevelMaps = (): Dyson360PowerLevelMap[] => [
        [Dyson360VacuumMode.Auto,     RvcCleanMode360.Auto,       'Auto'],
        [Dyson360VacuumMode.Quick,    RvcCleanMode360.Quick,      'Quick'],
        [Dyson360VacuumMode.Quiet,    RvcCleanMode360.Quiet,      'Quiet'],
        [Dyson360VacuumMode.Boost,    RvcCleanMode360.MaxBoost,   'Boost']
    ];

    override setPowerLevel = (powerLevel: Dyson360VacuumMode) => this.mqtt.commandSetCleaningStrategy(powerLevel);
    override getDefaultPowerLevel = () => this.mqtt.status.defaultCleaningStrategy;
    override getCurrentPowerLevel = () => this.mqtt.status.currentCleaningStrategy;

    // The zones a zone clean was asked to clean. At its end the robot reports
    // every zone as complete, asked for or not, and the cloud keeps no record
    // of the selection, so it is noted from the status while the clean runs.
    selectedZones?: { cleanId: string, zones: Set<string> };
    readonly selectedZonesListener = tryListener(this.mqtt, () => {
        const { cleanId, cleaningProgramme } = this.mqtt.status;
        if (!cleaningProgramme || !('unorderedZones' in cleaningProgramme)) return;
        const zones = new Set([
            ...(cleaningProgramme.orderedZones ?? []),
            ...cleaningProgramme.unorderedZones
        ]);
        if (cleanId && zones.size) this.selectedZones = { cleanId, zones };
    });

    // Start the device after the accessory has been registered
    override async start(): Promise<void> {
        this.mqtt.on('status', this.selectedZonesListener);
        this.selectedZonesListener();   // (a clean may be running already)
        await super.start();
        void this.seedCleanHistory();
    }

    // Stop the device when Homebridge is shutting down
    override async stop(): Promise<void> {
        this.mqtt.off('status', this.selectedZonesListener);
        await super.stop();
    }

    // Store the most recent clean if it is not stored yet, so the settings page
    // has a map to show straight after installation instead of after the next
    // clean, and a clean whose retrieval failed is picked up on a restart
    async seedCleanHistory(): Promise<void> {
        try {
            if (!this.api) return;
            const finished = (await this.api.getCleanMaps360V1())
                .filter(clean => clean.cleanTimeline.at(-1)?.eventName === Dyson360TimelineEvent.RunEnded)
                .map(clean => ({ cleanId: clean.cleanId, time: clean.cleanTimeline.at(-1)?.time ?? '' }))
                .sort((a, b) => b.time.localeCompare(a.time));
            const latest = finished[0];
            if (!latest) return;
            const stored = await listCleanRecords(this.hbApi.user.storagePath());
            if (stored.some(record => record.serialNumber === this.serialNumber
                                   && record.cleanId      === latest.cleanId)) return;
            const result = await this.getCompletedClean(latest.cleanId);
            if (typeof result === 'string') return;
            const { status } = this.mqtt;
            const cleanDuration = status.cleanId === latest.cleanId ? status.cleanDuration : undefined;
            await this.saveCleanHistory(result, cleanDuration);
            this.log.info(`Stored the most recent clean (${latest.time}) for the settings page`);
        } catch (err) {
            logError(this.log, 'Storing the most recent clean', err);
        }
    }

    // Update cluster attributes when the MQTT status is updated
    override async updateClusterAttributes(
        status: DysonMqttStatus<DysonMqttStatus360>
    ): Promise<void> {
        await super.updateClusterAttributes(status);

        // Update the Service Area cluster when the zone status changes
        const { currentCleaningMode: cleaningMode, cleaningProgramme, state, zoneStatus } = status;
        let cleaningStatus: Dyson360CleaningStatus | undefined;
        if (state.startsWith('FULL_CLEAN_')) {
            assertIsDefined(cleaningMode);
            if (cleaningMode === Dyson360CleaningMode.Global) {
                // No map or zone for global cleans
                cleaningStatus = { cleaningMode };
            } else if (zoneStatus) {
                // Live zone status available
                const { persistentMapId: mapId, zonesDefinitionVersion: mapVersion } = status;
                // (persistent map might be cleared first at the end of a clean)
                if (mapId) cleaningStatus = { cleaningMode, mapId, mapVersion, zoneStatus };
            } else if (cleaningProgramme && 'orderedZones' in cleaningProgramme) {
                // No live zone status, so synthesise from cleaning programme
                const zones = new Set([
                    ...cleaningProgramme.unorderedZones,
                    ...(cleaningProgramme.orderedZones ?? [])
                ]);
                cleaningStatus = {
                    cleaningMode,
                    mapId:      cleaningProgramme.persistentMapId,
                    mapVersion: cleaningProgramme.zonesDefinitionLastUpdatedDate ?? undefined,
                    zoneStatus: [...zones].map(zoneId => ({ zoneId, cleanStatus: Dyson360ZoneCleanStatus.Pending }))
                };
            }
        }
        await this.updateZoneStatus(cleaningStatus);
    }

    // Retrieve the latest persistent map metadata
    override getPersistentMapMetadata(): Promise<Dyson360PersistentMapMetadataResponseV1> | undefined {
        return this.api?.getPersistentMapMetadata360V1();
    }

    // Retrieve details of a completed clean
    override async getCompletedClean(cleanId: string): Promise<Dyson360CleanSummaryResult> {
        if (!this.api) return 'Unavailable';

        // Retrieve details of the specified (or most recent) clean
        const history = await this.api.getCleanMaps360V1();
        const clean = history.find(entry => entry.cleanId === cleanId);
        if (!clean)                             return 'Not found';
        const interim = clean.cleanTimeline.at(-1)?.eventName !== Dyson360TimelineEvent.RunEnded;
        if (interim)                            return 'Not ready';
        let persistentMap: Dyson360PersistentMapResponseV1 | undefined;
        if (clean.persistentMap) persistentMap = await this.api.getPersistentMap360V1(clean.persistentMap.id);

        // Render the map for the log; the area and charges come with it, so
        // it is rendered even when the map itself is not logged
        const { logMapStyle } = this.config;
        const summary = dysonRenderMap360VisNav(this.log, logMapStyle === 'Off' ? 'Monospaced' : logMapStyle, clean, persistentMap);
        if (logMapStyle === 'Off') delete summary.mapLines;

        // Names of the zones cleaned, in the order first entered. The timeline
        // alone would also list rooms the robot only drove through, and the
        // zone status alone every room of a zone clean.
        const zoneNames = new Map(persistentMap?.zonesDefinition.zones.map(zone => [zone.id, zone.name]));
        const selected = this.selectedZones?.cleanId === cleanId ? this.selectedZones.zones : undefined;
        const cleaned = new Set((clean.zoneStatus ?? [])
            .filter(({ cleanStatus }) => cleanStatus === Dyson360ZoneCleanStatus.Complete)
            .map(({ zoneId }) => zoneId)
            .filter(zoneId => selected?.has(zoneId) ?? true));
        const entered = clean.cleanTimeline.flatMap(({ zone }) => zone === null ? [] : [zone]);
        const zones = [...new Set([...entered, ...cleaned])]
            .filter(zone => cleaned.has(zone))
            .flatMap(zone => zoneNames.get(zone) ?? []);

        return {
            ...summary,
            history: {
                cleanId,
                started:    clean.cleanTimeline[0]?.time,
                finished:   clean.cleanTimeline.at(-1)?.time,
                zones,
                raw:        { clean, persistentMap }
            }
        };
    }
}

// List of constructors for the supported Dyson robot vacuum devices
export const DYSON_DEVICE_TYPES_360 = [
    DysonDevice360VisNav
] as const;
