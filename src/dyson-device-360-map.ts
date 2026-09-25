// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import { AnsiLogger } from './logger.js';
import { DysonBitmapOctet } from './dyson-bitmap-octet.js';
import { assertIsDefined } from './utils.js';
import { DysonAnsiChar, DysonBitmapAnsi } from './dyson-bitmap-ansi.js';
import {
    Dyson360CleanHistoryEntry,
    Dyson360CleanMap,
    Dyson360PersistentMapResponse
} from './dyson-360-cloud-types.js';
import { inflateSync } from 'zlib';
import { PNG } from 'pngjs';
import { Dyson360TimelineEvent } from './dyson-360-types.js';
import { LogMapStyle } from './config-types.js';
import { Dyson360CleanSummary } from './dyson-device-360-base.js';

// Maximum map size
const MAX_SIZE_CHARS    = 80;   // (characters)

// Character aspect ratio (for Homebridge frontend log viewer)
const ASPECT_RATIO      = 5/9;  // (width / height)

// Dyson 360 Eye map pixels
enum Dyson360EyeOctet { Empty, Cleaned, Start, End }
const RGBA_360_EYE = new Map<number, Dyson360EyeOctet>([
    [0x835ED5FF,    Dyson360EyeOctet.Cleaned],  // Purple
    [0x8763D6FF,    Dyson360EyeOctet.Cleaned],  // Purple       (with pale grid line)
    [0x8B68D7FF,    Dyson360EyeOctet.Cleaned],  // Purple       (with grid lines crossing)
    [0x455CC7FF,    Dyson360EyeOctet.Start],    // Blue         (start location)
    [0xDD4157FF,    Dyson360EyeOctet.End],      // Red          (end location)
    [0x00000000,    Dyson360EyeOctet.Empty],    // Transparent
    [0xFFFFFF08,    Dyson360EyeOctet.Empty],    // Transparent  (with pale grid line)
    [0xFFFFFF10,    Dyson360EyeOctet.Empty],    // Transparent  (with grid lines crossing)
    [0xFFFFFFFF,    Dyson360EyeOctet.Empty]     // White        (robot's path)
]);

// Dyson 360 Vis Nav map pixels
enum Dyson360VisNavCleanedOctet { Empty, Cleaned, Fault }
const RGBA_VIS_NAV_CLEANED = new Map<number, Dyson360VisNavCleanedOctet>([
    [0x000000FF,    Dyson360VisNavCleanedOctet.Empty],          // Black
    [0xFFFFFFFF,    Dyson360VisNavCleanedOctet.Cleaned]         // White
]);
enum Dyson360VisNavPresentationOctet { Empty, Zone, Boundary, Dock }
const RGBA_VIS_NAV_PRESENTATION = new Map<number, Dyson360VisNavPresentationOctet>([
    [0x000000FF,    Dyson360VisNavPresentationOctet.Zone],      // Black
    [0xFFFFFFFF,    Dyson360VisNavPresentationOctet.Boundary],  // White
    [0x808080FF,    Dyson360VisNavPresentationOctet.Empty]      // Gray
]);

// Glyphs for monospaced fonts and Homebridge frontend
// (Homebridge versions are subset of Arial with same widths)
export type Dyson360MapStyle = Exclude<LogMapStyle, 'Off'>;
const QUADRATURE_GLYPHS: Record<Dyson360MapStyle, string> = {
    Monospaced:     ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█',
    Homebridge:   ' ▀▀▀▄▌██▄█▐█▄███'
};
const GLYPHS = {
    boundary:   { Monospaced: '▪', Homebridge: '╬' },
    cleaned:    { Monospaced: '☺', Homebridge: '☺' }, // (quadrature block element substituted)
    empty:      { Monospaced: '┼', Homebridge: '┼' },
    end:        { Monospaced: '●', Homebridge: '═' },
    fault:      { Monospaced: '‼', Homebridge: '▒' },
    start:      { Monospaced: '○', Homebridge: '─' },
    zone:       { Monospaced: ' ', Homebridge: '░' }
} as const satisfies Record<string, Record<Dyson360MapStyle, string>>;
type GlyphKey = keyof typeof GLYPHS;

