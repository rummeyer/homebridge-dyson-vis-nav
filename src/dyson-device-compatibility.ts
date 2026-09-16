// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import { AnsiLogger, LogLevel } from './logger.js';
import { PLUGIN_VERSION } from './settings.js';
import { Config } from './config-types.js';

// The MQTT root topic of the only model this plugin supports
const SUPPORTED_TOPIC = '277'; // Dyson 360 Vis Nav (RB03)

// Where to report problems
const NEW_ISSUE_URL = 'https://github.com/rummeyer/homebridge-dyson-vis-nav/issues/new';

/* eslint-disable max-len */

// Warning for a device this plugin does not claim to support
const COMPATIBILITY_UNSUPPORTED =
`<PRODUCT> is not a Dyson 360 Vis Nav, and is not supported by this plugin.

The Dyson protocol handling is shared with other robot vacuums, so it may partly work, but there is a high likelihood of warnings, errors, or missing functionality.

If you want support for this model, please open an issue and attach a log captured with "Log MQTT Payloads as JSON" enabled:
    <ISSUE_URL>`;

// Message for the supported model
const COMPATIBILITY_SUPPORTED =
`No known compatibility issues for <PRODUCT>. If problems occur, please open an issue and attach a log captured with "Log MQTT Payloads as JSON" enabled:
    <ISSUE_URL>`;

/* eslint-enable max-len */

// Generate log messages relating to device compatibility.
//
// The Matterbridge original maintains a compatibility table for a dozen models
// and parses it out of its README at runtime. This plugin supports exactly one
// model, so the check is reduced to that.
export class DysonDeviceCompatibility {

    // Template placeholder substitutions
    readonly substitutions = new Map<string, string>();

    // Create a new compatibility message generator
    constructor(
        readonly log:       AnsiLogger,
        readonly config:    Config,
        readonly product:   string,
        readonly topic:     string,
        readonly firmware?: string
    ) {
        this.substitutions.set('<PRODUCT>',    product);
        this.substitutions.set('<TOPIC>',      topic);
        this.substitutions.set('<ISSUE_URL>',  this.makeIssueURL());
    }

    // Substitute any placeholders in the message and log it
    logCompatibility(message?: string): void {
        const suppressWarningDuringTesting = this.config.provisioningMethod === 'Mock Devices';
        const level = suppressWarningDuringTesting || !message ? LogLevel.INFO : LogLevel.WARN;
        const logMessage = this.replacePlaceholders(message ?? COMPATIBILITY_SUPPORTED);
        for (const line of logMessage.split('\n')) this.log.log(level, line);
    }

    // Retrieve any compatibility warning for this device
    get warning(): string | undefined {
        return this.topic === SUPPORTED_TOPIC ? undefined : COMPATIBILITY_UNSUPPORTED;
    }

    // Substitute any placeholders in the message template
    replacePlaceholders(message: string): string {
        for (const [key, value] of this.substitutions) message = message.replaceAll(key, value);
        return message.trim();
    }

    // Generate a URL for creating a new GitHub issue
    makeIssueURL(): string {
        const url = new URL(NEW_ISSUE_URL);
        url.searchParams.set('labels',      'bug');
        url.searchParams.set('version',     PLUGIN_VERSION);
        url.searchParams.set('appliance',   this.product);
        url.searchParams.set('topic',       this.topic);
        if (this.firmware) url.searchParams.set('firmware', this.firmware);
        return url.href;
    }
}
