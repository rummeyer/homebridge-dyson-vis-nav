// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import {
    ModeBase,
    RvcOperationalState,
    ServiceArea
} from './matter-clusters.js';

// A manufacturer-specific RVC Operational State error code
export const VENDOR_ERROR_360 = RvcOperationalState.VENDOR_ERROR;

// RVC Operational State errors
export class RvcOperationalStateError extends Error {

    // Create a new error
    constructor(
        readonly id:        RvcOperationalState.ErrorState,
        readonly label?:    string, // (if a manufacturer-specific id, otherwise undefined)
        readonly details?:  string,
        options?:           ErrorOptions
    ) {
        const idName: string = RvcOperationalState.ErrorState[id];
        let message = label ?? idName;
        if (details) message += ` (${details})`;
        super(message, options);
        Error.captureStackTrace(this, RvcOperationalStateError);
        this.name = `RvcOperationalStateError[${idName}]`;
    }

    // Convert an arbitrary error (or nullish for success) to an ErrorStateStruct
    static toStruct(err?: unknown, defaultId: RvcOperationalState.ErrorState = VENDOR_ERROR_360): RvcOperationalState.ErrorStateStruct {
        return err instanceof RvcOperationalStateError ? {
            errorStateId:       err.id,
            errorStateLabel:    err.label  ?.substring(0, 64) ?? undefined,
            errorStateDetails:  err.details?.substring(0, 64) ?? ''
        } : err ? {
            errorStateId:       defaultId,
            errorStateLabel:    err instanceof Error ? err.message.substring(0, 64) : 'Unknown error',
            errorStateDetails:  ''
        } : {
            errorStateId:       RvcOperationalState.ErrorState.NoError,
            errorStateDetails:  ''
        };
    }

    // Helper function to create a new error class with a specific status code
    static create(
        idName: keyof typeof RvcOperationalState.ErrorState
    ): new (details?: string, options?: ErrorOptions) => RvcOperationalStateError {
        return class extends RvcOperationalStateError {
            constructor(details?: string, options?: ErrorOptions) {
                const id = RvcOperationalState.ErrorState[idName];
                super(id, undefined, details, options);
            }
        };
    }

    // Standard error codes defined by the RVC Operational State Cluster
    static readonly NoError                   = this.create('NoError');
    static readonly UnableToStartOrResume     = this.create('UnableToStartOrResume');
    static readonly UnableToCompleteOperation = this.create('UnableToCompleteOperation');
    static readonly CommandInvalidInState     = this.create('CommandInvalidInState');
    static readonly FailedToFindChargingDock  = this.create('FailedToFindChargingDock');
    static readonly Stuck                     = this.create('Stuck');
    static readonly DustBinMissing            = this.create('DustBinMissing');
    static readonly DustBinFull               = this.create('DustBinFull');
    static readonly WaterTankEmpty            = this.create('WaterTankEmpty');
    static readonly WaterTankMissing          = this.create('WaterTankMissing');
    static readonly WaterTankLidOpen          = this.create('WaterTankLidOpen');
    static readonly MopCleaningPadMissing     = this.create('MopCleaningPadMissing');
    static readonly LowBattery                = this.create('LowBattery');
    static readonly CannotReachTargetArea     = this.create('CannotReachTargetArea');
    static readonly DirtyWaterTankFull        = this.create('DirtyWaterTankFull');
    static readonly DirtyWaterTankMissing     = this.create('DirtyWaterTankMissing');
    static readonly WheelsJammed              = this.create('WheelsJammed');
    static readonly BrushJammed               = this.create('BrushJammed');
    static readonly NavigationSensorObscured  = this.create('NavigationSensorObscured');
}

// RVC Clean/Run Mode ChangeToMode errors
export class ChangeToModeError extends Error {

    // Create a new error
    constructor(
        readonly status:    ModeBase.ModeChangeStatus,
        message?:           string,
        options?:           ErrorOptions
    ) {
        super(message, options);
        Error.captureStackTrace(this, ChangeToModeError);
        const statusName: string = ModeBase.ModeChangeStatus[status];
        this.name = `ChangeToModeError[${statusName}]`;
    }

    // Helper function to create a new error class with a specific status code
    static create(
        statusName: keyof typeof ModeBase.ModeChangeStatus
    ): new (message?: string, options?: ErrorOptions) => ChangeToModeError {
        const statusCode = ModeBase.ModeChangeStatus[statusName];
        return class extends ChangeToModeError {
            constructor(message?: string, options?: ErrorOptions) {
                message ??= `ChangeToMode status ${statusName}`;
                super(statusCode, message, options);
            }
        };
    }

    // Standard status codes defined by the Mode Base Cluster
    static readonly Success         = this.create('Success');
    static readonly UnsupportedMode = this.create('UnsupportedMode');
    static readonly GenericFailure  = this.create('GenericFailure');
    static readonly InvalidInMode   = this.create('InvalidInMode');
}

// Service Area SelectAreas errors
export class SelectAreaError extends Error {

    // Create a new error
    constructor(readonly status: ServiceArea.SelectAreasStatus, message?: string, options?: ErrorOptions) {
        super(message, options);
        Error.captureStackTrace(this, SelectAreaError);
        const statusName: string = ServiceArea.SelectAreasStatus[status];
        this.name = `SelectAreaError[${statusName}]`;
    }

    // Helper function to create a new error class with a specific status code
    static create(
        statusName: keyof typeof ServiceArea.SelectAreasStatus
    ): new (message?: string, options?: ErrorOptions) => SelectAreaError {
        const statusCode = ServiceArea.SelectAreasStatus[statusName];
        return class extends SelectAreaError {
            constructor(message?: string, options?: ErrorOptions) {
                message ??= `SelectArea status ${statusName}`;
                super(statusCode, message, options);
            }
        };
    }

    // Standard status codes defined by the Service Area cluster
    static readonly Success         = this.create('Success');
    static readonly UnsupportedArea = this.create('UnsupportedArea');
    static readonly InvalidInMode   = this.create('InvalidInMode');
    static readonly InvalidSet      = this.create('InvalidSet');
}
