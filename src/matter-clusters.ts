// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

// Matter cluster enumerations and struct types used by this plugin.
//
// Homebridge's Matter cluster state interfaces (`ClusterStateMap`) type every
// enumerated attribute as a plain `number`, so the values below are all this
// plugin needs. Defining them here rather than importing `@matter/main` keeps
// matter.js out of the build: Homebridge owns that dependency, and a second
// copy resolved through this plugin could drift from the one actually running.
//
// Values are from the Matter specification, cross-checked against
// @matter/main 0.17.9 (the version Homebridge 2.4.0 bundles).

// ── Power Source cluster ──────────────────────────────────────────────────

export namespace PowerSource {

    export enum PowerSourceStatus {
        Unspecified         = 0,
        Active              = 1,
        Standby             = 2,
        Unavailable         = 3
    }

    export enum BatChargeLevel {
        Ok                  = 0,
        Warning             = 1,
        Critical            = 2
    }

    export enum BatReplaceability {
        Unspecified         = 0,
        NotReplaceable      = 1,
        UserReplaceable     = 2,
        FactoryReplaceable  = 3
    }

    export enum BatChargeState {
        Unknown             = 0,
        IsCharging          = 1,
        IsAtFullCharge      = 2,
        IsNotCharging       = 3
    }

    export enum BatFault {
        Unspecified         = 0,
        OverTemp            = 1,
        UnderTemp           = 2
    }

    export enum BatChargeFault {
        Unspecified         = 0,
        AmbientTooHot       = 1,
        AmbientTooCold      = 2,
        BatteryTooHot       = 3,
        BatteryTooCold      = 4,
        BatteryAbsent       = 5,
        BatteryOverVoltage  = 6,
        BatteryUnderVoltage = 7,
        ChargerOverVoltage  = 8,
        ChargerUnderVoltage = 9,
        SafetyTimeout       = 10
    }
}

// ── RVC Operational State cluster ─────────────────────────────────────────

export namespace RvcOperationalState {

    export enum OperationalState {
        Stopped             = 0,
        Running             = 1,
        Paused              = 2,
        Error               = 3,
        SeekingCharger      = 64,
        Charging            = 65,
        Docked              = 66,
        EmptyingDustBin     = 67,
        CleaningMop         = 68,
        FillingWaterTank    = 69,
        UpdatingMaps        = 70
    }

    export enum ErrorState {
        NoError                     = 0,
        UnableToStartOrResume       = 1,
        UnableToCompleteOperation   = 2,
        CommandInvalidInState       = 3,
        FailedToFindChargingDock    = 64,
        Stuck                       = 65,
        DustBinMissing              = 66,
        DustBinFull                 = 67,
        WaterTankEmpty              = 68,
        WaterTankMissing            = 69,
        WaterTankLidOpen            = 70,
        MopCleaningPadMissing       = 71,
        LowBattery                  = 72,
        CannotReachTargetArea       = 73,
        DirtyWaterTankFull          = 74,
        DirtyWaterTankMissing       = 75,
        WheelsJammed                = 76,
        BrushJammed                 = 77,
        NavigationSensorObscured    = 78,

        // A manufacturer-specific value, used for Dyson faults that have no
        // Matter-defined equivalent. The specification reserves 0x80 and above
        // for manufacturer extensions. The Matterbridge original adds this to
        // the matter.js schema at runtime; declaring it here keeps comparisons
        // against it type-safe.
        OtherError                  = 0x80
    }

    export const VENDOR_ERROR = ErrorState.OtherError;

    export interface ErrorStateStruct {
        errorStateId:       ErrorState;
        errorStateLabel?:   string;
        errorStateDetails?: string;
    }
}

// ── Service Area cluster ──────────────────────────────────────────────────

export namespace ServiceArea {

    export enum SelectAreasStatus {
        Success             = 0,
        UnsupportedArea     = 1,
        InvalidInMode       = 2,
        InvalidSet          = 3
    }

    export enum OperationalStatus {
        Pending             = 0,
        Operating           = 1,
        Skipped             = 2,
        Completed           = 3
    }

    export interface LocationInfo {
        locationName:       string;
        floorNumber:        number | null;
        areaType:           number | null;
    }

    export interface AreaInfo {
        locationInfo:       LocationInfo | null;
        landmarkInfo:       null;
    }

    export interface Area {
        areaId:             number;
        mapId:              number | null;
        areaInfo:           AreaInfo;
    }

    export interface Map {
        mapId:              number;
        name:               string;
    }

