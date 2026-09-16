// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

// Configuration methods.
//
// The Dyson 360 Vis Nav does not accept local MQTT connections, so unlike the
// Matterbridge original this plugin only offers the cloud provisioning method,
// plus a mock mode that replays a recorded MQTT session for development.
export type ProvisioningMethod =
    'Remote Account'
  | 'Mock Devices';

// Dyson account configuration
export interface DysonAccountBase {
    china:                  boolean;
    // Dummy values corresponding to action buttons
    finishAuth?:            boolean,
    startAuth?:             boolean
}
export interface DysonAccountLogin extends DysonAccountBase {
    email:                  string;
    password:               string;
}
export interface DysonAccountToken extends DysonAccountBase {
    token:                  string;
    email?:                 string;
    password?:              string;
}
export type DysonAccount = DysonAccountLogin | DysonAccountToken;

// Mock device configuration
export interface DeviceConfigMock {
    name:                   string;
    filename:               string;
    serialNumber:           string;
    rootTopic:              string;
}

// Robot vacuum map logging style
export type LogMapStyle =
    'Off'
  | 'Monospaced'
  | 'Homebridge';

// Debugging features
export type DebugFeatures =
    'Log API Headers'
  | 'Log API Bodies'
  | 'Log MQTT Client'
  | 'Log MQTT Payloads'
  | 'Log MQTT Payloads as JSON'
  | 'Log Serial Numbers'
  | 'Log Debug as Info';

// The user plugin configuration
export interface ConfigBase {
    // Homebridge additions
    platform:               string;
    name?:                  string;
    // Device filtering, by serial number
    whiteList:              string[];
    blackList:              string[];
    // Plugin configuration
    provisioningMethod:     ProvisioningMethod;
    simpleModeTagsRvc:      boolean;
    wildcardTopic:          boolean;
    logMapStyle:            LogMapStyle;
    statusPollInterval:     number;
    debug:                  boolean;
    debugFeatures:          DebugFeatures[];
}
export interface ConfigRemoteAccount extends ConfigBase {
    provisioningMethod:     'Remote Account';
    dysonAccount:           DysonAccount;
}
export interface ConfigMock extends ConfigBase {
    provisioningMethod:     'Mock Devices';
    devices:                DeviceConfigMock[];
    dysonAccount?:          DysonAccount; // (ignored if present)
}
export type Config = ConfigRemoteAccount | ConfigMock;
