import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile as compileTypeSpec, NodeHost, logDiagnostics } from '@typespec/compiler';
import { compile } from 'json-schema-to-typescript';
import { scriptOptions } from '../lib/options.mjs';

const { root, outDir, check } = scriptOptions('protocol/generated');

// TypeSpec emits one $id per type; rewrite to a self-contained $defs bundle that
// ajv, json-schema-to-typescript, typify and datamodel-code-generator all read.
const emit = async (name) => {
  const files = new Map();
  // Intermediate bundles stay in memory, including in --check mode.
  const host = {
    ...NodeHost,
    mkdirp: async () => {},
    writeFile: async (path, content) => { files.set(resolve(path), content); },
    logSink: { log: message => NodeHost.logSink.log(message) },
  };
  const program = await compileTypeSpec(host, resolve(root, 'protocol', `${name}.tsp`), {
    emit: ['@typespec/json-schema'],
    outputDir: outDir,
    warningAsError: true,
    options: { '@typespec/json-schema': { 'file-type': 'json', bundleId: `${name}.schema.json` } },
  });
  if (program.hasError()) {
    logDiagnostics(program.diagnostics, NodeHost.logSink);
    throw new Error(`TypeSpec compilation failed: ${name}`);
  }
  const bundle = files.get(resolve(outDir, '@typespec/json-schema', `${name}.schema.json`));
  if (!bundle) throw new Error(`TypeSpec did not emit ${name}.schema.json`);
  return JSON.parse(bundle);
};

// `...Record<never>` emits `{ not: {} }`, i.e. no further properties are allowed.
const closed = (value) => JSON.stringify(value) === '{"not":{}}';
const normalize = (node) => {
  if (Array.isArray(node)) return node.map(normalize);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema' || key === '$id') continue;
    if (key === '$ref' && typeof value === 'string') out.$ref = value.startsWith('#/') ? value : `#/$defs/${value.replace(/\.json$/, '')}`;
    // Models are spread, never composed, so unevaluated and additional properties agree.
    else if (key === 'unevaluatedProperties') out.additionalProperties = closed(value) ? false : normalize(value);
    else out[key] = normalize(value);
  }
  return out;
};
async function generate(name, title, roots) {
const emitted = await emit(name);
const $defs = Object.fromEntries(Object.entries(emitted.$defs).sort(([a], [b]) => a.localeCompare(b))
  .map(([name, schema]) => [name, { title: name, ...normalize(schema) }]));
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://openpero.com/protocol/${name}.schema.json`,
  title,
  description: `Generated from protocol/${name}.tsp. Do not edit.`,
  oneOf: roots.map(type => ({ $ref: `#/$defs/${type}` })),
  $defs,
};
const types = (await compile(structuredClone(schema), title, {
  additionalProperties: false, bannerComment: `/* Generated from protocol/${name}.tsp by scripts/codegen/contracts.mjs. Do not edit. */`,
  strictIndexSignatures: true, unreachableDefinitions: true, format: true,
})).replaceAll('\r\n', '\n');

const outputs = {
  [resolve(outDir, `${name}.schema.json`)]: JSON.stringify(schema, null, 2) + '\n',
  [resolve(outDir, `${name}.ts`)]: types,
};
if (!check) mkdirSync(outDir, { recursive: true });
for (const [path, output] of Object.entries(outputs)) {
  if (check) {
    let current = '';
    try { current = readFileSync(path, 'utf8'); } catch {}
    if (current.replaceAll('\r\n', '\n') !== output) throw new Error(`${path} is stale. Run npm run gen:contracts`);
  } else writeFileSync(path, output);
}
}
await generate('host', 'HostProtocol', ['HostInput', 'HostEvent']);
await generate('remote', 'RemoteProtocol', ['RemoteProtocol']);
