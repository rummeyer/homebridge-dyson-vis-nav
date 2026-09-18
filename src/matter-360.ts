// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import type {
    API,
    MatterAccessory,
    MatterAPI,
    PlatformAccessory,
    PlatformName,
    PluginIdentifier
} from 'homebridge';
import { AnsiLogger } from './logger.js';
import { Config } from './config-types.js';
import {
    BasicInformation,
    ModeBase,
    PowerSource,
    RvcOperationalState,
    ServiceArea
} from './matter-clusters.js';
import {
    RvcCleanMode360,
    RvcRunMode360,
    RVC_RUN_MODE_SUPPORTED,
    rvcCleanModeSupported
} from './matter-360-modes.js';
import {
    ChangeToModeError,
    RvcOperationalStateError,
    SelectAreaError
} from './error-360.js';
import { ifValueChanged } from './decorator-changed.js';
import {
    DysonAccessory360,
    formatEnumLog,
    EndpointOptions360,
    UpdatePowerSource360,
    UpdateRvcOperationalState360,
    UpdateServiceArea360
} from './accessory-360.js';
import { logError } from './log-error.js';
import { assertIsDefined, formatList, formatSeconds, MS, plural } from './utils.js';
import { AN, AV, CN, RI } from './logger-options.js';
import { isDeepStrictEqual } from 'util';

// Battery constants for the Power Source cluster
const BATTERY_CAPACITY_MAH = 6600;

// A Homebridge Matter accessory presenting a Dyson robot vacuum.
//
// This replaces the Matterbridge original's `Endpoint360`. Matterbridge builds
// an endpoint imperatively from matter.js behaviors; Homebridge instead takes a
// declarative accessory descriptor and applies later changes through
// `updateAccessoryState`, so the cluster construction and the update methods
// are split accordingly. The attribute semantics are unchanged.
export class MatterAccessory360 extends DysonAccessory360 {

    // Matter accessory identifier
    override readonly uuid: string;

    // Start time of the most recent activity
    startActive = 0;

    // Whether the accessory has been registered with Homebridge
    private registered = false;

    // Last known Service Area state.
    //
    // SelectAreas has to validate the requested areas against the supported
    // ones, and decide whether the selection actually changed. Tracking the
    // values written to the cluster avoids reading them back asynchronously in
    // the middle of a command handler.
    private selectedAreas:  number[] = [];
    private supportedAreas: ServiceArea.Area[] = [];

    // The Matter API, which is only available when Matter is enabled
    private readonly matter: MatterAPI;

    // Construct a new accessory
    constructor(
        log:                AnsiLogger,
        readonly config:    Config,
        readonly api:       API,
        readonly options:   EndpointOptions360
    ) {
        super(log);
        assertIsDefined(api.matter);
        this.matter = api.matter;
        this.uuid   = api.hap.uuid.generate(options.id);
    }

