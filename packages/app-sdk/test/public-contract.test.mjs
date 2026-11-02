import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const root = new URL('../',import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json',root),'utf8'));
const contract = JSON.parse(await readFile(new URL('contracts/public-exports.json',import.meta.url),'utf8'));

test('every public module builds with its complete runtime export contract', async () => {
  for (const [entry,expected] of Object.entries(contract.entries)) {
    assert(pkg.exports[entry],`Missing module entry ${entry}`);
    const result=await build({entryPoints:[new URL(pkg.exports[entry],root).pathname],bundle:true,write:false,metafile:true,format:'esm',platform:'browser',packages:'external',loader:{'.css':'empty'},logLevel:'silent'});
    const actual=Object.values(result.metafile.outputs).find(output=>output.entryPoint).exports;
    assert.deepEqual(expected.filter(name=>!actual.includes(name)),[],`Missing exports from ${entry}`);
  }
});
