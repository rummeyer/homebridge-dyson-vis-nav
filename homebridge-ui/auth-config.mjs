// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer

import { DEFAULT_CONFIG } from '../dist/settings.js';

// Build the plugin configuration the Dyson cloud client runs against.
//
// The client reads plugin settings while making requests — `debugFeatures` is
// consulted on every single one — so a hand-rolled stub silently breaks the
// whole flow: the first request throws before reaching Dyson, and the user sees
// no email rather than an explanation. Deriving it from DEFAULT_CONFIG keeps
// this in step with the plugin itself. Kept in its own module so the checks in
// bin/ can verify it against what the cloud layer actually reads.
export function makeAuthConfig(overrides = {}) {
    return {
        ...DEFAULT_CONFIG,
        provisioningMethod: 'Remote Account',
        debugFeatures:      [],
        ...overrides
    };
}
