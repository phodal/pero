import { readFileSync, writeFileSync } from 'node:fs';

// Conceptual domain composition from docs/ARCHITECTURE.md and ADR 0007/0008.
// Plugin packaging and App-to-Agent tools are a target, not an app.json contract.
const root = new URL('../../', import.meta.url);
const theme = readFileSync(new URL('DESIGN.md', root), 'utf8').split('---')[1];
const light = theme.match(/^  light:\n([\s\S]*?)(?=^  \w+:)/m)?.[1];
if (!light) throw new Error('Missing colors.light palette in DESIGN.md');
const c = Object.fromEntries([...light.matchAll(/^    ([\w-]+): "(#[\da-f]{6})"$/gmi)].map((match) => [match[1], match[2]]));
if (['bg', 'surface', 'surface-muted', 'text', 'text-muted', 'border', 'input-border', 'action', 'accent-soft', 'accent-text'].some((key) => !c[key])) {
  throw new Error('Missing building blocks palette token in DESIGN.md');
}

const escape = (value) => String(value).replace(/[&<>"']/g, (v) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[v]);
const parts = [];
const add = (value) => parts.push(value);
function text(x, y, value, size = 20, color = c.text, weight = 400, extra = '') {
  add(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" ${extra}>${escape(value)}</text>`);
}
function rect(x, y, width, height, { fill = c.surface, stroke = c.border, dashed = false, radius = 10 } = {}) {
  add(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dashed ? ' stroke-dasharray="7 5"' : ''}/>`);
}
function line(d, planned = false, arrow = false) {
  add(`<path d="${d}" fill="none" stroke="${c['input-border']}" stroke-width="1.8"${planned ? ' stroke-dasharray="7 5"' : ''}${arrow ? ' marker-end="url(#arrow)"' : ''}/>`);
}

add('<?xml version="1.0" encoding="UTF-8"?>');
add('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="732" viewBox="0 0 1200 732" role="img" aria-labelledby="title description" lang="en">');
add('<title id="title">Pero — Domain building blocks</title>');
add('<desc id="description">Conceptual composition: a domain defines methods, inputs, outputs and checks. Its App owns a user interface, data and an optional backend, and is reused in standalone products or the Pero workbench. A planned Agent Plugin groups Skills (instructions) and Tools (MCP or connectors), exposing domain methods to Host-owned Agent sessions. The App SDK and Host runtime provide the shared foundation. Dashed outlines and connections mark planned integration; Plugin is not a supported App manifest field today.</desc>');
add(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="${c['input-border']}" stroke-width="1.5"/></marker></defs>`);
rect(0, 0, 1200, 732, { fill: c.bg, stroke: 'none', radius: 16 });
add('<g font-family="Inter, Helvetica Neue, Arial, sans-serif">');
text(40, 54, 'Domain Apps, composed for people and agents.', 30, c.text, 650);

// Domain is the conceptual scope, not an additional runtime or registry.
rect(40, 90, 1120, 318, { fill: c['surface-muted'] });
text(64, 130, 'Domain', 26, c.text, 650);
text(204, 130, 'Methods · Inputs · Outputs · Checks', 20, c['text-muted']);
text(1136, 130, 'e.g. Biology', 18, c['text-muted'], 400, 'text-anchor="end"');

rect(64, 156, 448, 224, { stroke: c.action });
text(88, 198, 'App', 28, c['accent-text'], 650);
text(88, 230, 'A reusable domain experience', 20, c['text-muted']);
[
  [88, 116, 'UI'],
  [216, 116, 'Data'],
  [344, 144, 'Backend*'],
].forEach(([x, width, label]) => {
  rect(x, 254, width, 54, { fill: c['accent-soft'], stroke: 'none', radius: 6 });
  text(x + width / 2, 288, label, 21, c['accent-text'], 550, 'text-anchor="middle"');
});
text(88, 350, '* Optional domain computation', 17, c['text-muted']);

rect(688, 156, 448, 224, { stroke: c['input-border'], dashed: true });
text(712, 198, 'Agent Plugin', 28, c.text, 650);
text(1112, 196, 'PLANNED', 14, c['text-muted'], 550, 'text-anchor="end" letter-spacing="1"');
text(712, 230, 'A bundle of agent capabilities', 20, c['text-muted']);
[
  [712, 'Skills', 'Instructions'],
  [920, 'Tools', 'MCP / connectors'],
].forEach(([x, title, detail]) => {
  rect(x, 254, 192, 102, { fill: c['surface-muted'], stroke: 'none', radius: 6 });
  text(x + 16, 289, title, 22, c.text, 600);
  text(x + 16, 326, detail, 18, c['text-muted']);
});
line('M 512 280 H 684', true, true);
text(600, 247, 'Expose', 18, c['text-muted'], 400, 'text-anchor="middle"');
text(600, 269, 'domain tools', 18, c['text-muted'], 400, 'text-anchor="middle"');

// One App can be delivered through either shell. Plugin/session wiring is planned.
line('M 288 380 V 452', false, true);
line('M 912 380 V 452', true, true);
rect(64, 456, 448, 96);
text(288, 493, 'Standalone product  /  Workbench', 23, c.text, 600, 'text-anchor="middle"');
text(288, 525, 'Reuse the same App', 19, c['text-muted'], 400, 'text-anchor="middle"');
rect(688, 456, 448, 96, { stroke: c['input-border'], dashed: true });
text(912, 493, 'Agent sessions', 23, c.text, 600, 'text-anchor="middle"');
text(912, 525, 'Apply Skills · Call domain Tools', 19, c['text-muted'], 400, 'text-anchor="middle"');

line('M 288 552 V 592');
line('M 912 552 V 592', true);
rect(64, 592, 1072, 76, { fill: c['accent-soft'], stroke: 'none' });
text(88, 624, 'Pero platform', 23, c['accent-text'], 650);
text(88, 651, 'App SDK · Host runtime', 18, c['accent-text']);
text(1112, 625, 'App lifecycle · Backend processes · ACP sessions', 20, c.text, 500, 'text-anchor="end"');
text(1112, 651, 'Shared implementation, product-specific Host and data', 17, c['text-muted'], 400, 'text-anchor="end"');
line('M 66 701 H 102', true);
text(114, 707, 'Dashed = planned composition and integration', 17, c['text-muted']);
add('</g></svg>\n');

const output = new URL('docs/assets/openpero-building-blocks.svg', root);
const svg = parts.join('\n');
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== svg) throw new Error('Run node scripts/codegen/building-blocks.mjs');
} else {
  writeFileSync(output, svg);
  console.log(`Generated ${output.pathname}`);
}
