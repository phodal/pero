import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { preparePointApp } from './install.mjs';

test('Point install preserves executable inputs and starts with fresh domain data', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'point-install-contract-'));
  try {
    const source = resolve(root, 'source'), runtime = resolve(root, 'runtime'), output = resolve(root, 'output');
    await mkdir(resolve(source, 'ui/dist'), { recursive: true });
    await mkdir(resolve(source, 'data'));
    await mkdir(resolve(runtime, 'licenses'), { recursive: true });
    const manifest = JSON.stringify({ name:'sample', version:'1.0.0', displayName:'Sample', permissions:{api:[]}, contributes:{panelTabs:[{id:'sample',title:'Sample',entry:'dist/index.mjs'}]} });
    await writeFile(resolve(source, 'app.json'), manifest);
    await writeFile(resolve(source, 'ui/dist/index.mjs'), 'export default function Sample() {}');
    await writeFile(resolve(source, 'data/config.json'), '{"private":"source-only"}');
    await writeFile(resolve(source, 'installed.json'), '{"enabled":true}');
    for (const [name, body] of [['frame.js','// runtime fixture'],['frame.css','/* fixture */'],['runtime.json','{"schema":"fixture"}']]) await writeFile(resolve(runtime,name),body);
    const result = await preparePointApp({ source, runtime, destination: output });
    assert.equal(result.manifest.name,'sample');
    assert.equal(await readFile(resolve(output,'dist/point-ui/dist/index.mjs'),'utf8'), await readFile(resolve(source,'ui/dist/index.mjs'),'utf8'));
    assert.equal(await readFile(resolve(source,'app.json'),'utf8'),manifest);
    await assert.rejects(access(resolve(output,'point-source/data')));
    await assert.rejects(access(resolve(output,'point-source/installed.json')));
    await assert.rejects(preparePointApp({source,runtime,destination:output}), /EEXIST/);
    await writeFile(resolve(source,'ui/dist/index.mjs'), 'const pages = globalThis.__point_modules?.["@point/pages-ui"];');
    await assert.rejects(preparePointApp({source,runtime,destination:resolve(root,"missing-module")}), /Unsupported Point shared module: @point\/pages-ui/);
    await assert.rejects(access(resolve(root,"missing-module")));
  } finally { await rm(root,{recursive:true,force:true}); }
});
