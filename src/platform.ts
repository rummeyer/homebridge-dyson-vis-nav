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
import { plural } from './utils.js';
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

    // HAP accessories restored from the Homebridge cache
    readonly cachedAccessories: PlatformAccessory[] = [];

    // Devices that could not be created, which suppresses cache tidying
    deviceFailures = 0;

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
    // Homebridge calls this before it has finished launching, so the accessories
    // are only collected here. Whether any of them is adopted depends on how the
    // robot is published, which is not decided until then.
    configureAccessory(accessory: PlatformAccessory): void {
        this.log.debug(`Restoring cached HAP accessory: ${accessory.displayName}`);
        this.cachedAccessories.push(accessory);
    }

    // Create and register the devices once Homebridge has finished launching
    async onDidFinishLaunching(): Promise<void> {
        try {
            this.log.info(`Starting ${PLUGIN_NAME}`);

            // A robot vacuum only exists as a device type in Matter. Without it
            // the robot is still published, as the switch, battery and problem
            // sensor that HomeKit can represent, but the cleaning modes, zones
            // and pause/resume controls have nowhere to go.
            if (!this.api.isMatterEnabled()) {
                this.log.warn('Matter is not enabled for this Homebridge bridge.');
                this.log.warn('A robot vacuum has no HomeKit (HAP) equivalent, so each robot is exposed as a switch'
                            + ' that starts a clean and sends it back to its dock, plus its battery and a problem sensor.');
                this.log.warn('Enable Matter in the Homebridge settings, then restart Homebridge,'
                            + ' to expose it as a full robot vacuum cleaner instead.');
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

            // Create and register an accessory for each Dyson device
            await Promise.all(mappedDevices.map(async deviceConfig => this.createDevice(deviceConfig)));
            this.log.info(`Registered ${this.devicesDescription}`);

            // Remove any cached HAP accessories that are no longer published
            this.removeStaleAccessories();

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
            // Apply the allow list
            if (!this.validateDevice(serialNumber)) {
                deviceLog.info('Device not in whiteList');
                return;
            }

            // Create the device instance
            const deviceApi = 'api' in deviceConfig ? deviceConfig.api : undefined;
            const device = await createDysonDevice(
                deviceLog, this.config, this.api, this.persist, deviceConfig, deviceApi);

            // Register the accessory with Homebridge
            const accessory = device.getAccessory();
            await accessory.register(PLUGIN_NAME, PLATFORM_NAME, this.cachedAccessories);
            this.devices.push(device);
        } catch (err) {
            ++this.deviceFailures;
            logError(deviceLog, 'Creating device', err);
        }
    }

    // Remove cached HAP accessories that this plugin no longer publishes.
    //
    // With Matter enabled every one of them is stale, because the robot is then
    // its own Matter node and this plugin publishes nothing over HAP. Otherwise
    // only the accessories no device claimed are stale.
    //
    // A device that failed to be created is indistinguishable from one that is
    // gone, so nothing is removed after a failure: a cloud outage must not cost
    // the user the room, name and automations attached to an accessory.
    removeStaleAccessories(): void {
        if (this.deviceFailures) {
            this.log.debug('Not tidying cached HAP accessories after a device failure');
            return;
        }
        const published = new Set(this.devices.map(device => device.getAccessory().uuid));
        const stale = this.api.isMatterEnabled() ? this.cachedAccessories
            : this.cachedAccessories.filter(accessory => !published.has(accessory.UUID));
        if (!stale.length) return;

        for (const accessory of stale) {
            this.log.info(`Removing HomeKit accessory no longer published by this plugin: ${accessory.displayName}`);
        }
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }

    // Check a device serial number against the allow list.
    // An empty list means every robot vacuum in the account is exposed.
    validateDevice(serialNumber: string): boolean {
        const { whiteList } = this.config;
        return whiteList.length === 0 || whiteList.includes(serialNumber);
    }

    // Cleanup resources when Homebridge is shutting down.
    //
    // Nothing awaits this, so it must not reject: an unhandled rejection during
    // shutdown would be reported as a crash of Homebridge itself.
    async onShutdown(): Promise<void> {
        try {
            await this.stopDevices();
        } catch (err) {
            logError(this.log, 'Shutting down', err);
        }
    }

    // Stop polling the devices
    private async stopDevices(): Promise<void> {
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
