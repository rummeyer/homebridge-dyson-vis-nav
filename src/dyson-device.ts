// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import type { API } from 'homebridge';
import { DysonDevice, DysonDeviceModel } from './dyson-device-base.js';
import { DYSON_DEVICE_TYPES_360 } from './dyson-device-360.js';
import { Config } from './config-types.js';
import { AnsiLogger } from './logger.js';
import { MS, formatList, plural } from './utils.js';
import { logError } from './log-error.js';
import NodePersist from 'node-persist';
import { DeviceConfigMqttWithApi } from './dyson-cloud.js';

// List of constructors for Dyson devices
const DYSON_DEVICE_TYPES = [
    ...DYSON_DEVICE_TYPES_360
] as const;
type DysonDeviceType = typeof DYSON_DEVICE_TYPES[number];

// Delay before falling back to using cached status (if any)
// (kept short so a device that is offline at startup does not stall Homebridge)
export const MQTT_CACHE_FALLBACK_DELAY = 60 * MS;

// Dyson device factory
export async function createDysonDevice(
    log:        AnsiLogger,
    config:     Config,
    hbApi:      API,
    persist:    NodePersist.LocalStorage,
    device:     DeviceConfigMqttWithApi
): Promise<DysonDevice> {
    // Select the appropriate class for this device
    const deviceClass = selectDeviceClass(log, device);

    // Create the MQTT client and wait for it to finish initialising
    const mqtt = new deviceClass.mqttConstructor(log, config, persist, device);
    mqtt.on('error', err => { logError(log, 'MQTT Event', err); });
    await mqtt.waitUntilInitialised(MQTT_CACHE_FALLBACK_DELAY);

    // Create the Dyson device itself
    return new deviceClass(log, config, hbApi, device, mqtt, device.api);
}

// Test whether a specific model is supported
export function isSupportedModel(rootTopic: string): boolean {
    return DYSON_DEVICE_TYPES.some((device) => device.model.type === rootTopic);
}

// Select the most appropriate device type
function selectDeviceClass(log: AnsiLogger, device: DeviceConfigMqttWithApi): DysonDeviceType {
    // Find all classes that support this root topic
    const { rootTopic, variant } = device;
    let description = `MQTT root topic ${rootTopic}`;
    const allCandidates = DYSON_DEVICE_TYPES.filter(({ model }) => model.type === rootTopic);
    if (!allCandidates.length) throw new Error(`Unsupported ${description}`);

    // If a variant was specified then use it to refine the selection
    let candidates = allCandidates;
    if (variant !== undefined) {
        // Select the subset that match the product variant, if supplied
        description += ` variant ${variant}`;
        const getVariants = (model: DysonDeviceModel): string[] | undefined => model.variants;
        const getVariantMatches = (withoutVariant = false): DysonDeviceType[] =>
            allCandidates.filter(candidate => getVariants(candidate.model)?.includes(variant) ?? withoutVariant);
        candidates = getVariantMatches(false);
        if (!candidates.length) candidates = getVariantMatches(true);
    } else {
        description += ' (no variant)';
    }

    // Use the first candidate (if there are multiples)
    if (!candidates[0]) throw new Error(`Unsupported ${description}`);
    if (1 < candidates.length) {
        const names = candidates.map(({ model }) => `${model.name} (${model.number})`);
        log.warn(`Multiple implementations found for ${description}; using ${names[0]}`);
        log.warn(`${plural(names.length - 1, 'Alternative implementation')}: ${formatList(names.slice(1))}`);
    }
    return candidates[0];
}