    // Build the accessory descriptor passed to Homebridge
    describe(): MatterAccessory {
        const { options } = this;
        const info = options.basicInformation;
        const { batteryPartNumber } = options.powerSource;

        const accessory: MatterAccessory = {
            UUID:               this.uuid,
            displayName:        options.deviceName,
            deviceType:         this.matter.deviceTypes.RoboticVacuumCleaner,
            serialNumber:       info.serialNumber,
            manufacturer:       info.vendorName,
            model:              info.productName,
            ...(info.softwareVersion && { firmwareRevision: info.softwareVersion }),
            context:            {},
            clusters: {
                powerSource: {
                    // Constant attributes
                    batPresent:                 true,
                    batQuantity:                1,
                    batReplaceability:          PowerSource.BatReplaceability.UserReplaceable,
                    batReplacementDescription:  `Dyson ${batteryPartNumber} (14.8V Li-ion)`,
                    batFunctionalWhileCharging: false,
                    description:                'Primary Battery',
                    order:                      0,
                    // Variable attributes (with dummy defaults)
                    activeBatFaults:            [],
                    batChargeLevel:             PowerSource.BatChargeLevel.Ok,
                    batChargeState:             PowerSource.BatChargeState.Unknown,
                    batPercentRemaining:        null,
                    batReplacementNeeded:       false,
                    status:                     PowerSource.PowerSourceStatus.Unspecified
                },
                rvcRunMode: {
                    supportedModes:             RVC_RUN_MODE_SUPPORTED,
                    currentMode:                RvcRunMode360.Idle
                },
                rvcCleanMode: {
                    supportedModes:             rvcCleanModeSupported(options.rvcCleanMode),
                    currentMode:                RvcCleanMode360.Quiet
                },
                rvcOperationalState: {
                    operationalStateList: [
                        { operationalStateId: RvcOperationalState.OperationalState.Stopped },
                        { operationalStateId: RvcOperationalState.OperationalState.Running },
                        { operationalStateId: RvcOperationalState.OperationalState.Paused },
                        { operationalStateId: RvcOperationalState.OperationalState.Error },
                        { operationalStateId: RvcOperationalState.OperationalState.SeekingCharger },
                        { operationalStateId: RvcOperationalState.OperationalState.Charging },
                        { operationalStateId: RvcOperationalState.OperationalState.Docked }
                    ],
                    operationalState:           RvcOperationalState.OperationalState.Stopped,
                    operationalError:           RvcOperationalStateError.toStruct(),
                    phaseList:                  null,
                    currentPhase:               null,
                    countdownTime:              null
                },
                ...(options.supportsMaps && {
                    serviceArea: {
                        currentArea:            null,
                        progress:               [],
                        selectedAreas:          [],
                        supportedAreas:         [],
                        supportedMaps:          []
                    }
                })
            },
            handlers: {
                rvcRunMode: {
                    changeToMode: (args: ModeBase.ChangeToModeRequest) => this.onChangeRunMode(args)
                },
                rvcCleanMode: {
                    changeToMode: (args: ModeBase.ChangeToModeRequest) => this.onChangeCleanMode(args)
                },
                rvcOperationalState: {
                    pause:  () => this.onOperationalCommand('Pause',  RvcOperationalState.ErrorState.CommandInvalidInState),
                    resume: () => this.onOperationalCommand('Resume', RvcOperationalState.ErrorState.UnableToStartOrResume),
                    goHome: () => this.onOperationalCommand('GoHome', RvcOperationalState.ErrorState.CommandInvalidInState)
                },
                ...(options.supportsMaps && {
                    serviceArea: {
                        selectAreas: (args: { newAreas: number[] }) => this.onSelectAreas(args)
                    }
                }),
                identify: {
                    identify: () => { this.log.info(`${CN}Identify device${RI}`); }
                }
            }
        };

        // Note what the Matter representation cannot carry. Homebridge's
        // accessory descriptor has no fields for these, and Apple Home does not
        // surface them, so they are logged rather than silently dropped.
        const extras = [
            info.partNumber     && `part number ${info.partNumber}`,
            info.productId      && `product ID 0x${info.productId.toString(16)}`,
            info.vendorId       && `vendor ID 0x${info.vendorId.toString(16)}`,
            info.productUrl     && `URL ${info.productUrl}`,
            info.productAppearance && `appearance ${BasicInformation.ProductFinish[info.productAppearance.finish]}`
              + `/${info.productAppearance.primaryColor === null ? 'none' : BasicInformation.Color[info.productAppearance.primaryColor]}`,
            `battery ${BATTERY_CAPACITY_MAH} mAh`
        ].filter((v): v is string => typeof v === 'string');
        this.log.debug(`Device details not exposed via Matter: ${formatList(extras)}`);

        return accessory;
    }

    // Register the accessory with Homebridge.
    //
    // A robot vacuum is published as its own Matter node rather than through the
    // bridge, and Homebridge reports the outcome of that publish separately
    // (look for "External Matter accessory published" in the log). This promise
    // resolving means the accessory was accepted, not that its node is up.
    override async register(
        pluginIdentifier:   PluginIdentifier,
        platformName:       PlatformName,
        _cached?:           PlatformAccessory[]
    ): Promise<void> {
        await this.matter.registerPlatformAccessories(pluginIdentifier, platformName, [this.describe()]);
        this.registered = true;
        this.log.info(`Submitted ${AV}${this.options.deviceName}${RI} to Homebridge`
                    + ' as a standalone Matter robot vacuum cleaner');
    }