// ANSI 256-colour codes
const COLOURS = {
    boundary:   { fg:  15,  bg: 235 },  // White on dark grey       (360 Vis Nav)
    cleaned:    { fg:  98,  bg:  16 },  // Light purple on black    (360 Eye)
    empty:      { fg: 233,  bg:  16 },  // Dark grey on black
    end:        { fg:  15,  bg: 197 },  // White on reddish pink    (360 Eye)
    fault:      { fg:  16,  bg:  11 },  // White on light grey      (360 Vis Nav)
    start:      { fg:  15,  bg:  62 },  // White on pale blue
    zone:       { fg: 235,  bg: 235 }   // Dark grey on dark grey   (360 Vis Nav)
} as const satisfies Record<GlyphKey, { fg: number, bg: number}>;

// Dust level colour gradient: purple-orange-yellow-white (360 Vis Nav)
const DUST_COLOURS = [54, 89, 124, 166, 208, 214, 220, 226, 227, 228, 229, 230, 231] as const;

// Render a Dyson 360 Eye cleaned area map
export function dysonRenderMap360Eye(
    _log:       AnsiLogger,
    style:      Dyson360MapStyle,
    clean:      Dyson360CleanHistoryEntry,
    cleanPNG:   Buffer
): Dyson360CleanSummary {
    // Retrieve and parse the cleaned area image (5 mm/pixel)
    const fullBitmap = DysonBitmapOctet.fromPNGMapped(cleanPNG, RGBA_360_EYE);

    // Scale the image to the target log width
    const renderer = new DysonBitmapAnsi([{ bitmap: fullBitmap }]);
    renderer.maxWidthChars = renderer.maxHeightChars = MAX_SIZE_CHARS;
    renderer.charAspectRatio = ASPECT_RATIO;

    // Convert the image to text
    renderer.quadratureGlyphs = QUADRATURE_GLYPHS[style];
    const mapLines = renderer.toQuadrature(
        octet => octet !== Dyson360EyeOctet.Empty,
        (char, octets) => {
            if (octets.includes(Dyson360EyeOctet.End))   return makeGlyph(style, 'end');
            if (octets.includes(Dyson360EyeOctet.Start)) return makeGlyph(style, 'start');
            if (char === ' ')                            return makeGlyph(style, 'empty');
            return { ...makeGlyph(style, 'cleaned'), char };
        }
    );

    // Log the clean details and cleaned area map
    return { charges: clean.Charges, cleanedArea: clean.Area, mapLines };
}

