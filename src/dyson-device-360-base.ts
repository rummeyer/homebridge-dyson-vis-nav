// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import {
    DysonDevice,
    DysonDeviceConstructorParams
} from './dyson-device-base.js';
import { DysonMqtt360, DysonMqttStatus360 } from './dyson-mqtt-360.js';
import { assertIsDefined, formatMilliseconds, formatSeconds, MS, plural, tryListener } from './utils.js';
import { DysonMqttStatus } from './dyson-mqtt.js';
import { BasicInformation } from './matter-clusters.js';
import { ifValueChanged } from './decorator-changed.js';
import { logError } from './log-error.js';
import { RvcCleanModeLabels } from './matter-360-modes.js';
import { MatterAccessory360 } from './matter-360.js';
import { HapAccessory360 } from './hap-360.js';
import {
    DysonAccessory360 as Endpoint360,
    EndpointOptions360,
    UpdatePowerSource360,
    UpdateRvcOperationalState360
} from './accessory-360.js';
import { PLUGIN_URL, VENDOR_ID, VENDOR_NAME } from './settings.js';
import { RvcCleanMode360, RvcRunMode360 } from './matter-360-modes.js';
import { PowerSource, RvcOperationalState } from './matter-clusters.js';
import {
    Dyson360CleaningStrategy,
    Dyson360PowerMode,
    Dyson360State
} from './dyson-360-types.js';
import {
    Dyson360MappedFaults,
    mapDyson360Faults
} from './dyson-device-360-faults.js';
import { assert } from 'console';
import {
    Device360Command,
    Device360CommandHandlers
} from './dyson-device-360-commands.js';
import { MaybePromise } from './utils.js';
import { VendorId } from './matter-clusters.js';
import { setTimeout } from 'node:timers/promises';
import { CleanRecordRaw, makeCleanRecordId, saveCleanRecord } from './dyson-clean-history.js';

// Details of a completed clean
export interface Dyson360CleanSummary {
    charges?:       number,
    cleanDuration?: number  // seconds
    cleanedArea?:   number, // m²
    mapLines?:      string[],
    history?:       Dyson360CleanHistoryData
}

// Details of a completed clean to keep for the settings page
export interface Dyson360CleanHistoryData {
    cleanId:        string,
    started?:       string,     // ISO 8601
    finished?:      string,     // ISO 8601
    zones:          string[],
    raw:            CleanRecordRaw
}
export type Dyson360CleanSummaryUnavailable =
    'Not found'     // Clean not found in history (retry)
  | 'Not ready'     // Clean has not finished (retry)
  | 'Unavailable';  // No MyDyson API
export type Dyson360CleanSummaryResult = Dyson360CleanSummary | Dyson360CleanSummaryUnavailable;

// Retry configuration for retrieving details of a completed clean
const CLEAN_RETRY_AFTER     =      5 * MS;  // 5 second minimum backoff
const CLEAN_RETRY_LIMIT     = 5 * 60 * MS;  // Give up after 1 minute
const CLEAN_RETRY_FACTOR    = 2;            // Double backoff on each failure

