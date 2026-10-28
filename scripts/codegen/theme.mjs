import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { scriptOptions } from '../lib/options.mjs';
const options = scriptOptions('web/src');
const { root, outDir, check } = options;
const source = readFileSync(`${root}/DESIGN.md`, 'utf8').split('---')[1];
const { light, dark } = parse(source).colors;
const variables = colors => Object.entries(colors).map(([name, value]) => `--${name}:${value};`).join('');
const outputs = [
  [resolve(outDir, 'theme.generated.json'), JSON.stringify({ light, dark }, null, 2) + '\n'],
  [options['out-dir'] ? resolve(outDir, 'theme.generated.css') : resolve(root, 'server/internal/community/assets/theme.generated.css'),
    `/* Generated from DESIGN.md; run npm run gen:theme. */\n:root{color-scheme:light dark;${variables(light)}}\n@media(prefers-color-scheme:dark){:root{${variables(dark)}}}\n`],
];
for (const [path, output] of outputs) {
  if (check) {
    if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') !== output) throw new Error('Run npm run gen:theme');
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, output);
  }
}
