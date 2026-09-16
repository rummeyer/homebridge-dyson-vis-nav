// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import { API } from 'homebridge';
import { AnsiLogger } from './logger.js';
import { ENGINES, PLUGIN_NAME, PLUGIN_VERSION } from './settings.js';
import semver from 'semver';

// Log critical package and API versions
export function checkDependencyVersions(log: AnsiLogger, api: API): void {
    const versions: [string, string | number, string | undefined][] = [
        // Name             Current version             Required version
        [PLUGIN_NAME,       PLUGIN_VERSION,             undefined       ],
        ['Node.js',         process.versions.node,      ENGINES.node    ],
        ['Homebridge',      api.serverVersion,          ENGINES.homebridge]
    ];

    // Log/check each version against the requirements
    versions.forEach(([name, current, required]) => {
        const semverCurrent = semver.coerce(current);
        if (!required) {
            log.info(`${name} version ${current}`);
        } else if (semverCurrent === null) {
            log.warn(`${name} version ${current} cannot be coerced to semver (require ${required})`);
        } else if (semver.satisfies(semverCurrent, required)) {
            log.info(`${name} version ${current} (satisfies ${required})`);
        } else {
            log.error(`${name} version ${current} is incompatible (require ${required})`);
        }
    });
}
