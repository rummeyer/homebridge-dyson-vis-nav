// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import type { PlatformAccessory, PlatformName, PluginIdentifier } from 'homebridge';
import { AnsiLogger } from './logger.js';
import { Changed } from './decorator-changed.js';
import { MaybePromise } from './utils.js';
import { BasicInformation, PowerSource, RvcOperationalState, ServiceArea } from './matter-clusters.js';
import { AV, RI } from './logger-options.js';
import { RvcCleanMode360, RvcCleanModeOptions, RvcRunMode360 } from './matter-360-modes.js';

// Details used to identify the device to Matter controllers
export interface BasicInformationOptions {
    uniqueId:           string;
    nodeLabel:          string;
    partNumber?:        string;
    productAppearance?: BasicInformation.ProductAppearance;
    productId:          number;
    productLabel?:      string;
    productName:        string;
    productUrl?:        string;
    serialNumber:       string;
    softwareVersion?:   string;
    vendorId:           number;
    vendorName:         string;
}

// Device-specific accessory configuration
export interface EndpointOptions360 {
    id:                 string;
    deviceName:         string;
    basicInformation:   BasicInformationOptions;
    powerSource:        { batteryPartNumber: string };
    rvcCleanMode:       RvcCleanModeOptions;
    supportsMaps:       boolean;
}

// Updates to the Power Source cluster attributes
export interface UpdatePowerSource360 {
    activeBatChargeFaults:  PowerSource.BatChargeFault[];
    activeBatFaults:        PowerSource.BatFault[];
    batChargeLevel:         PowerSource.BatChargeLevel;
    batChargeState:         PowerSource.BatChargeState;
    batPercentRemaining:    number | null; // ×2, e.g. 200 for 100%
    status:                 PowerSource.PowerSourceStatus;
}

// Updates to the RVC Operational State cluster
export interface UpdateRvcOperationalState360 {
    isActive:               boolean;
    operationalError:       RvcOperationalState.ErrorStateStruct;
    operationalState:       RvcOperationalState.OperationalState;
}

// Updates to the Service Area cluster
export interface UpdateServiceArea360 {
    currentArea:            number | null;
    progress:               ServiceArea.Progress[];
    selectedAreas:          number[];
    supportedAreas:         ServiceArea.Area[];
    supportedMaps:          ServiceArea.Map[];
}

// Commands that the device layer can handle
export interface EndpointCommands360 {
    ChangeRunMode:   (newMode: RvcRunMode360)   => MaybePromise;
    ChangeCleanMode: (newMode: RvcCleanMode360) => MaybePromise;
    Pause:           ()                         => MaybePromise;
    Resume:          ()                         => MaybePromise;
    GoHome:          ()                         => MaybePromise;
    SelectAreas:     (newAreas: number[])       => MaybePromise;
}
type EndpointCommand360Args<T extends keyof EndpointCommands360> = Parameters<EndpointCommands360[T]>;
type EndpointHandler360<T extends keyof EndpointCommands360> = (...args: EndpointCommand360Args<T>) => MaybePromise;

// An accessory presenting a Dyson robot vacuum to Homebridge.
//
// The device layer maps the robot's MQTT status onto Matter cluster attributes
// and issues Matter commands, because that is the only model rich enough to
// describe a robot vacuum. What differs between the subclasses is only how that
// model reaches Homebridge: as an actual Matter accessory, or — when Matter is
// switched off — as the closest HomeKit equivalent, which is a switch. Keeping
// the Matter vocabulary in this interface means the mapping exists once.
export abstract class DysonAccessory360 {

    // Decorator support
    changed: Changed;

    // Accessory identifier, derived from the device's unique identifier
    abstract readonly uuid: string;

    // Registered command handlers
    readonly commands: Partial<EndpointCommands360> = {};

    // Construct a new accessory
    constructor(readonly log: AnsiLogger) {
        this.changed = new Changed(log);
    }

    // Set a command handler
    setCommandHandler360<Command extends keyof EndpointCommands360>(
        command: Command,
        handler: EndpointCommands360[Command]
    ): this {
        if (this.commands[command]) throw new Error(`Handler already registered for command ${command}`);
        this.commands[command] = handler;
        return this;
    }

    // Execute a command handler
    async executeCommand<Command extends keyof EndpointCommands360>(
        command:    Command,
        ...args:    EndpointCommand360Args<Command>
    ): Promise<void> {
        const handler = this.commands[command];
        if (!handler) throw new Error(`${command} not implemented`);
        await (handler as EndpointHandler360<Command>)(...args);
    }

    // Register the accessory with Homebridge.
    //
    // Any accessories Homebridge restored from its cache are offered here, so
    // an implementation that publishes over HAP can adopt its own rather than
    // creating a duplicate.
    abstract register(
        pluginIdentifier:   PluginIdentifier,
        platformName:       PlatformName,
        cached?:            PlatformAccessory[]
    ): Promise<void>;

    // Apply state updates
    abstract updateReachable(reachable: boolean): Promise<void>;
    abstract updatePowerSource(attributes: UpdatePowerSource360): Promise<void>;
    abstract updateRvcRunMode(runMode: RvcRunMode360): Promise<void>;
    abstract updateRvcCleanMode(cleanMode: RvcCleanMode360): Promise<void>;
    abstract updateRvcOperationalState(attributes: UpdateRvcOperationalState360): Promise<void>;
    abstract updateServiceArea(attributes: UpdateServiceArea360): Promise<void>;
}

// Format an enumerated value for logging
export function formatEnumLog(enumType: Record<number, string>, value: number): string {
    const label = enumType[value];
    return `${AV}${label ?? 'Unknown'}${RI} (${AV}${value}${RI})`;
}
