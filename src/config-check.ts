// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import { PlatformConfig } from 'homebridge';
import { AnsiLogger, LogLevel } from './logger.js';
import { checkers } from './ti/config-types.js';
import { CheckerT, IErrorDetail } from 'ts-interface-checker';
import { deepMerge, getValidationTree } from './utils.js';
import { DEFAULT_CONFIG, DEFAULT_COUNTRY, PLUGIN_NAME } from './settings.js';
import { Config, ProvisioningMethod } from './config-types.js';
import { inspect } from 'util';
import { INSPECT_VERBOSE } from './logger-options.js';

// Check that the configuration is valid
export function checkConfiguration(log: AnsiLogger, config: PlatformConfig): asserts config is Config & PlatformConfig {
    // Bring a pre-country configuration forward before anything validates it
    normaliseAccountCountry(log, config);

    // Apply default values
    Object.assign(config, deepMerge(DEFAULT_CONFIG, config));

    // Pick the most appropriate checker for the configuration
    const PROVISIONING_CHECKER = new Map<string, CheckerT<Config>>([
        ['Remote Account',  checkers.ConfigRemoteAccount],
        ['Mock Devices',    checkers.ConfigMock]
    ] satisfies [ProvisioningMethod, CheckerT<Config>][]);
    const checker = PROVISIONING_CHECKER.get(config.provisioningMethod as string) ?? checkers.Config;

    // Ensure that all required fields are provided and are of suitable types
    checker.setReportedPath('<PLATFORM_CONFIG>');
    const strictValidation = checker.strictValidate(config);
    if (!checker.test(config)) {
        log.error('Plugin configuration errors:');
        logCheckerValidation(log, config, LogLevel.ERROR, strictValidation);
        throw new Error('Invalid plugin configuration');
    }

    // Warn of extraneous fields in the configuration
    if (strictValidation) {
        log.warn('Unsupported fields in plugin configuration will be ignored:');
        logCheckerValidation(log, config, LogLevel.WARN, strictValidation);
    }
}

// Ensure the account carries a country, replacing the "china" flag it succeeded.
//
// Silent for the common case: almost every installation had the flag unset or
// absent, and naming a field those users never chose would be noise. Switching
// a Chinese account over is worth a line, because it is the one case where
// getting this wrong sends the login to the wrong host.
function normaliseAccountCountry(log: AnsiLogger, config: PlatformConfig): void {
    const account = config.dysonAccount as Record<string, unknown> | undefined;
    if (!account) return;

    const china = account.china === true;
    delete account.china;
    if (typeof account.country === 'string' && account.country.length) return;

    const country = china ? 'CN' : DEFAULT_COUNTRY;
    account.country = country;
    if (china) log.info(`MyDyson account country set to ${country} from the previous China setting`);
}

// Log configuration checker validation errors
function logCheckerValidation(log: AnsiLogger, config: PlatformConfig, level: LogLevel, errors: IErrorDetail[] | null): void {
    const errorLines = errors ? getValidationTree(errors) : [];
    errorLines.forEach(line => { log.log(level, line); });
    log.info(`${PLUGIN_NAME}.config.json:`);
    const configLines = inspect(config, INSPECT_VERBOSE).split('\n');
    configLines.forEach(line => { log.info(`    ${line}`); });
}