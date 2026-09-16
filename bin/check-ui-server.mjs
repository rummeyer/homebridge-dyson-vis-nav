// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer

// Starts the custom UI's server.js the way homebridge-config-ui-x does — as a
// forked child process communicating over IPC — and waits for the `ready`
// message that HomebridgePluginUiServer sends once its handlers are registered.
//
// This is the only check that catches a server which dies on startup. That
// failure is invisible from the outside: the config UI spawns this file in a
// separate process, so a crash produces no entry in the Homebridge log and no
// error in the browser. The settings page simply shows a spinner forever.
//
// Pass a path to test an installed copy; defaults to this working tree.

import { fork } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const READY_TIMEOUT_MS = 10_000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = process.argv[2] ?? join(root, 'homebridge-ui', 'server.js');

if (!existsSync(serverPath)) {
    console.error(`Custom UI server check failed:\n  ✘ not found: ${serverPath}`);
    process.exit(1);
}

const child = fork(serverPath, [], {
    stdio:      ['pipe', 'pipe', 'pipe', 'ipc'],
    // Do not leak this process's flags into the child: the config UI starts it
    // with a clean argv, and an inherited --input-type would make it fail here
    // in a way it never would in production.
    execArgv:   [],
    env:        { ...process.env, NODE_OPTIONS: '' }
});

let stderr = '';
let settled = false;

const finish = (ok, why) => {
    if (settled) return;
    settled = true;
    if (ok) {
        console.log(`Custom UI server check passed\n  ✔ ${why}`);
    } else {
        console.error(`Custom UI server check failed:\n  ✘ ${why}`);
        if (stderr.trim()) {
            console.error(stderr.split('\n').slice(0, 8).map(l => `      ${l}`).join('\n'));
        }
    }
    child.kill('SIGKILL');
    process.exit(ok ? 0 : 1);
};

child.stderr.on('data', d => { stderr += d; });
child.on('message', msg => {
    if (msg && typeof msg === 'object' && msg.action === 'ready') {
        finish(true, "server.js signalled 'ready'; the settings page would render");
    }
});
child.on('error', err => finish(false, `could not start server.js: ${err.message}`));
child.on('exit', code => finish(false, `server.js exited with code ${code} instead of signalling 'ready'`));
setTimeout(() => finish(false, `no 'ready' within ${READY_TIMEOUT_MS / 1000}s`), READY_TIMEOUT_MS);