// The overlaid bitmaps of a Dyson 360 Vis Nav clean, aligned and orientated to
// match the app; shared by the log's text map and the settings page's image
function prepareMap360VisNav(
    log:    AnsiLogger,
    clean:  Dyson360CleanMap,
    map?:   Dyson360PersistentMapResponse
) {
    // Check that the bitmaps are all the same resolution
    const resolutions = new Set<number>([
        clean.cleanedFootprint.resolution,
        clean.dustMap.resolution
    ]);
    if (map) {
        resolutions.add(map.presentationMap.resolution);
        resolutions.add(map.zonesDefinition.zonesMap.resolution);
    }
    if (resolutions.size !== 1) throw new Error(`Multiple bitmap resolutions not supported (${[...resolutions].join(' ≠ ')})`);
    const [mmPerPixel] = resolutions;
    assertIsDefined(mmPerPixel);

    // Set a single pixel
    const setPixel = <Octet extends number>(bitmap: DysonBitmapOctet<Octet>, coord: { x: number, y: number }, octet: Octet): void => {
        const mmToPixels = (mm: number): number => Math.round(mm / mmPerPixel);
        const x = mmToPixels(coord.x), y = mmToPixels(coord.y);
        if (0 <= x && x < bitmap.width && 0 <= y && y < bitmap.height) bitmap.write(x, y, octet);
        else log.warn(`Coordinate outside bitmap (${coord.x}, ${coord.y} mm)`);
    };

    // If the clean is associated with a map then parse its presentation map
    let presentationBitmap: DysonBitmapOctet;
    let presentationOrigin: { x: number, y: number } | undefined;
    let zonesBitmap:        DysonBitmapOctet;
    let zonesOrigin:        { x: number, y: number } | undefined;
    if (clean.persistentMap && map) {
        // Parse the presentation map image and add the dock. The cloud also
        // keeps every place the dock used to stand, with nothing to tell them
        // apart except order: the current one is the last.
        const presentationPNG = Buffer.from(map.presentationMap.data, 'base64');
        presentationBitmap = DysonBitmapOctet.fromPNGMapped(presentationPNG, RGBA_VIS_NAV_PRESENTATION);
        const dock = map.dockLocations.at(-1);
        if (dock) setPixel(presentationBitmap, dock, Dyson360VisNavPresentationOctet.Dock);
        const { cleanMapPosition } = clean.persistentMap;
        const { offset } = map;
        presentationOrigin = {
            x:  (offset.x - cleanMapPosition.x) / mmPerPixel,
            y:  (offset.y - cleanMapPosition.y) / mmPerPixel
        };

        // Parse the rooms: each pixel's grey level is the id of its zone (0
        // outside every zone), positioned by its own offset rather than the
        // presentation map's, which differs
        const { zonesMap, persistentMapOffset } = map.zonesDefinition;
        zonesBitmap = DysonBitmapOctet.fromPNG(Buffer.from(zonesMap.data, 'base64'), rgba => rgba >>> 24);
        zonesOrigin = {
            x:  (persistentMapOffset.x - cleanMapPosition.x) / mmPerPixel,
            y:  (persistentMapOffset.y - cleanMapPosition.y) / mmPerPixel
        };
    } else {
        // No persistent map, so create empty presentation and zone bitmaps
        const emptyBuffer = Buffer.alloc(1, Dyson360VisNavPresentationOctet.Empty);
        presentationBitmap = new DysonBitmapOctet(1, 1, emptyBuffer);
        zonesBitmap = new DysonBitmapOctet(1, 1, Buffer.alloc(1));
    }

    // Parse the cleaned footprint image and add any fault locations
    const cleanedPNG = Buffer.from(clean.cleanedFootprint.data, 'base64');
    const cleanedBitmap = DysonBitmapOctet.fromPNGMapped(cleanedPNG, RGBA_VIS_NAV_CLEANED);
    for (const { faultLocation } of clean.cleanTimeline) {
        if (faultLocation !== null) {
            setPixel(cleanedBitmap, faultLocation, Dyson360VisNavCleanedOctet.Fault);
        }
    }

    // Convert the dust level data into a bitmap
    const { width: dustWidth, height: dustHeight } = clean.dustMap;
    const dustData = clean.dustMap.dustData[0];
    assertIsDefined(dustData);
    const dustDataDecoded = inflateSync(Buffer.from(dustData.data, 'base64'));
    const dustDataBitmap = new DysonBitmapOctet(dustWidth, dustHeight, dustDataDecoded);

    // Overlay the images, orientated to match the app
    const renderer = new DysonBitmapAnsi([
        { bitmap: cleanedBitmap },
        { bitmap: presentationBitmap, origin: presentationOrigin },
        { bitmap: dustDataBitmap },
        { bitmap: zonesBitmap, origin: zonesOrigin }
    ]);
    renderer.invertY = true;
    renderer.rotation = map?.zonesDefinition.persistentMapDisplayOrientation ?? 0;

    // Dust level as a fraction of the maximum
    const dustScale = dustData.scaleFactor || 255;
    return { renderer, mmPerPixel, cleanedBitmap, dustScale };
}