    // Apply a cluster state update, if the accessory has been registered
    private async updateState(cluster: string, attributes: Record<string, unknown>): Promise<void> {
        if (!this.registered) return;
        try {
            await this.matter.updateAccessoryState(this.uuid, cluster, attributes);
        } catch (err) {
            logError(this.log, `Update ${cluster}`, err);
        }
    }

    // Update the reachability of the device.
    //
    // Matter expresses this on the Basic Information cluster, but that lives on
    // the node rather than on the device endpoint, and Homebridge's
    // updateAccessoryState only addresses the endpoint — writing it there fails
    // with "Behavior basicInformation is not present on this endpoint". Nothing
    // in the Matter API reaches the node, so this is logged and no more.
    //
    // Controllers are told instead through the operational state: once the robot
    // has been silent for longer than the configured timeout, its activity is
    // reported as unknown rather than left at whatever was last seen.
    @ifValueChanged
    override updateReachable(reachable: boolean): Promise<void> {
        this.log.info(`${AN}Reachable${RI}: ${AV}${reachable}${RI}`);
        return Promise.resolve();
    }

    // Update the Power Source cluster attributes when required
    @ifValueChanged
    override async updatePowerSource(attributes: UpdatePowerSource360): Promise<void> {
        const { status, batPercentRemaining, batChargeLevel, batChargeState,
            activeBatChargeFaults, activeBatFaults } = attributes;
        const logBattery = [
            formatEnumLog(PowerSource.BatChargeLevel,      batChargeLevel),
            formatEnumLog(PowerSource.PowerSourceStatus,   status),
            formatEnumLog(PowerSource.BatChargeState,      batChargeState)
        ];
        if (batPercentRemaining !== null) logBattery.unshift(`${AV}${batPercentRemaining / 2}${RI}%`);
        if (activeBatFaults.length) {
            const faults = activeBatFaults.map(v => formatEnumLog(PowerSource.BatFault, v));
            logBattery.push(`${AN}${plural(faults.length, 'battery fault', false)}${RI} [${formatList(faults)}${RI}]`);
        }
        if (activeBatChargeFaults.length) {
            const faults = activeBatChargeFaults.map(v => formatEnumLog(PowerSource.BatChargeFault, v));
            logBattery.push(`${AN}${plural(faults.length, 'charge fault', false)}${RI} [${formatList(faults)}${RI}]`);
        }
        this.log.info(`${AN}Battery status${RI}: ${formatList(logBattery)}`);

        // `activeBatChargeFaults` is not part of Homebridge's PowerSource state,
        // so charge faults are reported through the log only.
        await this.updateState('powerSource', {
            status,
            batPercentRemaining,
            batChargeLevel,
            batChargeState,
            activeBatFaults
        });
    }

    // Update the RVC Run Mode cluster attributes when required
    @ifValueChanged
    override async updateRvcRunMode(runMode: RvcRunMode360): Promise<void> {
        this.log.info(`${AN}RVC Run Mode${RI}: ${formatEnumLog(RvcRunMode360, runMode)}`);
        await this.updateState('rvcRunMode', { currentMode: runMode });
    }

    // Update the RVC Clean Mode cluster attributes when required
    @ifValueChanged
    override async updateRvcCleanMode(cleanMode: RvcCleanMode360): Promise<void> {
        this.log.info(`${AN}RVC Clean Mode${RI}: ${formatEnumLog(RvcCleanMode360, cleanMode)}`);
        await this.updateState('rvcCleanMode', { currentMode: cleanMode });
    }

