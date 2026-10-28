import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ROADMAP.md target architecture. Solid outlines identify existing foundations,
// not complete platform capabilities or accepted deployment environments.
const root = new URL('../../', import.meta.url);
const theme = readFileSync(new URL('DESIGN.md', root), 'utf8').split('---')[1];
// Read only the documented flat HEX palette; regeneration needs no npm install.
const light = theme.match(/^  light:\n([\s\S]*?)(?=^  \w+:)/m)?.[1];
if (!light) throw new Error('Missing colors.light palette in DESIGN.md');
const c = Object.fromEntries([...light.matchAll(/^    ([\w-]+): "(#[\da-f]{6})"$/gmi)].map((match) => [match[1], match[2]]));
const brand = { navy: theme.match(/^    navy: "(#[\da-f]{6})"$/mi)?.[1] };
if (!brand.navy || ['bg', 'surface', 'surface-muted', 'text', 'text-muted', 'border', 'input-border', 'action', 'accent-soft', 'accent-text'].some((key) => !c[key])) {
  throw new Error('Missing architecture palette token in DESIGN.md');
}
const output = new URL('docs/assets/openpero-architecture.svg', root);
const escape = (value) => String(value).replace(/[&<>"']/g, (v) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[v]);
const parts = [];
const add = (value) => parts.push(value);

function text(x, y, value, size = 18, color = c.text, weight = 400, extra = '') {
  add(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" ${extra}>${escape(value)}</text>`);
}

function rect(x, y, w, h, { fill = c.surface, stroke = c.border, dashed = false, radius = 8 } = {}) {
  add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dashed ? ' stroke-dasharray="7 5"' : ''}/>`);
}

function path(d, { solid = false, accent = false, both = false, arrow = true } = {}) {
  const color = accent ? c.action : c['text-muted'];
  add(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${accent ? 2.2 : 1.7}"${solid ? '' : ' stroke-dasharray="7 5"'}${arrow ? ` marker-end="url(#${accent ? 'accent' : 'arrow'})"` : ''}${both ? ' marker-start="url(#start)"' : ''}/>`);
}

function card(x, y, w, h, title, detail, current = false) {
  rect(x, y, w, h, { dashed: !current, stroke: current ? c.action : c['input-border'] });
  const compact = h < 80;
  text(x + 18, y + (compact ? 27 : 33), title, compact ? 20 : 22, brand.navy, 650);
  text(x + 18, y + (compact ? 49 : 60), detail, 16, c['text-muted']);
}

function group(x, title, subtitle) {
  rect(x, 344, 432, 400, { fill: c['surface-muted'], dashed: true, stroke: c['input-border'] });
  text(x + 20, 382, title, 26, brand.navy, 650);
  text(x + 20, 406, subtitle, 16, c['text-muted']);
}

add('<?xml version="1.0" encoding="UTF-8"?>');
add('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1056" viewBox="0 0 1600 1056" role="img" aria-labelledby="title description" lang="en">');
add('<title id="title">Pero — Overall Architecture</title>');
add('<desc id="description">Target architecture derived from ROADMAP.md. Clients access shared Cloud coordination and Host execution through versioned contracts. Host owns local permissions, credentials and execution identity. Apps, playbooks, connectors and replaceable agents use authorized environments. Artifacts pass independent verification and human acceptance before returning to project knowledge. Dashed modules and connections are planned; solid outlines indicate existing foundations only.</desc>');
add(`<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="${c['text-muted']}" stroke-width="1.5"/></marker>
  <marker id="start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 9 1 L 1 5 L 9 9" fill="none" stroke="${c['text-muted']}" stroke-width="1.5"/></marker>
  <marker id="accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="${c.action}" stroke-width="1.5"/></marker>
</defs>`);
rect(0, 0, 1600, 1056, { fill: c.bg, stroke: 'none', radius: 0 });
add('<g font-family="Inter, Helvetica Neue, Arial, sans-serif">');
text(64, 50, 'Pero Architecture', 32, brand.navy, 650);
add('<g transform="translate(0 -48)">');

// Feedback stays outside the module boundaries.
path('M 1536 1030 H 1570 V 128 H 30 V 470 H 64', { accent: true });
rect(745, 109, 110, 34, { fill: c.bg, stroke: 'none', radius: 0 });
text(800, 133, 'Feedback', 18, c['accent-text'], 550, 'text-anchor="middle"');

const clients = [
  ['Desktop', 'Electron · GPUI / WASM', true],
  ['Web', 'Shared workbench', false],
  ['Mobile / Editor', 'Remote access & approvals', false],
  ['Events & Collaboration', 'GitHub · Channels · Automations', false],
];
clients.forEach(([title, detail, current], i) => {
  const x = 64 + i * 380;
  card(x, 170, 332, 80, title, detail, current);
  path(`M ${x + 166} 250 V 272`, { solid: current, arrow: false });
});
path('M 230 272 H 1370', { arrow: false });
path('M 800 272 V 286');
rect(64, 286, 1472, 38, { fill: c['accent-soft'], dashed: true, stroke: c.action });
text(800, 312, 'Versioned Contracts · API / Events / Sync', 19, brand.navy, 550, 'text-anchor="middle"');
path('M 280 324 V 344');
path('M 800 324 V 344');

group(64, 'Cloud', 'Shared project authority');
card(84, 428, 392, 84, 'Projects & Knowledge', 'Context · Pages · Results · Memory');
card(84, 532, 392, 84, 'Tasks & Coordination', 'Contracts · Snapshots · Dispatch');
card(84, 636, 392, 84, 'Teams & Sync', 'Identity · Policy · Journal replication');

group(584, 'Host / Daemon', 'Local execution authority');
card(604, 428, 392, 64, 'Policy & Local State', 'Permissions · Credentials · Journal');
card(604, 506, 392, 64, 'Managed Runs', 'Run · Session · Cancel · Recover');
card(604, 584, 392, 64, 'Harness & Tools', 'Agent loop · Files · Terminal · Browser');
card(604, 662, 392, 64, 'ACP Sessions', 'Events · Prompts · Approval flow', true);

group(1104, 'Capability Ecosystem', 'Replaceable backends & extensions');
card(1124, 428, 392, 84, 'Apps & Playbooks', 'Research · Software · Engineering');
card(1124, 532, 392, 84, 'Connectors', 'MCP · Data · Platforms · Devices');
card(1124, 636, 392, 84, 'Agent Backends', 'Codex · Claude · OpenCode', true);

path('M 486 470 H 594', { both: true });
text(540, 457, 'Sync', 16, c['text-muted'], 400, 'text-anchor="middle"');
path('M 486 574 H 544 V 538 H 594');
text(540, 524, 'Run', 16, c['text-muted'], 400, 'text-anchor="middle"');
path('M 1114 470 H 1078 V 538 H 1006');
text(1060, 457, 'Methods', 15, c['text-muted'], 400, 'text-anchor="middle"');
path('M 1006 616 H 1060 V 574 H 1114', { both: true });
text(1060, 562, 'Tools', 16, c['text-muted'], 400, 'text-anchor="middle"');
path('M 1006 694 H 1060 V 678 H 1114', { solid: true, both: true });
text(1060, 665, 'ACP', 16, c['accent-text'], 550, 'text-anchor="middle"');

text(64, 792, 'Execution Environments & Workers', 23, brand.navy, 650);
text(1536, 792, 'Resource owners · Bindings · Use leases', 17, c['text-muted'], 400, 'text-anchor="end"');
path('M 800 744 V 802', { arrow: false });
path('M 230 802 H 1370', { arrow: false });
[
  ['Local Machine', 'Workspace · Desktop · Container'],
  ['Lab & HPC', 'Python · SSH · Instruments'],
  ['Cloud & Kubernetes', 'Pods · Sandboxes · Compute'],
  ['Trusted Workers', 'Capabilities · Leases · Results'],
].forEach(([title, detail], i) => {
  const x = 64 + i * 380;
  card(x, 814, 332, 88, title, detail);
  path(`M ${x + 166} 802 V 814`);
  path(`M ${x + 166} 902 V 914`, { arrow: false });
});
path('M 230 914 H 1370', { arrow: false });

path('M 230 914 V 942 H 280 V 988');
text(244, 936, 'Artifacts', 16, c['text-muted']);
path('M 800 914 V 988', { both: true });
text(818, 951, 'Independent verification Use', 17, c['text-muted']);
text(64, 970, 'Trusted Delivery', 23, brand.navy, 650);
card(64, 988, 432, 84, 'Artifact Versions', 'Outputs · Provenance · Evidence');
card(584, 988, 432, 84, 'Verification', 'Independent checks · CI · Verifiers');
card(1104, 988, 432, 84, 'Human Decision', 'Accept · Reject · Rework');
path('M 506 1030 H 574');
path('M 1026 1030 H 1094');

add('</g></g></svg>\n');

const svg = parts.join('\n');
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== svg) throw new Error('Run npm run gen:architecture');
} else {
  writeFileSync(output, svg);
  console.log(`Generated ${fileURLToPath(output)}`);
}
