// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Config } from './config-types.js';

// Read the package.json file
interface PackageJson {
    engines:        Record<string, string>;
    name:           string;
    displayName:    string;
    version:        string;
    homepage:       string;
}
const PACKAGE_JSON = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const PACKAGE = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8')) as PackageJson;

// Platform identifiers
export const ENGINES        = PACKAGE.engines;
export const PLUGIN_NAME    = PACKAGE.name;
export const PLUGIN_VERSION = PACKAGE.version;
export const PLUGIN_URL     = PACKAGE.homepage;

// The platform name registered with Homebridge. This must match the
// `pluginAlias` in config.schema.json and the `platform` key in config.json,
// so unlike the other identifiers it is a literal rather than derived from
// package.json: changing the display name must not orphan existing configs.
export const PLATFORM_NAME  = 'DysonVisNav';

// Default configuration options.
//
// Upstream seeds a Dyson account token here from a DYSON_TOKEN environment
// variable, for its own integration testing. That is deliberately not carried
// over: an undocumented environment variable that silently supplies credentials
// is worth removing rather than explaining, and this plugin has one documented
// way in — the authorisation flow in the settings UI, which stores its token in
// the plugin's own storage.
// Used when a configuration predates the country field, and as the schema default
export const DEFAULT_COUNTRY = 'GB';

export const DEFAULT_CONFIG: Readonly<Partial<Config>> = {
    whiteList:              [],
    provisioningMethod:     'Remote Account',
    wildcardTopic:          false,
    simpleModeTagsRvc:      true,
    logMapStyle:            'Off',
    unreachableTimeout:     120,
    debug:                  false,
    debugFeatures:          []
};

// Vendor name
export const VENDOR_NAME = 'Dyson';
export const VENDOR_ID   = 0x139E; // Dyson's official Matter Vendor ID