    // Update the RVC Operational State cluster attributes when required
    @ifValueChanged
    override async updateRvcOperationalState(attributes: UpdateRvcOperationalState360): Promise<void> {
        const { operationalState, operationalError, isActive } = attributes;
        this.log.info(`${AN}RVC Operational State${RI}: ${formatEnumLog(RvcOperationalState.OperationalState, operationalState)}`);
        await this.updateState('rvcOperationalState', { operationalState, operationalError });

        // Homebridge 2.4.0 exposes no way to emit Matter cluster events, so the
        // OperationCompletion and OperationalError events of the Matterbridge
        // original are logged instead. Controllers still see the corresponding
        // attributes, which is what Apple Home reads.
        const { errorStateId, errorStateLabel, errorStateDetails } = operationalError;
        const isError = errorStateId !== RvcOperationalState.ErrorState.NoError;
        if (this.changed.isChanged('isActive', isActive)) {
            if (isActive) {
                this.log.info(`(${AN}RVC Operation Started${RI})`);
                this.startActive = Date.now();
            } else if (this.startActive) {
                const totalOperationalTime = Math.round((Date.now() - this.startActive) / MS);
                this.log.info(`${AN}RVC Operation Completed${RI} in ${AV}${formatSeconds(totalOperationalTime)}${RI}`);
            }
        }

        if (this.changed.isChanged('operationalError', operationalError)) {
            if (isError) {
                const errorName = RvcOperationalState.ErrorState[errorStateId];
                let logMessage = `${AN}RVC Operational Error${RI}:`
                               + ` ${errorName ? `${AV}${errorName}${RI} (${AV}${errorStateId}${RI})` : `${AV}${errorStateId}${RI}`}`;
                if (errorStateLabel)   logMessage += ` [${AV}${errorStateLabel}${RI}]`;
                if (errorStateDetails) logMessage += `: ${AV}${errorStateDetails}${RI}`;
                this.log.warn(logMessage);
            } else {
                this.log.info(`${AN}RVC Operational Error${RI}: ${AV}Error cleared${RI}`);
            }
        }
    }

    // Update the Service Area cluster attributes when required
    @ifValueChanged
    override async updateServiceArea(attributes: UpdateServiceArea360): Promise<void> {
        if (!this.options.supportsMaps) return;
        const { currentArea, progress, selectedAreas, supportedAreas, supportedMaps } = attributes;
        const areaName = (areaId: number | null): string => formatAreaName(supportedMaps, supportedAreas, areaId);
        const progressStatus = progress.map(({ areaId, status }) =>
            `${areaName(areaId)}: ${AV}${ServiceArea.OperationalStatus[status]}${RI} (${AV}${status}${RI})`);
        const logMessage = `${AN}Service Area${RI}:`
                         + ` ${AV}${plural(supportedMaps.length, 'map')}${RI}, ${AV}${plural(supportedAreas.length, 'area')}${RI},`
                         + ` selected [${selectedAreas.map(areaName).join(', ')}],`
                         + ` @ ${areaName(currentArea)}, status [${progressStatus.join(', ')}]`;
        this.log.info(logMessage);
        this.selectedAreas  = selectedAreas;
        this.supportedAreas = supportedAreas;
        await this.updateState('serviceArea', {
            supportedMaps, supportedAreas, currentArea, progress, selectedAreas
        });
    }

    // ── Command handlers ──────────────────────────────────────────────────
    //
    // Matterbridge command handlers return a cluster response struct carrying a
    // status code. Homebridge handlers instead return void and signal failure by
    // throwing, so each handler below converts the cluster-specific errors of
    // the ported device layer into the nearest Matter protocol status.

    // RVC Run Mode ChangeToMode command handler
    private async onChangeRunMode({ newMode }: ModeBase.ChangeToModeRequest): Promise<void> {
        try {
            this.log.debug(`RVC Run Mode command: ChangeToMode ${newMode}...`);
            const supported = RVC_RUN_MODE_SUPPORTED.some(({ mode }) => mode === newMode);
            if (!supported) throw new ChangeToModeError.UnsupportedMode();
            await this.executeCommand('ChangeRunMode', newMode);
            this.log.debug(`RVC Run Mode command: ChangeToMode ${newMode} - OK`);
        } catch (err) {
            logError(this.log, 'RVC Run Mode ChangeToMode', err);
            throw this.toMatterError(err, 'Unable to change run mode');
        }
    }

    // RVC Clean Mode ChangeToMode command handler
    private async onChangeCleanMode({ newMode }: ModeBase.ChangeToModeRequest): Promise<void> {
        try {
            this.log.debug(`RVC Clean Mode command: ChangeToMode ${newMode}...`);
            const supported = rvcCleanModeSupported(this.options.rvcCleanMode).some(({ mode }) => mode === newMode);
            if (!supported) throw new ChangeToModeError.UnsupportedMode();
            await this.executeCommand('ChangeCleanMode', newMode);
            this.log.debug(`RVC Clean Mode command: ChangeToMode ${newMode} - OK`);
        } catch (err) {
            logError(this.log, 'RVC Clean Mode ChangeToMode', err);
            throw this.toMatterError(err, 'Unable to change clean mode');
        }
    }

