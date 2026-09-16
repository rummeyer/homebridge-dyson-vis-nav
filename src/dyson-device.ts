// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import type { API } from 'homebridge';
import { DysonDevice } from './dyson-device-base.js';
import { DYSON_DEVICE_TYPES_360 } from './dyson-device-360.js';
import { Config } from './config-types.js';
import { AnsiLogger } from './logger.js';
import { MS } from './utils.js';
import { DeviceConfigMqtt } from './dyson-mqtt-client-live.js';
import { logError } from './log-error.js';
import NodePersist from 'node-persist';
import { DysonCloudAPIDevice } from './dyson-cloud-api-device.js';

// List of constructors for Dyson devices
const DYSON_DEVICE_TYPES = [
    ...DYSON_DEVICE_TYPES_360
] as const;

// Delay before falling back to using cached status (if any)
// (kept short so a device that is offline at startup does not stall Homebridge)
export const MQTT_CACHE_FALLBACK_DELAY = 60 * MS;

// Dyson device factory
export async function createDysonDevice(
    log:        AnsiLogger,
    config:     Config,
    hbApi:      API,
    persist:    NodePersist.LocalStorage,
    device:     DeviceConfigMqtt,
    api?:       DysonCloudAPIDevice
): Promise<DysonDevice> {
    // Select the appropriate class for this device
    const { rootTopic } = device;
    const deviceClass = DYSON_DEVICE_TYPES.find((device) => device.model.type === rootTopic);
    if (!deviceClass) throw new Error(`Unknown Dyson device type: ${rootTopic}`);

    // Create the MQTT client and wait for it to finish initialising
    const mqtt = new deviceClass.mqttConstructor(log, config, persist, device);
    mqtt.on('error', err => { logError(log, 'MQTT Event', err); });
    await mqtt.waitUntilInitialised(MQTT_CACHE_FALLBACK_DELAY);

    // Create the Dyson device itself
    return new deviceClass(log, config, hbApi, device, mqtt, api);
}

// Test whether a specific model is supported
export function isSupportedModel(rootTopic: string): boolean {
    return DYSON_DEVICE_TYPES.some((device) => device.model.type === rootTopic);
}