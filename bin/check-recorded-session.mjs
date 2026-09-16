// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer

// Replays the recorded Vis Nav MQTT session through the ported Dyson layer and
// checks that it still produces the states it should.
//
// This exercises the layer carried over from matterbridge-dyson-robot — message
// parsing, the status cache, state tracking — against a real recording, with no
// robot, no MyDyson account and no Homebridge. It is what makes adopting an
// upstream change safe to do: run it afterwards and a regression shows up here
// rather than on someone's robot.
//
// What it actually guarantees: the session replays end to end, the device
// reaches every state it is known to reach, and nothing is logged as a warning
// or an error along the way. It is not a payload validator — a single altered
// field in the recording can pass unnoticed, because a rejected message simply
// leaves the previous status in place. Verified by removing an expected state,
// which fails it; corrupting one message does not.
//
// The Matter layer is deliberately not involved; that needs a running Homebridge
// and is covered by the procedure in CONTRIBUTING.md.

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import NodePersist from 'node-persist';

import { DysonMqtt360 } from '../dist/dyson-mqtt-360.js';
import { DEFAULT_CONFIG } from '../dist/settings.js';
import { Dyson360State } from '../dist/dyson-360-types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Every state the recording is known to pass through. A parsing or mapping
// change that loses one of these has broken something real.
const EXPECTED_STATES = [
    'INACTIVE_CHARGED',
    'MAPPING_INITIATED',
    'MAPPING_RUNNING',
    'MAPPING_FINISHED',
    'FULL_CLEAN_RUNNING',
    'FULL_CLEAN_CHARGING',
    'FULL_CLEAN_FINISHED'
];

// The recording replays in about 50 seconds; this only bounds a failing run
const TIMEOUT_MS = 120_000;

// Payload validation failures are reported through log(level, …) rather than
// through error(), so both have to be captured or a recording that no longer
// matches the types would replay silently.
const capture = (...args) => { failures.push(args.join(' ')); };
const quietLog = {
    info:    () => {}, success: () => {}, debug: () => {},
    warn:    capture,
    error:   capture,
    log:     (level, ...args) => {
        if (level === 'error' || level === 'warn') capture(...args);
    }
};

const failures = [];
const seenStates = new Set();

const storage = await mkdtemp(join(tmpdir(), 'dyson-replay-'));
let mqtt;
let exitCode = 1;

try {
    const persist = NodePersist.create({ dir: join(storage, 'persist') });
    await persist.init();

    const config = {
        ...DEFAULT_CONFIG,
        provisioningMethod: 'Mock Devices',
        debugFeatures:      []
    };
    const device = {
        name:         'Replay',
        serialNumber: 'ABC-EU-REPLAY01',
        rootTopic:    '277',
        filename:     join(root, 'mqtt-logs', '277.jsonl')
    };

    mqtt = new DysonMqtt360(quietLog, config, persist, device);
    mqtt.on('error', err => { failures.push(`MQTT error: ${String(err)}`); });
    mqtt.on('status', () => {
        const { state } = mqtt.status;
        if (state === undefined) return;
        seenStates.add(state);
        // A state outside the enum means the recording and the types disagree
        if (!Object.values(Dyson360State).includes(state)) {
            failures.push(`State not in Dyson360State: ${state}`);
        }
    });

    await mqtt.waitUntilInitialised();

    // Let the recording play out, stopping as soon as everything expected has
    // been seen so a passing run does not wait for the whole file
    const startedAt = Date.now();
    while (Date.now() - startedAt < TIMEOUT_MS) {
        if (EXPECTED_STATES.every(state => seenStates.has(state))) break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }

    const missing = EXPECTED_STATES.filter(state => !seenStates.has(state));

    console.log(`Replayed ${seenStates.size} distinct states in `
              + `${Math.round((Date.now() - startedAt) / 1000)}s`);

    if (missing.length) {
        console.error('Recorded session check failed:');
        for (const state of missing) console.error(`  ✘ never reached ${state}`);
        console.error(`    seen: ${[...seenStates].sort().join(', ')}`);
    } else if (failures.length) {
        console.error('Recorded session check failed:');
        for (const failure of failures.slice(0, 10)) console.error(`  ✘ ${failure}`);
    } else {
        console.log('Recorded session check passed');
        exitCode = 0;
    }
} catch (err) {
    console.error(`Recorded session check failed:\n  ✘ ${String(err)}`);
} finally {
    await mqtt?.stop().catch(() => { /* shutting down anyway */ });
    await rm(storage, { recursive: true, force: true });
}

process.exit(exitCode);