// Mapping of robot vacuum state to Matter equivalents
type StateMapColumns = [
    keyof typeof RvcRunMode360,
    keyof typeof RvcOperationalState.OperationalState,
    boolean
]
const STATE_MAP: Record<Dyson360State, StateMapColumns> = {
    //                                      RunMode         OperationalState    isDocked
    [Dyson360State.MachineOff]:             ['Idle',        'Error',            false],
    [Dyson360State.FaultCallHelpline]:      ['Idle',        'Error',            false],
    [Dyson360State.FaultContactHelpline]:   ['Idle',        'Error',            false],
    [Dyson360State.FaultCritical]:          ['Idle',        'Error',            false],
    [Dyson360State.FaultGettingInfo]:       ['Idle',        'Error',            false],
    [Dyson360State.FaultLost]:              ['Idle',        'Error',            false],
    [Dyson360State.FaultOnDock]:            ['Idle',        'Error',            true],
    [Dyson360State.FaultOnDockCharged]:     ['Idle',        'Error',            true],
    [Dyson360State.FaultOnDockCharging]:    ['Idle',        'Error',            true],
    [Dyson360State.FaultReplaceOnDock]:     ['Idle',        'Error',            false],
    [Dyson360State.FaultReturnToDock]:      ['Idle',        'Error',            false],
    [Dyson360State.FaultRunningDiagnostic]: ['Idle',        'Error',            false],
    [Dyson360State.FaultUserRecoverable]:   ['Idle',        'Error',            false],
    [Dyson360State.FullCleanAbandoned]:     ['Idle',        'SeekingCharger',   false],
    [Dyson360State.FullCleanAborted]:       ['Idle',        'SeekingCharger',   false],
    [Dyson360State.FullCleanCharging]:      ['Cleaning',    'Charging',         true],
    [Dyson360State.FullCleanDiscovering]:   ['Cleaning',    'Running',          false],
    [Dyson360State.FullCleanFinished]:      ['Idle',        'SeekingCharger',   false],
    [Dyson360State.FullCleanInitiated]:     ['Cleaning',    'Running',          false],
    [Dyson360State.FullCleanNeedsCharge]:   ['Cleaning',    'SeekingCharger',   false],
    [Dyson360State.FullCleanPaused]:        ['Cleaning',    'Paused',           false],
    [Dyson360State.FullCleanRunning]:       ['Cleaning',    'Running',          false],
    [Dyson360State.FullCleanTraversing]:    ['Cleaning',    'Running',          false],
    [Dyson360State.InactiveCharged]:        ['Idle',        'Docked',           true],
    [Dyson360State.InactiveCharging]:       ['Idle',        'Charging',         true],
    [Dyson360State.InactiveDischarging]:    ['Idle',        'Stopped',          false],
    [Dyson360State.MappingAborted]:         ['Idle',        'SeekingCharger',   false],
    [Dyson360State.MappingCharging]:        ['Mapping',     'Charging',         true],
    [Dyson360State.MappingFinished]:        ['Idle',        'SeekingCharger',   false],
    [Dyson360State.MappingInitiated]:       ['Mapping',     'Running',          false],
    [Dyson360State.MappingNeedsCharge]:     ['Mapping',     'SeekingCharger',   false],
    [Dyson360State.MappingPaused]:          ['Mapping',     'Paused',           false],
    [Dyson360State.MappingRunning]:         ['Mapping',     'Running',          false],
    [Dyson360State.Aborted]:                ['Idle',        'SeekingCharger',   false]
};
function mapState(state: Dyson360State): {
    runMode:            RvcRunMode360,
    operationalState:   RvcOperationalState.OperationalState,
    isDocked:           boolean
} {
    const [runMode, operationState, isDocked] = STATE_MAP[state];
    return {
        runMode:            RvcRunMode360[runMode],
        operationalState:   RvcOperationalState.OperationalState[operationState],
        isDocked
    };
}

// Mapping of robot power mode to its corresponding Matter Clean Mode and label
export type Dyson360PowerLevel = Dyson360PowerMode | Dyson360CleaningStrategy;
export type Dyson360PowerLevelMap = [Dyson360PowerLevel, ...RvcCleanModeLabels[number]];

// Thresholds for battery levels
const BATTERY_THRESHOLD_CRITICAL = 10;
const BATTERY_THRESHOLD_WARNING  = 25;
const BATTERY_THRESHOLD_FULL     = 100;

