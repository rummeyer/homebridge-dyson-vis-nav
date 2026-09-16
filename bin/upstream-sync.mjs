// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer

// Adopt fixes from matterbridge-dyson-robot, the project this plugin's Dyson
// protocol layer is carried over from.
//
// Those files were copied with only their import paths rewritten, so applying
// the same rewrites to a newer upstream revision reproduces what this plugin
// should contain. Files that still match upstream exactly can therefore be
// replaced wholesale; only files this port has since changed need judgement.
//
//   node bin/upstream-sync.mjs                  report against upstream's latest tag
//   node bin/upstream-sync.mjs --ref v1.12.0    report against a specific ref
//   node bin/upstream-sync.mjs --apply          update the files that have not diverged
//   node bin/upstream-sync.mjs --diff <file>    show the upstream change for one file
//
// --apply never touches a diverged file, and never moves the baseline: that is
// a deliberate commit, made once the result has been built and tested.

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const root  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.upstream-cache');
const spec  = JSON.parse(readFileSync(join(root, '.upstream.json'), 'utf-8'));

const args    = process.argv.slice(2);
const apply   = args.includes('--apply');
const refArg  = args[args.indexOf('--ref') + 1];
const ref     = args.includes('--ref') ? refArg : null;
const diffOne = args.includes('--diff') ? args[args.indexOf('--diff') + 1] : null;

const git = (...a) => execFileSync('git', a, { cwd: cache, encoding: 'utf-8' }).trimEnd();

// Fetch upstream into a local mirror
function ensureMirror() {
    if (!existsSync(cache)) {
        mkdirSync(cache, { recursive: true });
        console.log(`Cloning ${spec.repository} ...`);
        execFileSync('git', ['clone', '--bare', '--quiet', spec.repository, cache], { stdio: 'inherit' });
    } else {
        execFileSync('git', ['fetch', '--quiet', '--tags', '--force', 'origin', '+refs/heads/*:refs/heads/*'],
            { cwd: cache, stdio: 'inherit' });
    }
}

// The newest release tag upstream
function latestTag() {
    const tags = git('tag', '--sort=-v:refname').split('\n').filter(Boolean);
    return tags[0];
}

// Read a file at a revision, or null when it does not exist there
function show(rev, file) {
    try {
        return execFileSync('git', ['show', `${rev}:src/${file}`], { cwd: cache, encoding: 'utf-8' });
    } catch {
        return null;
    }
}

// Apply the same transformation used when porting
function normalise(text) {
    let out = text;
    for (const [from, to] of spec.rewrites) out = out.split(from).join(to);
    return out.split('\n').slice(spec.headerLines.upstream).join('\n');
}

// Our copy, with its (longer) attribution header removed for comparison
function ours(file) {
    const path = join(root, 'src', file);
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8').split('\n').slice(spec.headerLines.ours).join('\n');
}

// Replace our copy, keeping our header
function writeOurs(file, upstreamBody) {
    const path = join(root, 'src', file);
    const header = readFileSync(path, 'utf-8').split('\n').slice(0, spec.headerLines.ours);
    writeFileSync(path, [...header, ...upstreamBody.split('\n')].join('\n'));
}

ensureMirror();
const target = ref ?? latestTag();
const base   = spec.baseline.commit;

if (diffOne) {
    const a = show(base, diffOne);
    const b = show(target, diffOne);
    if (a === null || b === null) {
        console.error(`${diffOne}: missing upstream at ${a === null ? base : target}`);
        process.exit(1);
    }
    console.log(diffText(normalise(a), normalise(b), diffOne));
    process.exit(0);
}

console.log(`Baseline ${spec.baseline.ref} (${base.slice(0, 8)})  →  upstream ${target}\n`);

if (git('rev-parse', target) === base) {
    console.log('Already at the baseline; nothing upstream to adopt.');
    process.exit(0);
}

const changed = [];
const diverged = [];
const gone = [];

for (const file of spec.tracked) {
    const atBase   = show(base, file);
    const atTarget = show(target, file);
    if (atTarget === null) { gone.push(file); continue; }
    if (atBase === atTarget) continue;

    const wanted = normalise(atTarget);
    const mine   = ours(file);
    if (mine === null) { gone.push(file); continue; }

    // Has this port modified the file since it was copied?
    if (mine === normalise(atBase)) {
        changed.push({ file, wanted });
    } else {
        diverged.push(file);
    }
}

if (!changed.length && !diverged.length && !gone.length) {
    console.log('No tracked file changed upstream.');
    process.exit(0);
}

if (changed.length) {
    console.log(`Changed upstream, and untouched here — safe to take (${changed.length}):`);
    for (const { file } of changed) console.log(`  ${file}`);
}
if (diverged.length) {
    console.log(`\nChanged upstream, and changed here too — review by hand (${diverged.length}):`);
    for (const file of diverged) {
        console.log(`  ${file}`);
        console.log(`      git -C .upstream-cache diff ${base.slice(0, 8)}..${target} -- src/${file}`);
    }
}
if (gone.length) {
    console.log(`\nNo longer present upstream, or not carried here (${gone.length}):`);
    for (const file of gone) console.log(`  ${file}`);
}

if (apply && changed.length) {
    for (const { file, wanted } of changed) writeOurs(file, wanted);
    console.log(`\nUpdated ${changed.length} file(s). Now run: npm run build && npm run lint`);
    console.log(`Once that passes, set .upstream.json baseline to ${target} (${git('rev-parse', target).slice(0, 8)}).`);
} else if (changed.length) {
    console.log('\nRe-run with --apply to take the safe ones.');
}

// Minimal unified diff, so no temporary files are needed
function diffText(a, b, label) {
    const al = a.split('\n');
    const bl = b.split('\n');
    const out = [`--- upstream ${base.slice(0, 8)}:${label}`, `+++ upstream ${target}:${label}`];
    const max = Math.max(al.length, bl.length);
    for (let i = 0; i < max; i++) {
        if (al[i] !== bl[i]) {
            if (al[i] !== undefined) out.push(`-${al[i]}`);
            if (bl[i] !== undefined) out.push(`+${bl[i]}`);
        }
    }
    return out.join('\n');
}
