// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer

// Checks the things the Homebridge UI requires but which no compiler or linter
// can catch, because they are agreements about file layout and JSON flags
// rather than about code. Each check below corresponds to a condition inside
// homebridge-config-ui-x:
//
//   - customUi === true          the frontend opens the custom UI only when
//                                `configSchema.customUi` is truthy; customUiPath
//                                alone silently falls back to the plain form
//   - customUiPath resolves      getPluginUiMetadata() throws when the directory
//                                or public/index.html is missing
//   - showSchemaForm()           a custom UI replaces the generated form, so the
//                                plugin's own settings are invisible without it
//   - singular === true          showSchemaForm() only works for singular
//                                platform plugins
//   - files[] covers the UI      npm must actually ship homebridge-ui/

import { builtinModules } from 'module';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]): string => readFileSync(join(root, ...p), 'utf-8');

interface Schema {
    customUi?:      boolean;
    customUiPath?:  string;
    singular?:      boolean;
    pluginAlias?:   string;
    layout?:        unknown;
    schema?:        SchemaNode;
}
interface LayoutItem {
    key?:           string;
    type?:          string;
    notitle?:       boolean;
    htmlClass?:     string;
    title?:         string;
    description?:   string;
    items?:         unknown;
}
interface SchemaNode {
    title?:         string;
    description?:   string;
    type?:          string;
    properties?:    Record<string, SchemaNode>;
    items?:         SchemaNode;
}
interface PackageJson {
    keywords?:          string[];
    files?:             string[];
    main?:              string;
    dependencies?:      Record<string, string>;
    devDependencies?:   Record<string, string>;
}

const failures: string[] = [];
const check = (ok: boolean, message: string): void => { if (!ok) failures.push(message); };

const schema  = JSON.parse(read('config.schema.json')) as Schema;
const pkg     = JSON.parse(read('package.json'))       as PackageJson;
const uiDir   = schema.customUiPath ?? 'homebridge-ui';
const indexRel = join(uiDir, 'public', 'index.html');

check(schema.customUi === true,
      'config.schema.json: "customUi": true is missing — the Homebridge UI will ignore the custom UI '
  + 'and show only the generated form (customUiPath alone does not enable it)');

check(existsSync(join(root, uiDir)),
      `config.schema.json: customUiPath "${uiDir}" does not exist`);

check(existsSync(join(root, indexRel)),
      `${indexRel} is missing — the UI requires public/index.html`);

check(existsSync(join(root, uiDir, 'server.js')),
      `${join(uiDir, 'server.js')} is missing — the custom UI's request handlers live there`);

if (existsSync(join(root, indexRel))) {
    const html = read(indexRel);
    check(html.includes('homebridge.showSchemaForm()'),
          `${indexRel}: does not call homebridge.showSchemaForm() — the custom UI replaces the `
        + 'configuration form, so the plugin settings would be unreachable');
    check(!/\btab\b/i.test(html),
          `${indexRel}: mentions a "tab"; the custom UI has none, which misleads users`);
}

check(schema.singular === true,
      'config.schema.json: "singular": true is required for showSchemaForm() to work');