// Render a Dyson 360 Vis Nav cleaned area map
export function dysonRenderMap360VisNav(
    log:    AnsiLogger,
    style:  Dyson360MapStyle,
    clean:  Dyson360CleanMap,
    map?:   Dyson360PersistentMapResponse
): Dyson360CleanSummary {
    // Scale all the images to target log width
    const { renderer, mmPerPixel, cleanedBitmap, dustScale } = prepareMap360VisNav(log, clean, map);
    renderer.maxWidthChars = renderer.maxHeightChars = MAX_SIZE_CHARS;
    renderer.charAspectRatio = ASPECT_RATIO;

    // Convert the image to text
    renderer.quadratureGlyphs = QUADRATURE_GLYPHS[style];
    const mapLines = renderer.toQuadrature(
        octet => octet === Dyson360VisNavCleanedOctet.Cleaned,
        (char, cleaned, presentation, dustLevels) => {
            // First select the representation for the presentation map
            const PRESENTATION_ANSI_BG: Record<Dyson360VisNavPresentationOctet, DysonAnsiChar> = {
                [Dyson360VisNavPresentationOctet.Dock]:     makeGlyph(style, 'start'),
                [Dyson360VisNavPresentationOctet.Zone]:     makeGlyph(style, 'zone'),
                [Dyson360VisNavPresentationOctet.Boundary]: makeGlyph(style, 'boundary'),
                [Dyson360VisNavPresentationOctet.Empty]:    makeGlyph(style, 'empty')
            };
            const presentationOctet: Dyson360VisNavPresentationOctet = Math.max(...presentation);
            const presentationChar = PRESENTATION_ANSI_BG[presentationOctet];

            // Faults take priority over everything else
            if (cleaned.some(octet => octet === Dyson360VisNavCleanedOctet.Fault)) return makeGlyph(style, 'fault');

            // Show the presentation map for dock locations and outside cleaned area
            if (presentationOctet === Dyson360VisNavPresentationOctet.Dock || char === ' ') return presentationChar;

            // Select colour based on dust level
            const dustLevel = Math.max(0, ...dustLevels) / dustScale;
            const dustAnsiId = DUST_COLOURS[Math.floor(dustLevel * DUST_COLOURS.length)] ?? DUST_COLOURS.at(-1);
            assertIsDefined(dustAnsiId);

            // Always show zone boundary, but adopt the dust level colour
            if (presentationOctet === Dyson360VisNavPresentationOctet.Boundary) {
                return { ...presentationChar, bg: bgColour(dustAnsiId) };
            }

            // Otherwise show the cleaned area on the presentation map background
            return { char, fg: fgColour(dustAnsiId), bg: presentationChar.bg };
        }
    );

    // Count the number of charging events and cleaned area
    const charges = clean.cleanTimeline.filter(e => e.eventName === Dyson360TimelineEvent.Charging).length;
    const cleanedCount = cleanedBitmap.occupied(octet => octet === Dyson360VisNavCleanedOctet.Cleaned);
    const cleanedArea = cleanedCount * Math.pow(mmPerPixel / 1000, 2);

    // Log the clean details and cleaned area map
    return { charges, cleanedArea, mapLines };
}

// Colours of the Dyson 360 Vis Nav cleaned area image (RGB)
type Rgb = readonly [number, number, number];
const IMAGE_COLOURS = {
    outside:    [  0,   0,   0],
    zone:       [ 42,  42,  46],
    boundary:   [205, 205, 210],
    divider:    [140, 140, 150],
    dock:       [ 95,  95, 215],
    fault:      [255, 215,   0],
    marker:     [255, 255, 255]
} as const satisfies Record<string, Rgb>;

// Uncleaned floor of each room, dark enough for the dust colours to stand out
// and for white room names to read on top
const ROOM_COLOURS: readonly Rgb[] = [
    [ 38,  52,  74], [ 70,  46,  44], [ 40,  64,  52], [ 70,  58,  36],
    [ 58,  44,  74], [ 36,  62,  68], [ 72,  46,  62], [ 56,  62,  40]
];

// A room name and where to place it, as fractions of the image size
export interface Dyson360MapRoomLabel {
    name:   string;
    x:      number;
    y:      number;
}

// A Dyson 360 Vis Nav cleaned area image with its room names
export interface Dyson360MapImage {
    png:    Buffer;
    rooms:  Dyson360MapRoomLabel[];
}

