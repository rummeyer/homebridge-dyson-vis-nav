// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises';
import Path from 'path';
import { PLUGIN_NAME } from './settings.js';

// Number of completed cleans kept per device
export const CLEAN_HISTORY_LIMIT = 10;

// What the settings page lists for a completed clean
export interface CleanRecordSummary {
    id:             string;     // file stem, unique and sortable by finish time
    serialNumber:   string;
    cleanId:        string;     // UUID
    started?:       string;     // ISO 8601
    finished?:      string;     // ISO 8601
    cleanDuration?: number;     // seconds
    cleanedArea?:   number;     // m²
    charges?:       number;
    zones:          string[];   // names of the zones visited, in order
}

// A completed clean with its map rendered for a monospaced terminal
export interface CleanRecord extends CleanRecordSummary {
    mapLines:       string[];   // ANSI 256-colour escape sequences
}

// Everything the cloud returned for the clean, kept so the map can later be
// rendered differently without losing cleans that happened before then
export interface CleanRecordRaw {
    clean:          unknown;
    persistentMap?: unknown;
}

// Completed cleans are stored one file per clean, rather than in node-persist,
// so that the settings page can list them without loading every map and so a
// clean that fails to parse costs only itself:
//   <storage>/homebridge-dyson-vis-nav/cleans/<serial>/<id>.json      record
//   <storage>/homebridge-dyson-vis-nav/cleans/<serial>/<id>.raw.json  cloud data
const RECORD_SUFFIX = '.json';
const RAW_SUFFIX    = '.raw.json';

// A record id is a filename, so it must never be able to leave the directory
const ID_PATTERN     = /^[0-9TZ-]+_[0-9a-f-]+$/i;
const SERIAL_PATTERN = /^[0-9A-Z-]+$/i;

// Directory holding the history of every device
export function cleanHistoryRoot(storagePath: string): string {
    return Path.join(storagePath, PLUGIN_NAME, 'cleans');
}

// Construct a record id that sorts by finish time
export function makeCleanRecordId(cleanId: string, finished?: string): string {
    const when = (finished ?? new Date().toISOString()).replace(/[^0-9TZ]/g, '');
    return `${when}_${cleanId}`;
}

// Save a completed clean and discard all but the most recent ones
export async function saveCleanRecord(
    storagePath:    string,
    record:         CleanRecord,
    raw:            CleanRecordRaw,
    limit =         CLEAN_HISTORY_LIMIT
): Promise<void> {
    if (!SERIAL_PATTERN.test(record.serialNumber)) throw new Error(`Invalid serial number: ${record.serialNumber}`);
    if (!ID_PATTERN.test(record.id))               throw new Error(`Invalid clean record id: ${record.id}`);
    const dir = Path.join(cleanHistoryRoot(storagePath), record.serialNumber);
    await mkdir(dir, { recursive: true });
    await writeAtomic(Path.join(dir, record.id + RAW_SUFFIX), JSON.stringify(raw));
    await writeAtomic(Path.join(dir, record.id + RECORD_SUFFIX), JSON.stringify(record));

    // The same clean may be saved again (for example after a restart); its id
    // is identical then, so it replaces rather than duplicates the earlier file
    const ids = await listIds(dir);
    for (const id of ids.slice(limit)) {
        await rm(Path.join(dir, id + RECORD_SUFFIX), { force: true });
        await rm(Path.join(dir, id + RAW_SUFFIX),    { force: true });
    }
}

// List the stored cleans of all devices, most recent first
export async function listCleanRecords(storagePath: string): Promise<CleanRecordSummary[]> {
    const root = cleanHistoryRoot(storagePath);
    const serials = (await readdirOrEmpty(root)).filter(name => SERIAL_PATTERN.test(name));
    const summaries: CleanRecordSummary[] = [];
    for (const serial of serials) {
        const dir = Path.join(root, serial);
        for (const id of await listIds(dir)) {
            const record = await readRecord(dir, id);
            if (!record) continue;
            const { mapLines: _mapLines, ...summary } = record;
            summaries.push(summary);
        }
    }
    return summaries.sort((a, b) => b.id.localeCompare(a.id));
}

// Delete every stored clean of every device
export async function deleteCleanRecords(storagePath: string): Promise<void> {
    await rm(cleanHistoryRoot(storagePath), { recursive: true, force: true });
}

// Read a single stored clean, including its map
export async function readCleanRecord(
    storagePath:    string,
    serialNumber:   string,
    id:             string
): Promise<CleanRecord | undefined> {
    // (called from the settings page with whatever the browser sent)
    if (typeof serialNumber !== 'string' || !SERIAL_PATTERN.test(serialNumber)) return undefined;
    if (typeof id           !== 'string' || !ID_PATTERN.test(id))               return undefined;
    return readRecord(Path.join(cleanHistoryRoot(storagePath), serialNumber), id);
}

// Read and sanity check one record file
async function readRecord(dir: string, id: string): Promise<CleanRecord | undefined> {
    try {
        const record = JSON.parse(await readFile(Path.join(dir, id + RECORD_SUFFIX), 'utf8')) as CleanRecord;
        if (record.id !== id || !Array.isArray(record.mapLines)) return undefined;
        return record;
    } catch {
        return undefined;
    }
}

// Record ids in a device directory, most recent first
async function listIds(dir: string): Promise<string[]> {
    return (await readdirOrEmpty(dir))
        .filter(name => name.endsWith(RECORD_SUFFIX) && !name.endsWith(RAW_SUFFIX))
        .map(name => name.slice(0, -RECORD_SUFFIX.length))
        .filter(id => ID_PATTERN.test(id))
        .sort().reverse();
}

// Directory entries, or none if the directory does not exist yet
async function readdirOrEmpty(dir: string): Promise<string[]> {
    try {
        return await readdir(dir);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    }
}

// Write a file so that a reader never sees it half written
async function writeAtomic(path: string, data: string): Promise<void> {
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
}