    // RVC Operational State Pause/Resume/GoHome command handler
    private async onOperationalCommand(
        command:        'Pause' | 'Resume' | 'GoHome',
        defaultErrorId: RvcOperationalState.ErrorState
    ): Promise<void> {
        try {
            this.log.debug(`RVC Operational State command: ${command}...`);
            await this.executeCommand(command);
            this.log.debug(`RVC Operational State command: ${command} - OK`);
        } catch (err) {
            logError(this.log, `RVC Operational State ${command}`, err);
            const { errorStateId } = RvcOperationalStateError.toStruct(err, defaultErrorId);
            throw this.toMatterError(err, `${command} failed`, errorStateId);
        }
    }

    // Service Area SelectAreas command handler
    private async onSelectAreas({ newAreas }: { newAreas: number[] }): Promise<void> {
        const { selectedAreas, supportedAreas } = this;
        try {
            this.log.info(`Service Area command: SelectAreas ${formatList(newAreas.map(String))}`);
            newAreas = [...new Set(newAreas)];

            // Check whether it is a valid request
            const maps = new Set<number | null>();
            for (const area of newAreas) {
                const supportedArea = supportedAreas.find(({ areaId }) => areaId === area);
                if (!supportedArea) throw new SelectAreaError.UnsupportedArea(`${area} is not a supported area`);
                maps.add(supportedArea.mapId);
            }

            // If all areas are specified then treat it as an empty list
            if (newAreas.length === supportedAreas.length) newAreas = [];
            else if (maps.size !== 1) throw new SelectAreaError.InvalidSet('Areas must all be from the same map');

            // Attempt to select the areas
            await this.executeCommand('SelectAreas', newAreas);
            this.selectedAreas = newAreas;
            await this.updateState('serviceArea', { selectedAreas: newAreas });
        } catch (err) {
            if (isDeepStrictEqual(new Set(selectedAreas), new Set(newAreas))) {
                // Matter requires Success status if the areas are unchanged
                logError(this.log, 'Service Area SelectAreas (error ignored)', err);
                return;
            }
            logError(this.log, 'Service Area SelectAreas', err);
            throw this.toMatterError(err, 'Unable to select areas');
        }
    }

    // Convert a cluster-specific error to the nearest Matter protocol status
    private toMatterError(err: unknown, fallback: string, errorStateId?: number): Error {
        const status = this.matter.status;
        const message = err instanceof Error ? err.message : fallback;
        if (err instanceof ChangeToModeError) {
            return err.status === ModeBase.ModeChangeStatus.UnsupportedMode
                ? new status.ConstraintError(message)
                : new status.InvalidInState(message);
        }
        if (err instanceof SelectAreaError) {
            switch (err.status) {
            case ServiceArea.SelectAreasStatus.UnsupportedArea: return new status.ConstraintError(message);
            case ServiceArea.SelectAreasStatus.InvalidSet:      return new status.InvalidAction(message);
            default:                                            return new status.InvalidInState(message);
            }
        }
        if (errorStateId === RvcOperationalState.ErrorState.CommandInvalidInState) {
            return new status.InvalidInState(message);
        }
        return new status.Failure(message);
    }
}

// Format a Service Area area identifier for logging
export function formatAreaName(
    supportedMaps:  ServiceArea.Map[],
    supportedAreas: ServiceArea.Area[],
    areaId:         number | null
): string {
    if (areaId === null) return `${AV}n/a${RI}`;
    const area = supportedAreas.find(a => a.areaId === areaId);
    assertIsDefined(area);
    assertIsDefined(area.areaInfo.locationInfo);
    const map = supportedMaps.find(m => m.mapId === area.mapId);
    assertIsDefined(map);
    const name = `${map.name}:${area.areaInfo.locationInfo.locationName}`.replaceAll(/\s+/g, '_');
    return `${AV}${name}${RI} (${AV}${area.mapId}:${areaId}${RI})`;
}
