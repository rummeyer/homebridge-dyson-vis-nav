// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import type {
    API,
    DynamicPlatformPlugin,
    Logging,
    PlatformAccessory,
    PlatformConfig
} from 'homebridge';
import NodePersist from 'node-persist';
import Path from 'path';
import { checkDependencyVersions } from './check-versions.js';
import { Config } from './config-types.js';
import { checkConfiguration } from './config-check.js';
import { FilterLogger } from './logger-filter.js';
import { adaptLogger } from './logger.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { createDysonDevice } from './dyson-device.js';
import { DysonDevice } from './dyson-device-base.js';
import { formatList, plural } from './utils.js';
import { PrefixLogger } from './logger-prefix.js';
import { DeviceConfigMqttWithApi, DysonCloudRemote } from './dyson-cloud.js';
import { logError } from './log-error.js';

// A Dyson 360 Vis Nav platform
export class PlatformDyson implements DynamicPlatformPlugin {

    // Strongly typed configuration
    readonly config: Config & PlatformConfig;

    // Filtered logger, used in place of the one supplied by Homebridge
    readonly log: FilterLogger;

    // Persistent storage
    readonly persist: NodePersist.LocalStorage;

    // Active devices
    devices: DysonDevice[] = [];

    // Constructor
    constructor(log: Logging, config: PlatformConfig, readonly api: API) {
        this.log = new FilterLogger(adaptLogger(log));
        this.log.info(`Initialising platform ${PLUGIN_NAME}`);
        this.config = config as Config & PlatformConfig;

        // Check the dependencies
        checkDependencyVersions(this.log, api);

        // Create storage for this plugin (initialised in onDidFinishLaunching)
        const persistDir = Path.join(api.user.storagePath(), PLUGIN_NAME, 'persist');
        this.persist = NodePersist.create({ dir: persistDir });

        // Homebridge only constructs the Matter manager once it has finished
        // launching, so registration cannot happen in this constructor.
        api.on('didFinishLaunching', () => { void this.onDidFinishLaunching(); });
        api.on('shutdown',           () => { void this.onShutdown(); });
    }

    // Restore a cached HAP accessory.
    //
    // This plugin publishes the robot vacuum as a Matter accessory rather than
    // a HAP one, so there is nothing to restore. Homebridge still requires the
    // method to exist on a dynamic platform.
    configureAccessory(accessory: PlatformAccessory): void {
        this.log.debug(`Ignoring cached HAP accessory: ${accessory.displayName}`);
    }

    // Create and register the devices once Homebridge has finished launching
    async onDidFinishLaunching(): Promise<void> {
        try {
            this.log.info(`Starting ${PLUGIN_NAME}`);

            // A robot vacuum can only be represented as a Matter device, so
            // there is nothing this plugin can do without Matter enabled.
            if (!this.api.isMatterEnabled()) {
                this.log.error('Matter is not enabled for this Homebridge bridge.');
                this.log.error('The Dyson 360 Vis Nav is exposed as a Matter robot vacuum cleaner,'
                             + ' which has no HomeKit (HAP) equivalent, so this plugin requires Matter.');
                this.log.error('Enable Matter in the Homebridge settings, then restart Homebridge.');
                return;
            }

            // Initialise persistent storage
            await this.persist.init();

            // Check the configuration
            checkConfiguration(this.log, this.config);
            this.log.configure(this.config.debugFeatures);

            // Convert the configuration to usable device details
            let mappedDevices: DeviceConfigMqttWithApi[];
            switch (this.config.provisioningMethod) {
            case 'Remote Account': {
                // Obtain list of details from the MyDyson account
                const api = new DysonCloudRemote(this.log, this.config, this.persist);
                mappedDevices = await api.getDevices();
                break;
            }
            case 'Mock Devices':
                // Configuration is already in the required format
                mappedDevices = this.config.devices;
                break;
            }

            // Create and register a Matter accessory for each Dyson device
            await Promise.all(mappedDevices.map(async deviceConfig => this.createDevice(deviceConfig)));
            this.log.info(`Registered ${this.devicesDescription}`);

            // Configure and start polling the devices
            await Promise.all(this.devices.map(async device => {
                try {
                    await device.start();
                } catch (err) {
                    logError(device.log, 'Starting device', err);
                }
            }));
            this.log.info(`Configured ${this.devicesDescription}`);
        } catch (err) {
            logError(this.log, 'Starting platform', err);
        }
    }

    // Create and register a single device
    async createDevice(deviceConfig: DeviceConfigMqttWithApi): Promise<void> {
        const { serialNumber, name: deviceName } = deviceConfig;
        const deviceLog = new PrefixLogger(this.log, deviceName);

        try {
            // Apply the device filters
            if (!this.validateDevice(serialNumber)) {
                const lists = (['blackList', 'whiteList'] as const)
                    .filter(list => this.config[list].length);
                deviceLog.info(`Device disabled via ${formatList(lists)}`);
                return;
            }

            // Create the device instance
            const deviceApi = 'api' in deviceConfig ? deviceConfig.api : undefined;
            const device = await createDysonDevice(
                deviceLog, this.config, this.api, this.persist, deviceConfig, deviceApi);

            // Register the Matter accessory with Homebridge
            const accessory = device.getAccessory();
            await accessory.register(PLUGIN_NAME, PLATFORM_NAME);
            this.devices.push(device);
        } catch (err) {
            logError(deviceLog, 'Creating device', err);
        }
    }

    // Check a device serial number against the configured filters
    validateDevice(serialNumber: string): boolean {
        const { whiteList, blackList } = this.config;
        if (whiteList.length)   return whiteList.includes(serialNumber);
        if (blackList.length)   return !blackList.includes(serialNumber);
        return true;
    }

    // Cleanup resources when Homebridge is shutting down
    async onShutdown(): Promise<void> {
        this.log.info(`Shutting down ${PLUGIN_NAME}`);

        // Stop polling the devices
        await Promise.all(this.devices.map(async device => {
            try {
                await device.stop();
            } catch (err) {
                logError(device.log, 'Stopping device', err);
            }
        }));
        this.log.info(`Stopped ${this.devicesDescription}`);
    }

    // Description of the registered device(s)
    get devicesDescription(): string {
        return plural(this.devices.length, 'Dyson device');
    }
}
