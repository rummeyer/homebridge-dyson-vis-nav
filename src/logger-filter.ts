// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import { AnsiLogger, LogLevel } from './logger.js';
import { formatList } from './utils.js';
import { DebugFeatures } from './config-types.js';

// Regular expressions for different types of sensitive data
const REGEXP_SERIAL_NUMBER = /[A-Z0-9]{3}-[A-Z]{2}-[A-Z0-9]{8}/g;
const REGEXP_CLOUD_TOKEN   = /[0-9A-F]{64}-1/g;
const REGEXP_EMAIL         = /[\w-.]+@([\w-]+\.)+[\w-]+/g;

// A logger that redacts sensitive data before passing messages on.
//
// Homebridge's `Logging` is a callable interface rather than a class, so this
// wraps a delegate instead of extending it as the Matterbridge original did.
export class FilterLogger implements AnsiLogger {

    // Configuration
    config = new Set<DebugFeatures>();

    // Create a new logger
    constructor(readonly delegate: AnsiLogger) {}

    // Log a message with sensitive data filtered
    log(level: LogLevel, message: string, ...parameters: unknown[]): void {
        // Allow debug messages to be logged as a different level
        if (level === LogLevel.DEBUG && this.config.has('Log Debug as Info')) {
            level = LogLevel.INFO;
        }

        // Filter the log message and parameters
        const filteredMessage    = this.filterString(message).filtered;
        const filteredParameters = parameters.map(p => this.filterSensitive(p));
        this.delegate.log(level, filteredMessage, ...filteredParameters);
    }

    info   (message: string, ...parameters: unknown[]): void { this.log(LogLevel.INFO,    message, ...parameters); }
    success(message: string, ...parameters: unknown[]): void { this.log(LogLevel.SUCCESS, message, ...parameters); }
    warn   (message: string, ...parameters: unknown[]): void { this.log(LogLevel.WARN,    message, ...parameters); }
    error  (message: string, ...parameters: unknown[]): void { this.log(LogLevel.ERROR,   message, ...parameters); }
    debug  (message: string, ...parameters: unknown[]): void { this.log(LogLevel.DEBUG,   message, ...parameters); }

    // Apply configuration
    configure(config: DebugFeatures[]): void {
        for (const feature of config) this.config.add(feature);
    }

    // Filter sensitive data within a log message or parameter
    filterSensitive<T>(value: T): string | T {
        const { filtered, redacted } = this.filterString(String(value));
        let jsonRedacted = true;
        try { jsonRedacted = this.filterString(JSON.stringify(value)).redacted; } catch { /* empty */ }
        return redacted || jsonRedacted ? filtered : value;
    }

    // Filter sensitive data within a string
    filterString(value: string): { filtered: string, redacted: boolean } {
        let filtered = value
            .replace(REGEXP_CLOUD_TOKEN, v => maskToken('TOKEN',    v))
            .replace(REGEXP_EMAIL,       v => maskToken('EMAIL',    v));
        if (!this.config.has('Log Serial Numbers')) {
            filtered = filtered.replace(REGEXP_SERIAL_NUMBER, v => maskToken('SERIAL_NUMBER', v));
        }
        return { filtered, redacted: filtered !== value };
    }
}

// Mask a token, leaving just the first and final few characters
function maskToken(type: string, token: string, details: Record<string, string> = {}): string {
    let masked = `${token.slice(0, 4)}...${token.slice(-8)}`;
    const parts = Object.entries(details).map(([key, value]) => `${key}=${value}`);
    if (parts.length) masked += ` (${formatList(parts)})`;
    return `<${type}: ${masked}>`;
}
