// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer

import type {
    API,
    Categories,
    HAPStatus,
    PlatformAccessory,
    PlatformName,
    PluginIdentifier,
    Service
} from 'homebridge';
import { AnsiLogger } from './logger.js';
import { Config } from './config-types.js';
import {
    DysonAccessory360,
    EndpointOptions360,
    formatEnumLog,
    UpdatePowerSource360,
    UpdateRvcOperationalState360,
    UpdateServiceArea360
} from './accessory-360.js';
import { PowerSource, RvcOperationalState } from './matter-clusters.js';
import { RvcCleanMode360, RvcRunMode360 } from './matter-360-modes.js';
import { logError } from './log-error.js';
import { AN, AV, CN, CV, RI } from './logger-options.js';

// HAP's Categories and HAPStatus are ambient const enums, which `isolatedModules`
// forbids reading, so the two values needed here are written out instead
const CATEGORY_SWITCH               =      8 as Categories;  // Categories.SWITCH
const STATUS_COMMUNICATION_FAILURE  = -70402 as HAPStatus;   // SERVICE_COMMUNICATION_FAILURE

// Service subtypes, which keep the services of a restored accessory apart
const SUBTYPE_CLEAN     = 'clean';
const SUBTYPE_BATTERY   = 'battery';
const SUBTYPE_STATUS    = 'status';

// A HomeKit (HAP) accessory presenting a Dyson robot vacuum.
//
// HomeKit has no robot vacuum: Apple added them to the Home app through Matter
// and never to HAP itself, so nothing here can be a faithful representation.
// What it offers instead is the part of the robot that maps onto HomeKit
// without inventing anything:
//
//   - a switch, because starting a clean and sending the robot back to its
//     dock is the whole of what a HomeKit control can ask of it;
//   - a battery, which HomeKit models exactly as Matter does; and
//   - a contact sensor reporting whether the robot has a problem, which is
//     what an automation can react to.
//
// Everything the robot can do beyond that — cleaning modes, zones, pausing and
// resuming — has no HomeKit equivalent and is deliberately left out rather than
// mapped onto a control that would mean something else. Enabling Matter is what
// makes those reachable, and the log says so.
export class HapAccessory360 extends DysonAccessory360 {

    // HAP accessory identifier
    override readonly uuid: string;

    // The services of the accessory, once registered
    private clean?:     Service;
    private battery?:   Service;
    private status?:    Service;

    // Last known state.
    //
    // HomeKit reads characteristics synchronously, whereas the robot is only
    // heard from over MQTT, so every value it reports is held here and served
    // from memory.
    private isCleaning   = false;
    private isReachable  = true;
    private batteryLevel = 0;

    // Construct a new accessory
    constructor(
        log:                AnsiLogger,
        readonly config:    Config,
        readonly api:       API,
        readonly options:   EndpointOptions360
    ) {
        super(log);
        this.uuid = api.hap.uuid.generate(options.id);
    }

    // Register the accessory with Homebridge.
    //
    // An accessory Homebridge restored from its cache is adopted rather than
    // replaced: its identifier is what ties the robot to its room, name and
    // automations in the Home app, and registering a second one would leave the
    // user with a duplicate to tidy up.
    override register(
        pluginIdentifier:   PluginIdentifier,
        platformName:       PlatformName,
        cached?:            PlatformAccessory[]
    ): Promise<void> {
        const { hap } = this.api;
        const { deviceName } = this.options;
        const restored = cached?.find(accessory => accessory.UUID === this.uuid);
        const accessory = restored
            ?? new this.api.platformAccessory(deviceName, this.uuid, CATEGORY_SWITCH);
        accessory.displayName = deviceName;

        // Describe the device itself
        const info = this.options.basicInformation;
        const { Characteristic } = hap;
        const information = accessory.getService(hap.Service.AccessoryInformation)
            ?? accessory.addService(hap.Service.AccessoryInformation);
        information
            .setCharacteristic(Characteristic.Manufacturer, info.vendorName)
            .setCharacteristic(Characteristic.Model,        info.productName)
            .setCharacteristic(Characteristic.SerialNumber, info.serialNumber);
        const firmware = hapVersion(info.softwareVersion);
        if (firmware) information.setCharacteristic(Characteristic.FirmwareRevision, firmware);

        // The switch that starts a clean and sends the robot home again
        this.clean = this.nameService(
            accessory.getServiceById(hap.Service.Switch, SUBTYPE_CLEAN)
                ?? accessory.addService(hap.Service.Switch, deviceName, SUBTYPE_CLEAN), deviceName);
        this.clean.setPrimaryService(true);
        this.clean.getCharacteristic(Characteristic.On)
            .onGet(() => this.isCleaning)
            .onSet(value => this.onSetClean(Boolean(value)));

        // The battery, reported exactly as the Matter Power Source cluster does.
        //
        // The charge level and charging state are optional characteristics, so
        // they are given values here rather than being added by the first
        // update: an accessory published with a battery that has no level is
        // what the Home app would otherwise show until the robot next reports.
        const batteryName = `${deviceName} Battery`;
        this.battery = this.nameService(
            accessory.getServiceById(hap.Service.Battery, SUBTYPE_BATTERY)
                ?? accessory.addService(hap.Service.Battery, batteryName, SUBTYPE_BATTERY), batteryName);
        this.battery
            .setCharacteristic(Characteristic.BatteryLevel,     this.batteryLevel)
            .setCharacteristic(Characteristic.ChargingState,    Characteristic.ChargingState.NOT_CHARGING)
            .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);