// Render a Dyson 360 Vis Nav cleaned area map as a PNG image, one pixel per
// map pixel (typically 20 mm), coloured like the text map but with the dust
// levels blended smoothly instead of in steps, and the rooms told apart. The
// names are returned rather than drawn so that the page can set them as text.
export function dysonRenderImage360VisNav(
    log:        AnsiLogger,
    clean:      Dyson360CleanMap,
    map?:       Dyson360PersistentMapResponse,
    floorPlan = true
): Dyson360MapImage {
    const { renderer, mmPerPixel, dustScale } = prepareMap360VisNav(log, clean, map);
    renderer.charAspectRatio = 1;
    const { width, height, readPixels } = renderer.prepareBitmaps(1);

    // Read every pixel once
    const pixels = Array.from({ length: width * height }, (_, i) => readPixels(i % width, Math.floor(i / width)) as
        [Dyson360VisNavCleanedOctet, Dyson360VisNavPresentationOctet, number, number]);

    // The rooms either as mapped, or as a floor plan: furniture leaves the
    // mapped rooms ragged, so each is squared off into a rectangle (or a few
    // for an L or T shape) and the walls lined up
    const zones = map?.zonesDefinition.zones ?? [];
    const mapped = (i: number): number => pixels[i]?.[3] ?? 0;
    const rooms = floorPlan
        ? straightenRooms(width, height, mapped, Math.round(ROOM_SNAP_MM / mmPerPixel), Math.round(ROOM_GAP_MM / mmPerPixel))
        : Uint8Array.from({ length: width * height }, (_, i) => mapped(i));
    const roomAt = (x: number, y: number): number =>
        (0 <= x && x < width && 0 <= y && y < height) ? rooms[y * width + x] ?? 0 : 0;
    const roomColour = (room: number): Rgb => {
        const index = zones.findIndex(({ id }) => Number(id) === room);
        return index < 0 ? IMAGE_COLOURS.zone : ROOM_COLOURS[index % ROOM_COLOURS.length] ?? IMAGE_COLOURS.zone;
    };

    // Whether a neighbouring pixel lies in another room, or (for the floor
    // plan's walls) outside; both sides are marked, so lines are two pixels wide
    const bordersRoom = (x: number, y: number, orOutside: boolean): boolean => {
        const room = roomAt(x, y);
        if (!room) return false;
        return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx = 0, dy = 0]) => {
            const other = roomAt(x + dx, y + dy);
            return other !== room && (orOutside || other !== 0);
        });
    };

    // Colour each pixel, remembering where the markers go. The floor plan
    // draws its own walls and keeps the dust inside its rooms; as mapped (or
    // for a clean with no rooms) the walls are those of the presentation map.
    const plan = floorPlan && rooms.some(room => room !== 0);
    const png = new PNG({ width, height });
    const docks: { x: number, y: number }[] = [];
    const faults: { x: number, y: number }[] = [];
    const put = (x: number, y: number, [r, g, b]: Rgb): void => {
        if (x < 0 || width <= x || y < 0 || height <= y) return;
        const i = (y * width + x) * 4;
        png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
    };
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            const pixel = pixels[y * width + x];
            assertIsDefined(pixel);
            const [cleaned, presentation, dust] = pixel;
            const room = roomAt(x, y);
            if (cleaned === Dyson360VisNavCleanedOctet.Fault) faults.push({ x, y });
            if (presentation === Dyson360VisNavPresentationOctet.Dock) docks.push({ x, y });
            let colour: Rgb;
            if (plan ? bordersRoom(x, y, true) : presentation === Dyson360VisNavPresentationOctet.Boundary) {
                colour = IMAGE_COLOURS.boundary;
            } else if (plan ? !room : false) {
                colour = IMAGE_COLOURS.outside;
            } else if (!plan && bordersRoom(x, y, false)) {
                colour = IMAGE_COLOURS.divider;
            } else if (cleaned !== Dyson360VisNavCleanedOctet.Empty) {
                colour = dustColour(dust / dustScale);
            } else if (!plan && presentation === Dyson360VisNavPresentationOctet.Empty) {
                colour = IMAGE_COLOURS.outside;
            } else {
                colour = roomColour(room);
            }
            put(x, y, colour);
        }
    }

    // Draw the markers large enough to find at a glance
    const disc = (cx: number, cy: number, radius: number, colour: Rgb): void => {
        for (let dy = -radius; dy <= radius; ++dy) {
            for (let dx = -radius; dx <= radius; ++dx) {
                if (dx * dx + dy * dy <= radius * radius + radius) put(cx + dx, cy + dy, colour);
            }
        }
    };
    const markerRadius = Math.max(4, Math.round(Math.max(width, height) / 90));
    for (const { x, y } of docks) {
        disc(x, y, markerRadius + 2, IMAGE_COLOURS.marker);
        disc(x, y, markerRadius,     IMAGE_COLOURS.dock);
    }
    for (const { x, y } of faults) {
        disc(x, y, markerRadius + 2, IMAGE_COLOURS.outside);
        disc(x, y, markerRadius,     IMAGE_COLOURS.fault);
    }

    // Label each room at its point furthest from any other room or the outside,
    // which stays inside rooms that are L-shaped or wrap around another
    const labelAt = roomLabelPositions(width, height, roomAt);
    const labels = zones.flatMap(({ id, name }) => {
        const at = labelAt.get(Number(id));
        return at ? [{ name, x: (at.x + 0.5) / width, y: (at.y + 0.5) / height }] : [];
    });
    return { png: PNG.sync.write(png), rooms: labels };
}

// A room that fills at least this much of its bounding rectangle is drawn as
// that rectangle; furniture typically leaves a mapped room 50–90 % filled,
// whereas an L- or T-shaped hallway fills well under half
const ROOM_FILL = 0.5;

// An edge row or column of a room's rectangle that the room fills less of than
// this is cut off
const ROOM_EDGE = 0.25;

