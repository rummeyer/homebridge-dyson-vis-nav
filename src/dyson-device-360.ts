// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import { BasicInformation } from './matter-clusters.js';
import { RvcCleanMode360 } from './matter-360-modes.js';
import {
    Dyson360CleaningStrategy,
    Dyson360TimelineEvent
} from './dyson-360-types.js';
import {
    DysonDevice360Base,
    Dyson360PowerLevelMap,
    Dyson360CleanSummaryResult
} from './dyson-device-360-base.js';
import { DysonDevice360ZonesMixin } from './dyson-device-360-zones.js';
import { dysonRenderMap360VisNav } from './dyson-device-360-map.js';
import { Dyson360PersistentMapResponse } from './dyson-360-cloud-types.js';

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

    // Retrieve details of a completed clean
    override async getCompletedClean(cleanId: string): Promise<Dyson360CleanSummaryResult> {
        const { logMapStyle } = this.config;
        if (!this.api || logMapStyle === 'Off') return 'Unavailable';

        // Retrieve details of the specified (or most recent) clean
        const history = await this.api.getCleanMaps360();
        const clean = history.find(entry => entry.cleanId === cleanId);
        if (!clean)                             return 'Not found';
        const interim = clean.cleanTimeline.at(-1)?.eventName !== Dyson360TimelineEvent.RunEnded;
        if (interim)                            return 'Not ready';
        let persistentMap: Dyson360PersistentMapResponse | undefined;
        if (clean.persistentMap) persistentMap = await this.api.getPersistentMap360(clean.persistentMap.id);

        // Render the map
        return dysonRenderMap360VisNav(this.log, logMapStyle, clean, persistentMap);
    }
}

// List of constructors for the supported Dyson robot vacuum devices
export const DYSON_DEVICE_TYPES_360 = [
    DysonDevice360VisNav
] as const;