// Everything the custom UI's server.js imports runs on the user's machine, so
// each bare specifier must be a runtime dependency. A devDependency resolves
// fine here but is absent after `npm install`, and the failure is invisible:
// the server process dies on the import, never calls ready(), and the settings
// page spins forever with no error anywhere.
const serverRel = join(uiDir, 'server.js');
if (existsSync(join(root, serverRel))) {
    const runtimeDeps = new Set(Object.keys(pkg.dependencies ?? {}));
    const devDeps     = new Set(Object.keys(pkg.devDependencies ?? {}));
    const builtins    = new Set(builtinModules);
    const imports     = [...read(serverRel).matchAll(/^import\s[^'"]*from\s*'([^']+)'/gm)]
        .map(m => m[1])
        .filter(spec => !spec.startsWith('.'));

    for (const spec of imports) {
        const pkgName = spec.startsWith('@')
            ? spec.split('/').slice(0, 2).join('/')
            : spec.split('/')[0];
        if (builtins.has(pkgName) || pkgName.startsWith('node:')) continue;
        check(runtimeDeps.has(pkgName),
              `${serverRel} imports "${pkgName}", which is ${devDeps.has(pkgName)
                  ? 'a devDependency' : 'not declared'} — it must be in "dependencies", `
            + 'or the custom UI server crashes on load and the settings page hangs on a spinner');
    }
}

// Every endpoint the page asks for must be served. The page reaches some of
// them through a helper rather than calling homebridge.request directly, so
// match on the path literals instead of the call site.
if (existsSync(join(root, indexRel)) && existsSync(join(root, serverRel))) {
    const html   = read(indexRel);
    const server = read(serverRel);
    const paths  = new Set([...html.matchAll(/'(\/[a-z][a-z0-9-]*)'/gi)].map(m => m[1]));
    for (const path of paths) {
        check(server.includes(`onRequest('${path}'`),
              `${indexRel} requests "${path}", which ${serverRel} does not serve`);
    }
}

// Every schema property must appear in the layout, hidden if it has no place
// on the form. Properties the layout omits still enter the form model and are
// validated there, so one the user cannot reach can leave the form permanently
// invalid — which surfaces only as "config validation failed" next to Save,
// naming nothing.
{
    // Object properties nest, and a nested one is just as able to hold the form
    // invalid as a top-level one, so walk the whole tree. Array items are the
    // layout's business rather than the model's, so they are not followed.
    const paths: string[] = [];
    const walk = (node: SchemaNode, prefix: string): void => {
        for (const [name, child] of Object.entries(node.properties ?? {})) {
            const path = prefix ? `${prefix}.${name}` : name;
            paths.push(path);
            if (child.properties) walk(child, path);
        }
    };
    walk(schema.schema ?? {}, '');

    const layout = JSON.stringify(schema.layout ?? []);
    for (const path of paths) {
        check(layout.includes(path),
              `config.schema.json: property "${path}" is not in the layout; add it as a `
            + '{ "key": "…", "type": "hidden" } entry if it should not be shown');
    }
}

// A hidden layout entry suppresses the input control, but the form still
// renders the title and description of the property behind it, which then
// appear as loose text under the form. Silence both ends.
{
    // Hidden entries live inside a wrapper section, so flatten before checking
    const flatten = (items: unknown): LayoutItem[] =>
        (Array.isArray(items) ? items : []).flatMap((item): LayoutItem[] => {
            if (typeof item !== 'object' || item === null) return [];
            const entry = item as LayoutItem;
            return [entry, ...flatten(entry.items)];
        });
    const layoutItems = flatten(schema.layout);
    // Keys inside a section that Bootstrap's d-none hides
    const hiddenWrapped = new Set<string>(
        flatten(schema.layout)
            .filter(item => item.htmlClass?.split(/\s+/).includes('d-none'))
            .flatMap(section => flatten(section.items))
            .map(item => item.key)
            .filter((key): key is string => key !== undefined));

    const propertyAt = (path: string): SchemaNode | undefined =>
        path.split('.').reduce<SchemaNode | undefined>(
            (node, part) => node?.properties?.[part], schema.schema);

    for (const item of layoutItems) {
        if (item.type !== 'hidden' || !item.key) continue;
        check(item.notitle === true,
              `config.schema.json: hidden layout entry "${item.key}" should set "notitle": true`);
        check(hiddenWrapped.has(item.key),
              `config.schema.json: hidden layout entry "${item.key}" is not inside a section with `
            + '"htmlClass": "d-none"; the form derives a label from the key when no title is set, '
            + 'so it would print one under the form');
        check(!item.title && !item.description,
              `config.schema.json: hidden layout entry "${item.key}" still carries title or description text`);
        const property = propertyAt(item.key);
        check(!property?.title && !property?.description,
              `config.schema.json: property "${item.key}" is hidden but still has a title or `
            + 'description, which the form renders as stray text');
    }
}

// Homebridge's verification bot rejects both of these, and neither is visible
// from the running plugin — the first only shows up in the plugin listing, the
// second only when something validates the schema as JSON Schema.
{
    const keywords = pkg.keywords ?? [];
    check(keywords.includes('homebridge-plugin'),
          'package.json: "keywords" must contain "homebridge-plugin"');
    check(keywords.includes('supports-matter') || keywords.includes('supports-hap'),
          'package.json: "keywords" must declare a transport — "supports-matter" '
        + 'and/or "supports-hap"');

    // `required` is an array of property names at the object level in JSON
    // Schema. A boolean on the property itself is an older form-library
    // convention that the bot treats as an invalid schema.
    const booleanRequired: string[] = [];
    const walkRequired = (node: SchemaNode, prefix: string): void => {
        for (const [name, child] of Object.entries(node.properties ?? {})) {
            const path = prefix ? `${prefix}.${name}` : name;
            if ((child as { required?: unknown }).required === true) booleanRequired.push(path);
            walkRequired(child, path);
        }
        if (node.items) walkRequired(node.items, `${prefix}[]`);
    };
    walkRequired(schema.schema ?? {}, '');
    check(booleanRequired.length === 0,
          `config.schema.json: "required": true on ${booleanRequired.join(', ')} — list the `
        + 'names in a "required" array on the enclosing object instead');
}

const files = pkg.files ?? [];
const covers = (entry: string): boolean =>
    files.some(f => f === entry || f === `${entry}/` || f.startsWith(`${entry}/`));
check(covers(uiDir.replace(/^\.\//, '')),
      `package.json "files" does not include ${uiDir} — the published package would omit the custom UI`);
check(files.includes('config.schema.json'),
      'package.json "files" does not include config.schema.json');

if (failures.length) {
    console.error('Plugin layout check failed:');
    for (const f of failures) console.error(`  ✘ ${f}`);
    process.exit(1);
}
console.log('Plugin layout check passed');
