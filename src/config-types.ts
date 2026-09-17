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

// Dyson account configuration.
//
// The country selects the API host (mainland China has its own) and supplies
// the country and culture that per-device endpoints ask for. It replaced a
// plain "china" flag, which could only ever say which of two hosts to use.
export interface DysonAccountBase {
    country:                string;
}

// The password is needed only to exchange the emailed code for a token, and the
// token is held in the plugin's own storage keyed by email address. So once an
// account is authorised the password may be removed from the configuration,
// which is why it is optional here — the authorisation flow checks for it
// separately, at the point where it is actually required.
export interface DysonAccountLogin extends DysonAccountBase {
    email:                  string;
    password?:              string;
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
    // Only these serial numbers are exposed; empty means all of them
    whiteList:              string[];
    // Plugin configuration
    provisioningMethod:     ProvisioningMethod;
    simpleModeTagsRvc:      boolean;
    wildcardTopic:          boolean;
    logMapStyle:            LogMapStyle;
    // Seconds the robot may stay unreachable before its activity is reported as
    // unknown instead of repeating the last state seen.
    unreachableTimeout:     number;
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