    export interface Progress {
        areaId:             number;
        status:             OperationalStatus;
        totalOperationalTime?: number | null;
    }
}

// ── Mode Base (shared by RVC Run Mode and RVC Clean Mode) ─────────────────

export namespace ModeBase {

    export interface ModeTag {
        value:              number;
    }

    export interface ModeOption {
        label:              string;
        mode:               number;
        modeTags:           ModeTag[];
    }

    export interface ChangeToModeRequest {
        newMode:            number;
    }

    // Status codes returned by the ChangeToMode command
    export enum ModeChangeStatus {
        Success             = 0,
        UnsupportedMode     = 1,
        GenericFailure      = 2,
        InvalidInMode       = 3
    }
}

// RVC Run Mode cluster mode tags. Values 0-9 are the tags common to every
// ModeBase-derived cluster; 0x4000 and above are cluster-specific.
export namespace RvcRunMode {
    export enum ModeTag {
        Auto                = 0,
        Quick               = 1,
        Quiet               = 2,
        LowNoise            = 3,
        LowEnergy           = 4,
        Vacation            = 5,
        Min                 = 6,
        Max                 = 7,
        Night               = 8,
        Day                 = 9,
        Idle                = 0x4000,
        Cleaning            = 0x4001,
        Mapping             = 0x4002
    }
}

// RVC Clean Mode cluster mode tags
export namespace RvcCleanMode {
    export enum ModeTag {
        Auto                = 0,
        Quick               = 1,
        Quiet               = 2,
        LowNoise            = 3,
        LowEnergy           = 4,
        Vacation            = 5,
        Min                 = 6,
        Max                 = 7,
        Night               = 8,
        Day                 = 9,
        DeepClean           = 0x4000,
        Vacuum              = 0x4001,
        Mop                 = 0x4002,
        VacuumThenMop       = 0x4003
    }
}

// ── Basic Information cluster ─────────────────────────────────────────────

export namespace BasicInformation {

    export enum ProductFinish {
        Other               = 0,
        Matte               = 1,
        Satin               = 2,
        Polished            = 3,
        Rugged              = 4,
        Fabric              = 5
    }

    export enum Color {
        Black               = 0,
        Navy                = 1,
        Green               = 2,
        Teal                = 3,
        Maroon              = 4,
        Purple              = 5,
        Olive               = 6,
        Gray                = 7,
        Blue                = 8,
        Lime                = 9,
        Aqua                = 10,
        Red                 = 11,
        Fuchsia             = 12,
        Yellow              = 13,
        White               = 14,
        Nickel              = 15,
        Chrome              = 16,
        Brass               = 17,
        Copper              = 18,
        Silver              = 19,
        Gold                = 20
    }

    export interface ProductAppearance {
        finish:             ProductFinish;
        primaryColor:       Color | null;
    }
}

// ── Semantic tags ─────────────────────────────────────────────────────────

// A Matter semantic tag, as consumed by the Service Area cluster's `areaType`.
export interface Semtag {
    namespaceId:            number;
    mfgCode:                number | null;
    tag:                    number;
    label:                  string;
}

// The subset of the Common Area namespace (id 16) that Dyson zone icons map on
// to. Shaped like matter.js's `CommonAreaNamespaceTag` so the zone mapping code
// reads identically to the Matterbridge original.
const commonAreaTag = (tag: number, label: string): Semtag =>
    ({ namespaceId: 0x10, mfgCode: null, tag, label });

export const CommonAreaNamespaceTag = {
    Balcony:        commonAreaTag(4,  'Balcony'),
    Bathroom:       commonAreaTag(6,  'Bathroom'),
    Bedroom:        commonAreaTag(7,  'Bedroom'),
    Dining:         commonAreaTag(21, 'Dining'),
    GuestBedroom:   commonAreaTag(39, 'GuestBedroom'),
    Hallway:        commonAreaTag(43, 'Hallway'),
    Kitchen:        commonAreaTag(47, 'Kitchen'),
    LivingRoom:     commonAreaTag(52, 'LivingRoom'),
    Office:         commonAreaTag(58, 'Office'),
    PrimaryBedroom: commonAreaTag(69, 'PrimaryBedroom'),
    Study:          commonAreaTag(88, 'Study'),
    UtilityRoom:    commonAreaTag(92, 'UtilityRoom'),
    Toilet:         commonAreaTag(95, 'Toilet')
} as const;

// ── Miscellaneous ─────────────────────────────────────────────────────────

// A Matter vendor identifier
export type VendorId = number;
export const VendorId = (id: number): VendorId => id;