// Room edges this close are taken to be the same wall: besides the thickness
// of an internal wall, a wardrobe or sideboard along a wall (typically 60 cm
// deep) keeps the mapped room short of it
const ROOM_SNAP_MM = 1000;

// A room this close to a wider one facing it, with nothing between them, is
// extended to meet it: something the robot cannot enter (a bath, a kitchen
// unit) filled the gap
const ROOM_GAP_MM = 2000;

// Square off each room of a zone grid (room id per pixel, 0 for none) into a
// rectangle, or split it where that leaves the least empty space and square off
// the parts; larger rooms are drawn first so that smaller ones stay visible
function straightenRooms(
    width:  number,
    height: number,
    zoneOf: (index: number) => number,
    snap:   number,     // (pixels)
    gap:    number      // (pixels)
): Uint8Array {
    const minSize = 10;     // (pixels, so 20 cm at the usual resolution)
    const counts = new Map<number, number>();
    for (let i = 0; i < width * height; ++i) {
        const zone = zoneOf(i);
        if (zone) counts.set(zone, (counts.get(zone) ?? 0) + 1);
    }

    const rects: RoomRect[] = [];
    for (const zone of [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))) {
        // Summed-area table of this room's pixels, for counting any rectangle
        const sums = new Int32Array((width + 1) * (height + 1));
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                const i = (y + 1) * (width + 1) + x + 1;
                sums[i] = (zoneOf(y * width + x) === zone ? 1 : 0)
                        + (sums[i - 1] ?? 0) + (sums[i - width - 1] ?? 0) - (sums[i - width - 2] ?? 0);
            }
        }
        const count = ({ x0, y0, x1, y1 }: Box): number =>
            (sums[y1 * (width + 1) + x1] ?? 0) - (sums[y0 * (width + 1) + x1] ?? 0)
          - (sums[y1 * (width + 1) + x0] ?? 0) + (sums[y0 * (width + 1) + x0] ?? 0);

        // Shrink a box to the room's pixels within it
        const shrink = (box: Box): Box | undefined => {
            if (!count(box)) return undefined;
            let { x0, y0, x1, y1 } = box;
            while (!count({ x0, y0, x1: x0 + 1, y1 })) ++x0;
            while (!count({ x0: x1 - 1, y0, x1, y1 })) --x1;
            while (!count({ x0, y0, x1, y1: y0 + 1 })) ++y0;
            while (!count({ x0, y0: y1 - 1, x1, y1 })) --y1;
            return { x0, y0, x1, y1 };
        };
        const empty = (box: Box): number => {
            const bounds = shrink(box);
            return bounds ? (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0) - count(bounds) : 0;
        };

        // Peel off edge rows and columns the room barely reaches into, so that
        // a narrow spur (such as a strip mapped through a doorway) does not
        // stretch the rectangle over its neighbour
        const trim = (box: Box): Box => {
            let { x0, y0, x1, y1 } = box;
            for (let changed = true; changed;) {
                changed = false;
                const w = x1 - x0, h = y1 - y0;
                if (w <= minSize || h <= minSize) break;
                if (count({ x0, y0, x1: x0 + 1, y1 }) < ROOM_EDGE * h) { ++x0; changed = true; }
                if (count({ x0: x1 - 1, y0, x1, y1 }) < ROOM_EDGE * h) { --x1; changed = true; }
                if (count({ x0, y0, x1, y1: y0 + 1 }) < ROOM_EDGE * w) { ++y0; changed = true; }
                if (count({ x0, y0: y1 - 1, x1, y1 }) < ROOM_EDGE * w) { --y1; changed = true; }
            }
            return { x0, y0, x1, y1 };
        };

        // Recursively split the room until each part fills enough of its box
        const split = (box: Box, depth: number): Box[] => {
            const bounds = shrink(box);
            if (!bounds || count(bounds) < minSize * minSize / 2) return [];
            const { x0, y0, x1, y1 } = bounds;
            if (count(bounds) >= ROOM_FILL * (x1 - x0) * (y1 - y0) || 4 <= depth) {
                // (the parts of a split room must keep meeting each other)
                return [depth ? bounds : trim(bounds)];
            }
            let best: { empty: number, parts: [Box, Box] } | undefined;
            const consider = (parts: [Box, Box]): void => {
                const e = empty(parts[0]) + empty(parts[1]);
                if (!best || e < best.empty) best = { empty: e, parts };
            };
            for (let x = x0 + minSize; x <= x1 - minSize; ++x) consider([{ x0, y0, x1: x, y1 }, { x0: x, y0, x1, y1 }]);
            for (let y = y0 + minSize; y <= y1 - minSize; ++y) consider([{ x0, y0, x1, y1: y }, { x0, y0: y, x1, y1 }]);
            if (!best) return [bounds];
            return best.parts.flatMap(part => split(part, depth + 1));
        };

        for (const box of split({ x0: 0, y0: 0, x1: width, y1: height }, 0)) rects.push({ zone, ...box });
    }

    // Line up the walls, then paint the rooms (largest first)
    snapRoomEdges(rects, snap);
    closeRoomGaps(rects, gap);
    const rooms = new Uint8Array(width * height);
    for (const { zone, x0, y0, x1, y1 } of rects) {
        for (let y = Math.max(0, y0); y < Math.min(height, y1); ++y) {
            rooms.fill(zone, y * width + Math.max(0, x0), y * width + Math.min(width, x1));
        }
    }
    return rooms;
}

