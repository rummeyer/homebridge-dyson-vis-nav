// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import { BasicInformation } from './matter-clusters.js';
import { RvcCleanMode360 } from './matter-360-modes.js';
import {
    Dyson360CleaningStrategy,
    Dyson360TimelineEvent,
    Dyson360ZoneCleanStatus
} from './dyson-360-types.js';
import {
    DysonDevice360Base,
    Dyson360PowerLevelMap,
    Dyson360CleanSummaryResult
} from './dyson-device-360-base.js';
import { DysonDevice360ZonesMixin } from './dyson-device-360-zones.js';
import { dysonRenderMap360VisNav } from './dyson-device-360-map.js';
import { Dyson360PersistentMapResponse } from './dyson-360-cloud-types.js';
import { listCleanRecords } from './dyson-clean-history.js';
import { logError } from './log-error.js';

// A Dyson 360 Vis Nav device
export class DysonDevice360VisNav extends DysonDevice360ZonesMixin(DysonDevice360Base) {
    static override readonly model = { type: '277', number: 'RB03', name: '360 Vis Nav' };

    override getBatteryPartNumber = () => '967864-02';

    override getProductAppearance = () => ({
        finish:         BasicInformation.ProductFinish.Satin,
        primaryColor:   BasicInformation.Color.Blue
    });

    override getPowerLevelMaps = (): Dyson360PowerLevelMap[] => [
        [Dyson360CleaningStrategy.Auto,     RvcCleanMode360.Auto,       'Auto'],
        [Dyson360CleaningStrategy.Quick,    RvcCleanMode360.Quick,      'Quick'],
        [Dyson360CleaningStrategy.Quiet,    RvcCleanMode360.Quiet,      'Quiet'],
        [Dyson360CleaningStrategy.Boost,    RvcCleanMode360.MaxBoost,   'Boost']
    ];

    override setPowerLevel = (powerLevel: Dyson360CleaningStrategy) => this.mqtt.commandSetCleaningStrategy(powerLevel);
    override getPowerLevel = () => this.mqtt.status.defaultCleaningStrategy;
    override getCurrentPowerLevel = () => this.mqtt.status.currentCleaningStrategy;

    // Start the device after the accessory has been registered
    override async start(): Promise<void> {
        await super.start();
        void this.seedCleanHistory();
    }

    // Store the most recent clean if none is stored yet, so the settings page
    // has a map to show straight after installation instead of after the next clean
    async seedCleanHistory(): Promise<void> {
        try {
            if (!this.api) return;
            const stored = await listCleanRecords(this.hbApi.user.storagePath());
            if (stored.some(record => record.serialNumber === this.serialNumber)) return;
            const finished = (await this.api.getCleanMaps360())
                .filter(clean => clean.cleanTimeline.at(-1)?.eventName === Dyson360TimelineEvent.RunEnded)
                .map(clean => ({ cleanId: clean.cleanId, time: clean.cleanTimeline.at(-1)?.time ?? '' }))
                .sort((a, b) => b.time.localeCompare(a.time));
            const latest = finished[0];
            if (!latest) return;
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

    // Retrieve details of a completed clean
    override async getCompletedClean(cleanId: string): Promise<Dyson360CleanSummaryResult> {
        if (!this.api) return 'Unavailable';

        // Retrieve details of the specified (or most recent) clean
        const history = await this.api.getCleanMaps360();
        const clean = history.find(entry => entry.cleanId === cleanId);
        if (!clean)                             return 'Not found';
        const interim = clean.cleanTimeline.at(-1)?.eventName !== Dyson360TimelineEvent.RunEnded;
        if (interim)                            return 'Not ready';
        let persistentMap: Dyson360PersistentMapResponse | undefined;
        if (clean.persistentMap) persistentMap = await this.api.getPersistentMap360(clean.persistentMap.id);

        // Render the map for the settings page, which always shows it monospaced,
        // and again for the log if that uses a different style
        const summary = dysonRenderMap360VisNav(this.log, 'Monospaced', clean, persistentMap);
        const { logMapStyle } = this.config;
        const logSummary = logMapStyle === 'Monospaced' ? summary
                         : logMapStyle === 'Off'        ? { ...summary, mapLines: undefined }
                         : dysonRenderMap360VisNav(this.log, logMapStyle, clean, persistentMap);

        // Names of the zones cleaned, in the order first entered. The timeline
        // alone would also list rooms the robot only drove through.
        const zoneNames = new Map(persistentMap?.zonesDefinition.zones.map(zone => [zone.id, zone.name]));
        const cleaned = new Set((clean.zoneStatus ?? [])
            .filter(({ cleanStatus }) => cleanStatus === Dyson360ZoneCleanStatus.Complete)
            .map(({ zoneId }) => zoneId));
        const entered = clean.cleanTimeline.flatMap(({ zone }) => zone === null ? [] : [zone]);
        const zones = [...new Set([...entered, ...cleaned])]
            .filter(zone => cleaned.has(zone))
            .flatMap(zone => zoneNames.get(zone) ?? []);

        return {
            ...logSummary,
            history: {
                cleanId,
                started:    clean.cleanTimeline[0]?.time,
                finished:   clean.cleanTimeline.at(-1)?.time,
                zones,
                mapLines:   summary.mapLines ?? [],
                raw:        { clean, persistentMap }
            }
        };
    }
}

// List of constructors for the supported Dyson robot vacuum devices
export const DYSON_DEVICE_TYPES_360 = [
    DysonDevice360VisNav
] as const;