        // A problem with the robot, including one that stopped responding
        const statusName = `${deviceName} Problem`;
        this.status = this.nameService(
            accessory.getServiceById(hap.Service.ContactSensor, SUBTYPE_STATUS)
                ?? accessory.addService(hap.Service.ContactSensor, statusName, SUBTYPE_STATUS), statusName);
        this.status
            .setCharacteristic(Characteristic.ContactSensorState, Characteristic.ContactSensorState.CONTACT_DETECTED)
            .setCharacteristic(Characteristic.StatusFault,        Characteristic.StatusFault.NO_FAULT)
            .setCharacteristic(Characteristic.StatusActive,       true);

        // Hand the accessory to Homebridge
        if (restored) {
            this.api.updatePlatformAccessories([accessory]);
            this.log.info(`Restored ${AV}${deviceName}${RI} from the Homebridge cache`
                        + ' as a HomeKit switch, battery and problem sensor');
        } else {
            this.api.registerPlatformAccessories(pluginIdentifier, platformName, [accessory]);
            this.log.info(`Published ${AV}${deviceName}${RI} to Homebridge`
                        + ' as a HomeKit switch, battery and problem sensor');
        }
        return Promise.resolve();
    }

    // Apply the current name to a service.
    //
    // A restored accessory carries the name it was created with, which is stale
    // if the device has since been renamed in the MyDyson account.
    private nameService(service: Service, name: string): Service {
        service.setCharacteristic(this.api.hap.Characteristic.Name, name);
        return service;
    }

    // Handle the switch being operated in the Home app
    private async onSetClean(on: boolean): Promise<void> {
        const { hap } = this.api;
        const action = on ? 'Cleaning' : 'GoHome';
        try {
            this.log.info(`${CN}Switch${RI} ${AV}${on ? 'On' : 'Off'}${RI} → ${CV}${action}${RI}`);
            if (on) await this.executeCommand('ChangeRunMode', RvcRunMode360.Cleaning);
            else    await this.executeCommand('GoHome');
        } catch (err) {
            logError(this.log, `Switch ${on ? 'On' : 'Off'}`, err);

            // Report the failure to HomeKit, which reverts the switch, and then
            // restate what the robot is actually doing in case it does not
            throw new hap.HapStatusError(STATUS_COMMUNICATION_FAILURE);
        } finally {
            this.clean?.updateCharacteristic(hap.Characteristic.On, this.isCleaning);
        }
    }

    // Update the reachability of the device.
    //
    // A robot that has gone quiet is not necessarily in trouble, so this alone
    // does not trip the problem sensor; it marks the sensor's readings as no
    // longer current. Once the configured timeout has passed the device layer
    // reports an operational error as well, and that does trip it.
    override updateReachable(reachable: boolean): Promise<void> {
        if (this.changed.isChanged('reachable', reachable)) {
            this.log.info(`${AN}Reachable${RI}: ${AV}${reachable}${RI}`);
        }
        this.isReachable = reachable;
        this.status?.updateCharacteristic(this.api.hap.Characteristic.StatusActive, reachable);
        return Promise.resolve();
    }

    // Update the battery service
    override updatePowerSource(attributes: UpdatePowerSource360): Promise<void> {
        const { Characteristic } = this.api.hap;
        const { batPercentRemaining, batChargeLevel, batChargeState } = attributes;

        // A robot that has not reported a level keeps the last one seen; HomeKit
        // has no way to say "unknown", and inventing 0% would read as a flat
        // battery rather than as an absent reading
        if (batPercentRemaining !== null) this.batteryLevel = Math.round(batPercentRemaining / 2);
        const lowBattery = batChargeLevel !== PowerSource.BatChargeLevel.Ok;
        const charging = batChargeState === PowerSource.BatChargeState.IsCharging;

        if (this.changed.isChanged('battery', [this.batteryLevel, lowBattery, charging])) {
            this.log.info(`${AN}Battery status${RI}: ${AV}${this.batteryLevel}${RI}%,`
                        + ` ${formatEnumLog(PowerSource.BatChargeLevel, batChargeLevel)},`
                        + ` ${formatEnumLog(PowerSource.BatChargeState, batChargeState)}`);
        }

        this.battery?.updateCharacteristic(Characteristic.BatteryLevel, this.batteryLevel);
        this.battery?.updateCharacteristic(Characteristic.StatusLowBattery, lowBattery
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
        this.battery?.updateCharacteristic(Characteristic.ChargingState, charging
            ? Characteristic.ChargingState.CHARGING
            : Characteristic.ChargingState.NOT_CHARGING);
        return Promise.resolve();
    }

    // Update the switch
    override updateRvcRunMode(runMode: RvcRunMode360): Promise<void> {
        this.isCleaning = runMode !== RvcRunMode360.Idle;
        if (this.changed.isChanged('runMode', runMode)) {
            this.log.info(`${AN}Switch${RI}: ${AV}${this.isCleaning ? 'On' : 'Off'}${RI}`
                        + ` (${formatEnumLog(RvcRunMode360, runMode)})`);
        }
        this.clean?.updateCharacteristic(this.api.hap.Characteristic.On, this.isCleaning);
        return Promise.resolve();
    }

    // The cleaning mode, which a switch cannot express
    override updateRvcCleanMode(cleanMode: RvcCleanMode360): Promise<void> {
        if (this.changed.isChanged('cleanMode', cleanMode)) {
            this.log.debug(`${AN}Clean Mode${RI}: ${formatEnumLog(RvcCleanMode360, cleanMode)}`
                         + ' (not exposed to HomeKit; enable Matter to select cleaning modes)');
        }
        return Promise.resolve();
    }

    // Update the problem sensor
    override updateRvcOperationalState(attributes: UpdateRvcOperationalState360): Promise<void> {
        const { Characteristic } = this.api.hap;
        const { operationalState, operationalError } = attributes;
        const { errorStateId, errorStateLabel, errorStateDetails } = operationalError;
        const isError = errorStateId !== RvcOperationalState.ErrorState.NoError;

        if (this.changed.isChanged('operationalState', operationalState)) {
            this.log.info(`${AN}Operational State${RI}:`
                        + ` ${formatEnumLog(RvcOperationalState.OperationalState, operationalState)}`);
        }
        if (this.changed.isChanged('operationalError', operationalError)) {
            if (isError) {
                const errorName = RvcOperationalState.ErrorState[errorStateId];
                let logMessage = `${AN}Problem${RI}:`
                               + ` ${errorName ? `${AV}${errorName}${RI} (${AV}${errorStateId}${RI})` : `${AV}${errorStateId}${RI}`}`;
                if (errorStateLabel)   logMessage += ` [${AV}${errorStateLabel}${RI}]`;
                if (errorStateDetails) logMessage += `: ${AV}${errorStateDetails}${RI}`;
                this.log.warn(logMessage);
            } else {
                this.log.info(`${AN}Problem${RI}: ${AV}Cleared${RI}`);
            }
        }

        // An open contact is the convention for "something needs attention";
        // the accompanying status fault is what the Home app shows on the tile
        this.status?.updateCharacteristic(Characteristic.ContactSensorState, isError
            ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : Characteristic.ContactSensorState.CONTACT_DETECTED);
        this.status?.updateCharacteristic(Characteristic.StatusFault, isError
            ? Characteristic.StatusFault.GENERAL_FAULT
            : Characteristic.StatusFault.NO_FAULT);
        this.status?.updateCharacteristic(Characteristic.StatusActive, this.isReachable);
        return Promise.resolve();
    }

    // Zones, which HomeKit cannot address without a robot vacuum accessory
    override updateServiceArea(attributes: UpdateServiceArea360): Promise<void> {
        const { supportedAreas } = attributes;
        if (this.changed.isChanged('supportedAreas', supportedAreas.length) && supportedAreas.length) {
            this.log.debug(`${AN}Service Area${RI}: ${AV}${supportedAreas.length}${RI} zones`
                         + ' (not exposed to HomeKit; enable Matter to clean individual zones)');
        }
        return Promise.resolve();
    }
}

// Reduce a Dyson firmware version to something HomeKit accepts.
//
// HAP requires up to three dot-separated numbers, while Dyson reports versions
// such as "21.04.03.0002". A rejected value is logged by HAP-NodeJS as an
// illegal characteristic value on every restart, so anything that does not fit
// is trimmed to its first three components rather than passed through.
function hapVersion(version?: string): string | undefined {
    if (version === undefined) return undefined;
    const parts = version.split('.').slice(0, 3).map(part => parseInt(part, 10));
    if (!parts.length || parts.some(isNaN)) return undefined;
    return parts.join('.');
}