// A rectangle of a room, in pixels (exclusive x1, y1)
interface Box { x0: number, y0: number, x1: number, y1: number }
interface RoomRect extends Box { zone: number }

// Walls are shared: rooms have no gaps between them, and the rooms along one
// wall of the house end at the same line. Mapping leaves neither true, so move
// the edges of rectangles that lie within the snap distance of each other, and
// alongside each other, onto a common line. Edges facing the same way (the
// outside of the house) move out to the furthest of them; edges facing each
// other (the two sides of an internal wall) meet between them.
function snapRoomEdges(rects: RoomRect[], snap: number): void {
    for (const axis of ['x', 'y'] as const) {
        const [lo, hi, crossLo, crossHi] = axis === 'x'
            ? ['x0', 'x1', 'y0', 'y1'] as const : ['y0', 'y1', 'x0', 'x1'] as const;
        interface Edge { rect: RoomRect, side: typeof lo | typeof hi, at: number }
        const edges: Edge[] = rects.flatMap(rect => [
            { rect, side: lo, at: rect[lo] }, { rect, side: hi, at: rect[hi] }
        ]);

        // Group edges that are alongside each other, closest first, as long as
        // a group spans no more than the snap distance (so that no chain of
        // near neighbours drags distant walls together) and holds only one
        // edge of any rectangle (so that no room collapses)
        const groupOf = edges.map(edge => [edge]);
        const pairs: [Edge, Edge][] = [];
        edges.forEach((a, i) => {
            edges.slice(i + 1).forEach(b => {
                const gap = Math.max(a.rect[crossLo], b.rect[crossLo]) - Math.min(a.rect[crossHi], b.rect[crossHi]);
                if (Math.abs(a.at - b.at) <= snap && gap <= snap) pairs.push([a, b]);
            });
        });
        pairs.sort(([a, b], [c, d]) => Math.abs(a.at - b.at) - Math.abs(c.at - d.at));
        for (const [a, b] of pairs) {
            const groupA = groupOf[edges.indexOf(a)], groupB = groupOf[edges.indexOf(b)];
            if (!groupA || !groupB || groupA === groupB) continue;
            const merged = [...groupA, ...groupB];
            const ats = merged.map(({ at }) => at);
            if (snap < Math.max(...ats) - Math.min(...ats)) continue;
            if (new Set(merged.map(({ rect }) => rect)).size < merged.length) continue;
            for (const edge of merged) groupOf[edges.indexOf(edge)] = merged;
        }

        // Move each group of edges onto one line
        for (const members of new Set(groupOf)) {
            if (members.length < 2) continue;
            const los = members.filter(({ side }) => side === lo).map(({ at }) => at);
            const his = members.filter(({ side }) => side === hi).map(({ at }) => at);
            const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
            const line = !his.length ? Math.min(...los)
                       : !los.length ? Math.max(...his)
                       : Math.round((mean(los) + mean(his)) / 2);
            for (const { rect, side } of members) {
                // (never collapse a rectangle whose own two edges are this close)
                const moved = { ...rect, [side]: line };
                if (moved[lo] < moved[hi]) rect[side] = line;
            }
        }
    }
}

