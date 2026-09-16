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

import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]): string => readFileSync(join(root, ...p), 'utf-8');

interface Schema {
    customUi?:      boolean;
    customUiPath?:  string;
    singular?:      boolean;
    pluginAlias?:   string;
}
interface PackageJson {
    files?:         string[];
    main?:          string;
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