// A Dyson robot vacuum device
export abstract class DysonDevice360Base
    extends DysonDevice<DysonMqtt360> {

    // The MQTT client and status update listener
    static override readonly mqttConstructor = DysonMqtt360;
    mqttStatusListener:     () => void;

    // The RVC Matter accessory
    endpoint?:              Endpoint360;

    // State used to detect the end of a clean
    runMode = RvcRunMode360.Idle;

    // Tracking of a device that has stopped responding.
    //
    // Until the configured timeout elapses the last known state is kept, so a
    // brief MQTT dropout does not make the accessory flicker; after it,
    // continuing to claim the robot is cleaning would be a statement we cannot
    // support.
    unreachableTimer?:  NodeJS.Timeout;
    unreachableSince?:  number;
    get unreachableGrace(): number { return this.config.unreachableTimeout * MS; }

    // Construct a new Dyson device instance
    constructor(...args: DysonDeviceConstructorParams<DysonMqtt360>) {
        super(...args);

        // Prepare listeners for MQTT updates
        this.mqttStatusListener = tryListener(this.mqtt, () =>
            this.updateClusterAttributes(this.mqtt.status));
    }

    // Create the accessory for this device.
    //
    // A robot vacuum exists as a device type in Matter only, so that is what is
    // published whenever the bridge has Matter switched on. Without it the robot
    // is published over HAP instead, as the switch, battery and problem sensor
    // that HomeKit can actually represent.
    makeAccessory(): Endpoint360 {
        const rvcCleanModeLabels: RvcCleanModeLabels =
            this.getPowerLevelMaps().map(([, mode, label]) => [mode, label]);

        // Static configuration of the RVC clusters
        const endpointOptions: EndpointOptions360 = {
            id:                     this.uniqueId,
            deviceName:             this.deviceName,
            basicInformation: {
                nodeLabel:          this.deviceName,
                partNumber:         this.modelNumber,
                productAppearance:  this.getProductAppearance(),
                productId:          this.productId,
                productLabel:       this.modelNumber,
                productName:        this.modelName,
                productUrl:         PLUGIN_URL,
                serialNumber:       this.serialNumber,
                softwareVersion:    this.firmwareVersion,
                uniqueId:           this.uniqueId,
                vendorId:           VendorId(VENDOR_ID),
                vendorName:         VENDOR_NAME
            },
            powerSource: {
                batteryPartNumber:  this.getBatteryPartNumber()
            },
            rvcCleanMode: {
                labels:             rvcCleanModeLabels,
                simpleModeTags:     this.config.simpleModeTagsRvc
            },
            supportsMaps:           this.supportsMaps()
        };

        // Create the accessory and attach a command handler
        const endpoint = this.hbApi.isMatterEnabled()
            ? new MatterAccessory360(this.log, this.config, this.hbApi, endpointOptions)
            : new HapAccessory360(this.log, this.config, this.hbApi, endpointOptions);
        this.attachCommandHandlers(endpoint);
        return endpoint;
    }

    // Attach command handlers to the accessory
    attachCommandHandlers(endpoint: Endpoint360): Device360CommandHandlers {
        const handlers = new Device360CommandHandlers(this.log, this.mqtt, endpoint);
        handlers.attachCleanModeHandler(this.makePowerCommand.bind(this));
        return handlers;
    }

    // Indicates whether the device supports Service Area map features
    supportsMaps = (): boolean => false;

    // Retrieve the accessory representing this device
    override getAccessory(): Endpoint360 {
        return this.endpoint ??= this.makeAccessory();
    }

    // Start the device after the accessory has been registered
    override async start(): Promise<void> {
        this.mqtt.on('status', this.mqttStatusListener);
        this.mqtt.on('message', tryListener(this.mqtt, async msg => {
            switch (msg.msg) {
            case 'MAP-UPLOAD-STATUS':
                // Spot+Scrub Ai doesn't provide cleanId in its normal status
                await this.logCompletedClean(msg.cleanId, this.mqtt.status.cleanDuration);
                break;
            }
        }));
        await this.updateClusterAttributes(this.mqtt.status);
    }

    // Stop the device when Homebridge is shutting down
    override async stop(): Promise<void> {
        clearTimeout(this.unreachableTimer);
        this.unreachableTimer = undefined;
        this.mqtt.off('status', this.mqttStatusListener);
        await super.stop();
    }

    // Model-specific information
    abstract getBatteryPartNumber(): string;
    abstract getProductAppearance(): BasicInformation.ProductAppearance;
    abstract getPowerLevelMaps(): Dyson360PowerLevelMap[];
    abstract setPowerLevel(powerLevel: Dyson360PowerLevel): Promise<void>;
    abstract getPowerLevel(): Dyson360PowerLevel | undefined;

    // The power level a clean is actually running at, for models that report one
    // separately from their configured default. Undefined means not reported.
    getCurrentPowerLevel(): Dyson360PowerLevel | undefined { return undefined; }

    // Retrieve details of a completed clean
    getCompletedClean(_cleanId: string): MaybePromise<Dyson360CleanSummaryResult> { return {}; }

    // Retrieve details of a completed clean
    async getCompletedCleanWithRetries(cleanId: string): Promise<Dyson360CleanSummary> {
        const giveUpAt = Date.now() + CLEAN_RETRY_LIMIT;
        let backoff = CLEAN_RETRY_AFTER;
        for (;;) {
            const result = await this.getCompletedClean(cleanId);
            switch (result) {
            case 'Not found':
            case 'Not ready':
                // Failure might be due to requesting the results too soon
                if (giveUpAt < Date.now() + backoff) {
                    this.log.warn(`Abandoned retrieval of clean ${cleanId}: ${result}`);
                    return {};
                } else {
                    this.log.debug(`Failed to retrieve clean ${cleanId}: ${result}; retrying in ${formatMilliseconds(backoff)}...`);
                    await setTimeout(backoff);
                    backoff *= CLEAN_RETRY_FACTOR;
                }
                break;
            case 'Unavailable':
                // Not using MyDyson API
                return {};
            default:
                // Success
                return result;
            }
        }
    }

    // Log details of a completed clean
    async logCompletedClean(cleanId: string, cleanDuration?: number): Promise<void> {
        // Attempt to retrieve the details of the clean
        const result = await this.getCompletedCleanWithRetries(cleanId);

        // Log the summary
        const { charges, cleanedArea, mapLines } = result;
        if (result.cleanDuration) cleanDuration = result.cleanDuration;
        const parts: string[] = [];
        if (cleanedArea)            parts.push(`${cleanedArea.toFixed(2)} m²`);
        if (charges !== undefined)  parts.push(`with ${plural(charges, 'charge')}`);
        if (cleanDuration)          parts.push(`in ${formatSeconds(cleanDuration)}`);
        if (parts.length) this.log.info(`Cleaned ${parts.join(' ')}`);
        for (const line of mapLines ?? []) this.log.info(line);

        // Keep the clean for the settings page
        await this.saveCleanHistory(result, cleanDuration);
    }

    // Store a completed clean so the settings page can show its map
    async saveCleanHistory(summary: Dyson360CleanSummary, cleanDuration?: number): Promise<void> {
        const { history } = summary;
        if (!history) return;
        try {
            const { raw, ...details } = history;
            await saveCleanRecord(this.hbApi.user.storagePath(), {
                ...details,
                id:             makeCleanRecordId(history.cleanId, history.finished),
                serialNumber:   this.serialNumber,
                cleanDuration,
                cleanedArea:    summary.cleanedArea,
                charges:        summary.charges
            }, raw);
        } catch (err) {
            logError(this.log, 'Saving clean history', err);
        }
    }

    // Construct a command to set power level based on an RVC Clean Mode
    makePowerCommand(cleanMode: RvcCleanMode360): Device360Command {
        const map = this.getPowerLevelMaps().find(([, m]) => m === cleanMode);
        assertIsDefined(map);
        const powerLevel = map[0];
        return {
            description:    map[0],
            command:        () => this.setPowerLevel(powerLevel),
            condition:      () => this.getPowerLevel() === powerLevel
        };
    }

    // The power level to report in the RVC Clean Mode cluster.
    //
    // While cleaning, report what is actually running rather than the configured
    // default: the Vis Nav lets a zone carry its own cleaning strategy, so a
    // clean can run at a level the default never mentions, and reporting the
    // default would have the accessory claim a mode the robot is not using.
    // Outside a clean there is nothing running, so the default is what applies
    // next, and it is also what a mode change writes.
    reportedPowerLevel(status: DysonMqttStatus<DysonMqttStatus360>): Dyson360PowerLevel | undefined {
        const { runMode } = mapState(status.state);
        if (runMode !== RvcRunMode360.Idle) {
            const current = this.getCurrentPowerLevel();
            // Ignore a level the cluster does not advertise; it has no mode to map to
            if (current !== undefined && this.getPowerLevelMaps().some(([level]) => level === current)) {
                if (current !== this.getPowerLevel()) {
                    this.log.debug(`Running at ${current}, which differs from the default`
                                 + ` ${this.getPowerLevel() ?? 'unknown'}`);
                }
                return current;
            }
        }
        return this.getPowerLevel();
    }

    // Map a Dyson power mode to its corresponding RVC Clean Mode
    powerModeToCleanMode(powerMode?: string | number): RvcCleanMode360 {
        const map = this.getPowerLevelMaps().find(([m]) => m === powerMode);
        assertIsDefined(map);
        return map[1];
    }

    // Update cluster attributes when the MQTT status is updated
    @ifValueChanged
    async updateClusterAttributes(status: DysonMqttStatus<DysonMqttStatus360>): Promise<void> {
        assertIsDefined(this.endpoint);

        // Start or clear the grace period for an unresponsive device
        this.trackReachability(status.reachable);

        // Map the state to cluster attribute values
        const faults = mapDyson360Faults(this.log, status.state, status.faults, status.activeFaults);
        const cleanMode         = this.powerModeToCleanMode(this.reportedPowerLevel(status));
        const { runMode }       = mapState(status.state);
        const operationalState  = this.mapOperationalState(status, faults);
        const batteryStatus     = this.mapBatteryStatus(status, faults);

        // Update all of the clusters
        await Promise.all([
            this.endpoint.updateReachable(status.reachable),
            this.endpoint.updateRvcCleanMode(cleanMode),
            this.endpoint.updateRvcRunMode(runMode),
            this.endpoint.updateRvcOperationalState(operationalState),
            this.endpoint.updatePowerSource(batteryStatus)
        ]);

        // Check for the end of a clean (except for Spot+Scrub Ai)
        const prevRunMode = this.runMode;
        this.runMode = runMode;
        if (runMode === RvcRunMode360.Idle && prevRunMode === RvcRunMode360.Cleaning) {
            if (status.cleanId) await this.logCompletedClean(status.cleanId, status.cleanDuration);
        }
    }

    // Track how long the device has been unreachable.
    //
    // No further MQTT status arrives once the device stops responding, so the
    // expiry of the grace period has to be driven by a timer; otherwise the
    // last known activity would be reported indefinitely.
    trackReachability(reachable: boolean): void {
        if (reachable) {
            if (this.unreachableSince !== undefined) {
                this.log.info('Device is responding again');
            }
            clearTimeout(this.unreachableTimer);
            this.unreachableTimer = undefined;
            this.unreachableSince = undefined;
        } else if (this.unreachableSince === undefined) {
            this.unreachableSince = Date.now();
            this.unreachableTimer = globalThis.setTimeout(() => {
                this.log.warn(`Device has not responded for ${formatMilliseconds(this.unreachableGrace)};`
                            + ' reporting its activity as unknown');
                // Re-run the mapping so the clusters stop reporting stale activity.
                // Nothing awaits this timer, so it has to contain its own
                // failures: an unhandled rejection here would take Homebridge
                // down over a robot that merely stopped answering.
                this.updateClusterAttributes(this.mqtt.status)
                    .catch((err: unknown) => { logError(this.log, 'Unreachable timeout', err); });
            }, this.unreachableGrace);
            this.unreachableTimer.unref();

        }
    }

    // Whether the device has been unreachable for longer than the grace period
    get unreachableExpired(): boolean {
        return this.unreachableSince !== undefined
            && this.unreachableGrace <= Date.now() - this.unreachableSince;
    }

    // Convert the battery status to Power Source cluster attributes
    mapBatteryStatus(
        status: DysonMqttStatus<DysonMqttStatus360>,
        faults: Dyson360MappedFaults
    ): UpdatePowerSource360 {
        const { operationalState, isDocked } = mapState(status.state);
        const { batteryChargeLevel } = status;
        const { activeBatFaults, activeBatChargeFaults } = faults;
        if (!isDocked) activeBatChargeFaults.length = 0;
        return batteryChargeLevel === undefined ? {
            activeBatFaults,
            activeBatChargeFaults,
            batPercentRemaining:    null,
            batChargeLevel:         PowerSource.BatChargeLevel.Ok,
            batChargeState:         PowerSource.BatChargeState[
                (operationalState === RvcOperationalState.OperationalState.Charging) ? 'IsCharging' : 'IsNotCharging'],
            status:                 PowerSource.PowerSourceStatus.Unspecified

        } :{
            activeBatFaults,
            activeBatChargeFaults,
            batPercentRemaining:    batteryChargeLevel * 2, // ×2, e.g. 200 for 100%
            batChargeLevel:         PowerSource.BatChargeLevel[
                batteryChargeLevel < BATTERY_THRESHOLD_CRITICAL ? 'Critical'
                : batteryChargeLevel < BATTERY_THRESHOLD_WARNING ? 'Warning' : 'Ok'],
            batChargeState:         PowerSource.BatChargeState[
                (operationalState === RvcOperationalState.OperationalState.Charging) ? 'IsCharging'
                : batteryChargeLevel < BATTERY_THRESHOLD_FULL ? 'IsNotCharging' : 'IsAtFullCharge'],
            status:                 PowerSource.PowerSourceStatus.Active
        };
    }

    // Convert the status to RVC Operational State cluster attributes
    mapOperationalState(
        status: DysonMqttStatus<DysonMqttStatus360>,
        faults: Dyson360MappedFaults
    ): UpdateRvcOperationalState360 {
        const mappedState = mapState(status.state);
        const isActive = mappedState.runMode !== RvcRunMode360.Idle;

        // A device that stopped responding long ago tells us nothing about what
        // it is doing now, so report the uncertainty rather than repeating the
        // last thing we saw. Matter has no "unknown" operational state, so this
        // uses a manufacturer-specific error, which controllers surface as a
        // problem with the accessory instead of as ongoing activity.
        if (this.unreachableExpired) {
            return {
                isActive:           false,
                operationalState:   RvcOperationalState.OperationalState.Error,
                operationalError:   {
                    errorStateId:       RvcOperationalState.ErrorState.OtherError,
                    errorStateLabel:    'Unreachable',
                    errorStateDetails:  'No response from the robot'
                }
            };
        }

        // Ensure consistent Operational State and Operational Error
        const { operationalError } = faults;
        let { operationalState } = mapState(status.state);
        if (operationalError.errorStateId !== RvcOperationalState.ErrorState.NoError) {
            // Force Error state if an error is being reported
            operationalState = RvcOperationalState.OperationalState.Error;
        } else {
            // Otherwise the state should not have been mapped to Error
            assert(operationalState !== RvcOperationalState.OperationalState.Error);
        }

        return { isActive, operationalState, operationalError };
    }
}