// Extend a room across a gap to the room it faces, when the other room spans
// at least its whole width (so the extension cannot overlap a third room) and
// no other room lies in the gap
function closeRoomGaps(rects: RoomRect[], maxGap: number): void {
    const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    for (const axis of ['x', 'y'] as const) {
        const [lo, hi, crossLo, crossHi] = axis === 'x'
            ? ['x0', 'x1', 'y0', 'y1'] as const : ['y0', 'y1', 'x0', 'x1'] as const;
        for (const a of rects) {
            for (const b of rects) {
                // (a before b along this axis)
                const gap = b[lo] - a[hi];
                if (a.zone === b.zone || gap <= 0 || maxGap < gap) continue;
                if (a[crossHi] <= b[crossLo] || b[crossHi] <= a[crossLo]) continue;
                const [narrow, wide] = a[crossHi] - a[crossLo] <= b[crossHi] - b[crossLo] ? [a, b] : [b, a];
                if (narrow[crossLo] < wide[crossLo] || wide[crossHi] < narrow[crossHi]) continue;
                const between: Box = { ...narrow, [lo]: a[hi], [hi]: b[lo] };
                if (rects.some(other => other !== a && other !== b && overlaps(other, between))) continue;
                if (narrow === a) a[hi] = b[lo]; else b[lo] = a[hi];
            }
        }
    }
}

// For each room, the pixel furthest from its edge (a two-pass chamfer distance)
function roomLabelPositions(
    width:  number,
    height: number,
    zoneAt: (x: number, y: number) => number
): Map<number, { x: number, y: number }> {
    const distance = new Float64Array(width * height);
    const relax = (x: number, y: number, dx: number, dy: number, cost: number): void => {
        const zone = zoneAt(x, y);
        const i = y * width + x;
        const nx = x + dx, ny = y + dy;
        const neighbour = zoneAt(nx, ny) === zone ? distance[ny * width + nx] ?? 0 : 0;
        distance[i] = Math.min(distance[i] ?? 0, neighbour + cost);
    };
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            distance[y * width + x] = zoneAt(x, y) ? Infinity : 0;
            if (!zoneAt(x, y)) continue;
            relax(x, y, -1,  0, 1); relax(x, y,  0, -1, 1);
            relax(x, y, -1, -1, Math.SQRT2); relax(x, y, 1, -1, Math.SQRT2);
        }
    }
    const best = new Map<number, { x: number, y: number, distance: number }>();
    for (let y = height - 1; 0 <= y; --y) {
        for (let x = width - 1; 0 <= x; --x) {
            const zone = zoneAt(x, y);
            if (!zone) continue;
            relax(x, y, 1,  0, 1); relax(x, y,  0, 1, 1);
            relax(x, y, 1, 1, Math.SQRT2); relax(x, y, -1, 1, Math.SQRT2);
            const d = distance[y * width + x] ?? 0;
            if (d > (best.get(zone)?.distance ?? -1)) best.set(zone, { x, y, distance: d });
        }
    }
    return new Map([...best].map(([zone, { x, y }]) => [zone, { x, y }]));
}

// Blend the dust level gradient smoothly (level 0 to 1)
const DUST_RGB = DUST_COLOURS.map(xtermRgb);
function dustColour(level: number): Rgb {
    const position = Math.min(1, Math.max(0, level)) * (DUST_RGB.length - 1);
    const index = Math.min(DUST_RGB.length - 2, Math.floor(position));
    const [from, to] = [DUST_RGB[index], DUST_RGB[index + 1]];
    assertIsDefined(from);
    assertIsDefined(to);
    const t = position - index;
    const mix = (a: number, b: number): number => Math.round(a + (b - a) * t);
    return [mix(from[0], to[0]), mix(from[1], to[1]), mix(from[2], to[2])];
}

// Convert an xterm 256-colour index to RGB (colour cube and greys only)
function xtermRgb(id: number): Rgb {
    if (232 <= id) { const v = 8 + (id - 232) * 10; return [v, v, v]; }
    const level = (i: number): number => i ? 55 + i * 40 : 0;
    const n = id - 16;
    return [level(Math.floor(n / 36)), level(Math.floor(n / 6) % 6), level(n % 6)];
}

// Construct an ANSI colour coded glyph (using 256-colour mode IDs)
function makeGlyph(style: Dyson360MapStyle, key: GlyphKey): DysonAnsiChar {
    return {
        char:   GLYPHS[key][style],
        fg:     fgColour(COLOURS[key].fg),
        bg:     bgColour(COLOURS[key].bg)
    };
}

// Construct ANSI colour codes (using 256-colour mode IDs)
function fgColour(id: number): string { return `\u001B[38;5;${id}m`; }
function bgColour(id: number): string { return `\u001B[48;5;${id}m`; }