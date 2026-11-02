// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer

// Fitting a clean that lies turned on the map back onto the rooms

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DysonBitmapOctet } from '../src/dyson-bitmap-octet.js';
import {
    cleanMisalignment,
    Dyson360VisNavCleanedOctet,
    turnBitmap
} from '../src/dyson-device-360-map.js';

const { Empty, Cleaned } = Dyson360VisNavCleanedOctet;
const SIZE = 300;

// Rooms that only fit one way round: a large room, a long hall off one side
// of it, and a small room at the hall's far end
function isRoom(x: number, y: number): boolean {
    return (40 <= x && x < 160 && 140 <= y && y < 260)
        || (140 <= x && x < 260 && 120 <= y && y < 150)
        || (220 <= x && x < 280 && 40 <= y && y < 130);
}

function rooms(): DysonBitmapOctet {
    const bitmap = new DysonBitmapOctet(SIZE, SIZE, Buffer.alloc(SIZE * SIZE));
    for (let y = 0; y < SIZE; ++y) for (let x = 0; x < SIZE; ++x) if (isRoom(x, y)) bitmap.write(x, y, 1);
    return bitmap;
}

// The rooms cleaned, as the robot recorded them believing itself turned by
// `angle` degrees about (cx, cy) and moved by (dx, dy) pixels
function cleaned(angle = 0, dx = 0, dy = 0, cx = 150, cy = 150): DysonBitmapOctet<Dyson360VisNavCleanedOctet> {
    const bitmap = new DysonBitmapOctet<Dyson360VisNavCleanedOctet>(SIZE, SIZE, Buffer.alloc(SIZE * SIZE));
    const cos = Math.cos(angle * Math.PI / 180), sin = Math.sin(angle * Math.PI / 180);
    for (let y = 0; y < SIZE; ++y) {
        for (let x = 0; x < SIZE; ++x) {
            // Where in the rooms this pixel of the clean really was
            const tx = x - cx - dx, ty = y - cy - dy;
            const rx = Math.round(tx * cos + ty * sin + cx), ry = Math.round(-tx * sin + ty * cos + cy);
            if (isRoom(rx, ry)) bitmap.write(x, y, Cleaned);
        }
    }
    return bitmap;
}

function count(bitmap: DysonBitmapOctet, octet: number): number {
    return bitmap.occupied(value => value === octet);
}

void test('a clean placed right is left as it is', () => {
    assert.equal(cleanMisalignment(cleaned(), rooms(), { x: 0, y: 0 }), undefined);
});

void test('a clean placed right, with the rooms bitmap elsewhere, is left as it is', () => {
    // The rooms bitmap starts 20 px left and 10 px above the clean's
    const shifted = new DysonBitmapOctet(SIZE, SIZE, Buffer.alloc(SIZE * SIZE));
    for (let y = 0; y < SIZE; ++y) for (let x = 0; x < SIZE; ++x) if (isRoom(x - 20, y - 10)) shifted.write(x, y, 1);
    assert.equal(cleanMisalignment(cleaned(), shifted, { x: -20, y: -10 }), undefined);
});

void test('a clean turned 12° is found turned back by about 12°', () => {
    const fit = cleanMisalignment(cleaned(-12), rooms(), { x: 0, y: 0 });
    assert.ok(fit, 'no turn found');
    assert.ok(Math.abs(fit.angle - 12) <= 1, `turned ${fit.angle}°`);
});

void test('a clean turned the other way is found turned back the other way', () => {
    const fit = cleanMisalignment(cleaned(9, 6, -4), rooms(), { x: 0, y: 0 });
    assert.ok(fit, 'no turn found');
    assert.ok(Math.abs(fit.angle + 9) <= 1, `turned ${fit.angle}°`);
});

void test('a clean turned back lies within the rooms', () => {
    const clean = cleaned(-12, -10, 15);
    const room = rooms();
    const fit = cleanMisalignment(clean, room, { x: 0, y: 0 });
    assert.ok(fit, 'no turn found');
    const margin = 60;
    const turned = turnBitmap(clean, fit, margin);
    let inside = 0, all = 0;
    for (let y = 0; y < turned.height; ++y) {
        for (let x = 0; x < turned.width; ++x) {
            if (turned.read(x, y) !== Cleaned) continue;
            ++all;
            if (isRoom(x - margin, y - margin)) ++inside;
        }
    }
    assert.ok(inside / all > 0.95, `${Math.round(100 * inside / all)} % within the rooms`);
});

void test('too little cleaned to tell is left as it is', () => {
    const clean = new DysonBitmapOctet<Dyson360VisNavCleanedOctet>(SIZE, SIZE, Buffer.alloc(SIZE * SIZE));
    for (let x = 50; x < 60; ++x) for (let y = 150; y < 155; ++y) clean.write(x, y, Cleaned);
    assert.equal(cleanMisalignment(clean, rooms(), { x: 0, y: 0 }), undefined);
});

void test('turning keeps every pixel within the margin, moved as fitted', () => {
    const bitmap = new DysonBitmapOctet<Dyson360VisNavCleanedOctet>(10, 10, Buffer.alloc(100, Empty));
    bitmap.write(9, 5, Cleaned);
    // A quarter turn about (5, 5) and 2 px down: (9, 5) goes to (5, 9 + 2)
    const turned = turnBitmap(bitmap, { angle: 90, dx: 0, dy: 2, cx: 5, cy: 5 }, 10);
    assert.equal(turned.width, 30);
    assert.equal(turned.height, 30);
    assert.equal(count(turned, Cleaned), 1);
    assert.equal(turned.read(5 + 10, 11 + 10), Cleaned);
});

void test('turning by nothing only adds the margin', () => {
    const bitmap = new DysonBitmapOctet<Dyson360VisNavCleanedOctet>(4, 3, Buffer.from([0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1]));
    const turned = turnBitmap(bitmap, { angle: 0, dx: 0, dy: 0, cx: 2, cy: 1 }, 2);
    for (let y = 0; y < 3; ++y) for (let x = 0; x < 4; ++x) assert.equal(turned.read(x + 2, y + 2), bitmap.read(x, y));
    assert.equal(count(turned, Cleaned), count(bitmap, Cleaned));
});
