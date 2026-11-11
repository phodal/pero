import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseMystImageData, safeMystImageDataUri, MYST_ASSET_MAX_BYTES } from '../src/myst-assets.ts';
import { parseMystProjectSnapshot, exportMystProjectSnapshot, importMystProjectSnapshot, replaceMystProjectResource } from '../src/myst-project-snapshot.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/myst-assets-contract.json', import.meta.url), 'utf8'));
const envelope = (assets: unknown[]) => ({format:'pero-myst-project', version:2, entry:'a.md', files:[{path:'a.md',text:'![Exact](images/a.png)\r\n'}], assets});

test('shared binary corpus admits bounded canonical raster headers and retains unsupported bytes inertly', () => {
  for (const item of fixture.cases) {
    if (!item.accepted) { assert.throws(() => parseMystImageData(item.mediaType, item.base64), undefined, item.name); continue; }
    const result = parseMystImageData(item.mediaType, item.base64);
    assert.equal(result.base64, item.base64);
    assert.equal(result.renderable, item.renderable);
    assert.equal(result.byteLength, Buffer.from(item.base64, 'base64').length);
    assert.equal(safeMystImageDataUri(result), item.renderable ? `data:${item.mediaType};base64,${item.base64}` : undefined);
    if (item.renderable) { assert.equal(result.width, 2); assert.equal(result.height, 3); }
  }
  const base64 = Buffer.alloc(MYST_ASSET_MAX_BYTES).toString('base64');
  assert.equal(parseMystImageData('application/octet-stream', base64).byteLength, MYST_ASSET_MAX_BYTES);
  assert.throws(() => parseMystImageData('application/octet-stream', Buffer.alloc(MYST_ASSET_MAX_BYTES + 1).toString('base64')));
});

test('v2 assets retain bytes and version through edit and bundle roundtrip without weakening v1', () => {
  const assets = fixture.cases.filter((item: {accepted: boolean}) => item.accepted).map((item: {mediaType:string;base64:string}, index:number) => ({path:`images/${index}.bin`,mediaType:item.mediaType,base64:item.base64}));
  const project = parseMystProjectSnapshot(envelope(assets));
  const edited = replaceMystProjectResource(project, 'a.md', 'Changed 🧪');
  assert.deepEqual(edited.assets, project.assets);
  assert.deepEqual(JSON.parse(exportMystProjectSnapshot(edited)).assets, assets);
  assert.deepEqual(importMystProjectSnapshot(exportMystProjectSnapshot(project)), project);
  assert.equal(JSON.parse(exportMystProjectSnapshot(parseMystProjectSnapshot(envelope([])))).version, 2);
  const {assets: omitted, ...v1} = envelope([]);
  assert.equal(JSON.parse(exportMystProjectSnapshot(parseMystProjectSnapshot({...v1,version:1}))).version, 1);
  for (const bad of [{...v1}, {...v1,version:1,assets:[]}, {...envelope([]),extra:1}, envelope([{...assets[0],path:'../escape'}]), envelope([{...assets[0],path:'a.md'}]), envelope([assets[0],assets[0]]), envelope(Array.from({length:32},(_,i)=>({...assets[0],path:`${i}.png`})))] ) {
    assert.throws(() => parseMystProjectSnapshot(bad));
  }
});
