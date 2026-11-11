import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseMystProjectSnapshot, importMystProjectSnapshot, exportMystProjectSnapshot, replaceMystProjectResource, resolveMystResource, mystProjectDefinition } from '../src/myst-project-snapshot.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/myst-project-contract.json', import.meta.url), 'utf8'));
const envelope = (files: {path: string; text: string}[]) => ({ format: 'pero-myst-project', version: 1, entry: files[0].path, files });

test('shared MyST project corpus retains exact authored text and rejects unsupported wires', () => {
  for (const item of fixture.cases) {
    const attrs = { blockId: 'project-contract', schemaVersion: 1, snapshot: JSON.stringify(item.snapshot) };
    if (!item.accepted) { assert.throws(() => mystProjectDefinition.validate(attrs), undefined, item.name); continue; }
    const parsed = importMystProjectSnapshot(attrs.snapshot);
    assert.deepEqual(importMystProjectSnapshot(exportMystProjectSnapshot(parsed)), parsed);
    assert.deepEqual(parsed.files, item.snapshot.files);
    assert.equal(mystProjectDefinition.validate(attrs).status, 'current');
  }
});
test('project resource lookup is exact, local and independent of the filesystem', () => {
  const project = parseMystProjectSnapshot(fixture.cases[0].snapshot);
  for (const item of fixture.references) {
    const result = resolveMystResource(project, item.base, item.reference);
    assert.equal(result.status, item.status);
    if (result.status !== 'unsupported') assert.equal(result.path, item.path);
  }
  const changed = replaceMystProjectResource(project, 'refs.bib', 'Exact\r\n🧪');
  assert.equal(changed.files.find(file => file.path === 'refs.bib')?.text, 'Exact\r\n🧪');
  assert.notDeepEqual(project, changed);
  assert.throws(() => replaceMystProjectResource(project, 'missing', ''));
});
test('project text, count, path and encoded budgets include exact UTF-8 boundaries', () => {
  const limits = fixture.limits;
  const text = '🧪'.repeat(limits.resourceBytes / 4);
  const files = Array.from({length: 4}, (_, i) => ({path: `${i}.md`, text}));
  assert.equal(parseMystProjectSnapshot(envelope(files)).files.length, 4);
  assert.throws(() => parseMystProjectSnapshot(envelope([...files, {path:'extra.md', text:'a'}])));
  assert.throws(() => parseMystProjectSnapshot(envelope([{path:'a.md', text: text + 'a'}])));
  const many = Array.from({length: limits.files}, (_, i) => ({path:`${i}.md`, text:''}));
  assert.equal(parseMystProjectSnapshot(envelope(many)).files.length, limits.files);
  assert.throws(() => parseMystProjectSnapshot(envelope([...many, {path:'extra.md',text:''}])));
  const path = 'a'.repeat(limits.pathBytes - 3) + '.md';
  parseMystProjectSnapshot(envelope([{path,text:''}]));
  assert.throws(() => parseMystProjectSnapshot(envelope([{path:'a'+path,text:''}])));
  assert.throws(() => parseMystProjectSnapshot(envelope(files.map(file => ({...file,text:'\u0000'.repeat(limits.resourceBytes)})))), /persisted contribution/);
  assert.throws(() => importMystProjectSnapshot(' '.repeat(limits.wireBytes + 1)));
});

test('shared project block corpus rejects unsupported authority and version fields', () => {
  for (const item of fixture.blockCases) {
    assert.throws(() => mystProjectDefinition.validate({blockId:'contract', schemaVersion:1, snapshot:JSON.stringify(fixture.cases[0].snapshot), ...item.patch}), undefined, item.name);
  }
});

test('persisted contribution counts actual raw JSON escaping and canonical edit output', () => {
  const recipe = fixture.persistedBoundary;
  const base = {entry:'a.md', files:[{path:'a.md', text:recipe.escapedUnit.repeat(recipe.repeat)}, {path:'b.md',text:''}]};
  const remaining = fixture.limits.persistedBytes - Buffer.byteLength(JSON.stringify(exportMystProjectSnapshot(base)));
  base.files[1].text = recipe.paddingUnit.repeat(remaining);
  const raw = exportMystProjectSnapshot(base);
  assert.equal(Buffer.byteLength(JSON.stringify(raw)), fixture.limits.persistedBytes);
  const snapshot = importMystProjectSnapshot(raw);
  assert.throws(() => replaceMystProjectResource(snapshot, 'b.md', base.files[1].text + 'a'), /persisted contribution/);
  assert.throws(() => importMystProjectSnapshot(raw + ' '), /persisted contribution/);
  const small = exportMystProjectSnapshot(parseMystProjectSnapshot(fixture.cases[0].snapshot));
  const padded = small + ' '.repeat(fixture.limits.persistedBytes - Buffer.byteLength(JSON.stringify(small)));
  importMystProjectSnapshot(padded);
  assert.throws(() => importMystProjectSnapshot(padded + ' '), /persisted contribution/);
});
