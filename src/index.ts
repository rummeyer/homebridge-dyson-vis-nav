// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import type { API } from 'homebridge';
import { PlatformDyson } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

// Register the platform with Homebridge
export default (api: API): void => {
    api.registerPlatform(PLATFORM_NAME, PlatformDyson);
};
