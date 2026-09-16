// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer

// Verifies that the configuration the custom UI hands to the Dyson cloud client
// provides every plugin setting that client actually reads.
//
// The cloud layer consults plugin settings while making requests — debugFeatures
// on every single one — so a missing field throws a TypeError before the first
// request leaves the machine. The user-visible symptom is simply that no email
// arrives, which points nowhere near the cause, so this is worth pinning down
// mechanically rather than by inspection.
//
// Fields are discovered by scanning the cloud sources, so a new setting used
// there fails this check instead of reaching users.

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { makeAuthConfig } from '../homebridge-ui/auth-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');

// The sources reachable from the authorisation flow
const cloudSources = readdirSync(srcDir).filter(f => f.startsWith('dyson-cloud') && f.endsWith('.ts'));

const used = new Set();
for (const file of cloudSources) {
    const text = readFileSync(join(srcDir, file), 'utf-8');
    for (const m of text.matchAll(/\bthis\.config\.([a-zA-Z][\w]*)/g)) used.add(m[1]);
    for (const m of text.matchAll(/(?<!\.)\bconfig\.([a-zA-Z][\w]*)/g))  used.add(m[1]);
}

// Settings the flow supplies by other means rather than through the config
const suppliedElsewhere = new Set(['dysonAccount']);

const config = makeAuthConfig();
const missing = [...used]
    .filter(field => !suppliedElsewhere.has(field))
    .filter(field => config[field] === undefined)
    .sort();

console.log(`Scanned ${cloudSources.length} cloud sources; settings read: ${[...used].sort().join(', ')}`);

if (missing.length) {
    console.error('Custom UI auth config check failed:');
    for (const field of missing) {
        console.error(`  ✘ makeAuthConfig() does not provide "${field}", which the Dyson cloud client reads`);
    }
    console.error('    The first request would throw before reaching Dyson, and no email would be sent.');
    process.exit(1);
}
console.log('Custom UI auth config check passed');
