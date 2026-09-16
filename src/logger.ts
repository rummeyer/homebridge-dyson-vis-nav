// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

// Log levels, matching the string values used by Homebridge's own LogLevel.
//
// This is deliberately a plain string enum rather than a re-export of
// Homebridge's `LogLevel`: that one is a `const enum`, which cannot be imported
// as a value across package boundaries under `isolatedModules`.
export enum LogLevel {
    DEBUG   = 'debug',
    INFO    = 'info',
    SUCCESS = 'success',
    WARN    = 'warn',
    ERROR   = 'error'
}

// The logger interface used throughout this plugin.
//
// Structurally compatible with Homebridge's `Logging`, so a Homebridge logger
// can be passed directly wherever this type is expected. Named `AnsiLogger` to
// keep the ported Dyson layer unchanged from its Matterbridge original.
export interface AnsiLogger {
    info:    (message: string, ...parameters: unknown[]) => void;
    success: (message: string, ...parameters: unknown[]) => void;
    warn:    (message: string, ...parameters: unknown[]) => void;
    error:   (message: string, ...parameters: unknown[]) => void;
    debug:   (message: string, ...parameters: unknown[]) => void;
    log:     (level: LogLevel, message: string, ...parameters: unknown[]) => void;
}

// Adapt a Homebridge logger to the interface used by this plugin.
//
// Homebridge's `LogLevel` is a string `const enum`, which TypeScript treats as
// nominally distinct from the enum above even though the values are identical.
// Dispatching to the level-specific methods keeps the boundary type-safe rather
// than casting between the two enums.
export function adaptLogger(log: HomebridgeLogging): AnsiLogger {
    return {
        info:    (message, ...parameters) => { log.info   (message, ...parameters); },
        success: (message, ...parameters) => { log.success(message, ...parameters); },
        warn:    (message, ...parameters) => { log.warn   (message, ...parameters); },
        error:   (message, ...parameters) => { log.error  (message, ...parameters); },
        debug:   (message, ...parameters) => { log.debug  (message, ...parameters); },
        log:     (level, message, ...parameters) => {
            switch (level) {
            case LogLevel.DEBUG:    log.debug  (message, ...parameters); break;
            case LogLevel.SUCCESS:  log.success(message, ...parameters); break;
            case LogLevel.WARN:     log.warn   (message, ...parameters); break;
            case LogLevel.ERROR:    log.error  (message, ...parameters); break;
            case LogLevel.INFO:     log.info   (message, ...parameters); break;
            }
        }
    };
}

// The subset of Homebridge's `Logging` interface that `adaptLogger` requires.
// Declared structurally so this module needs no import from `homebridge`.
interface HomebridgeLogging {
    info:    (message: string, ...parameters: unknown[]) => void;
    success: (message: string, ...parameters: unknown[]) => void;
    warn:    (message: string, ...parameters: unknown[]) => void;
    error:   (message: string, ...parameters: unknown[]) => void;
    debug:   (message: string, ...parameters: unknown[]) => void;
}

// A logger that prepends a prefix to every message.
//
// Homebridge's `Logging` is a callable interface rather than a class, so unlike
// the Matterbridge original this wraps a delegate instead of extending it.
export class PrefixLogger implements AnsiLogger {

    // Create a new logger
    constructor(readonly delegate: AnsiLogger, readonly prefix: string) {}

    // Log a message with the prefix applied
    log(level: LogLevel, message: string, ...parameters: unknown[]): void {
        this.delegate.log(level, `[${this.prefix}] ${message}`, ...parameters);
    }

    info   (message: string, ...parameters: unknown[]): void { this.log(LogLevel.INFO,    message, ...parameters); }
    success(message: string, ...parameters: unknown[]): void { this.log(LogLevel.SUCCESS, message, ...parameters); }
    warn   (message: string, ...parameters: unknown[]): void { this.log(LogLevel.WARN,    message, ...parameters); }
    error  (message: string, ...parameters: unknown[]): void { this.log(LogLevel.ERROR,   message, ...parameters); }
    debug  (message: string, ...parameters: unknown[]): void { this.log(LogLevel.DEBUG,   message, ...parameters); }
}
