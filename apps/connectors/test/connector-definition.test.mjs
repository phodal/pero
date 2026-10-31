import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDefinition, validateResearchSettings, mergeResearchDiscovery, secretReferences } from '../ui-src/connector-definition.mjs';

test('PubMed requires a contact email and rediscovery retains inputs without losing frozen launch files', () => {
  for (const email of ['', 'missing-at', 'a@b', ' a@b.example']) assert.equal(validateResearchSettings('science-pubmed', { env: { NCBI_EMAIL: email } }, 'en').field, 'NCBI_EMAIL');
  assert.equal(validateResearchSettings('science-pubmed', { env: { NCBI_EMAIL: 'researcher@example.org' } }), null);
  const discovered = { command: '/node', args: ['/adapter', '--domain', 'pubmed'], files: [{ path: '/adapter', sha256: 'a'.repeat(64) }], env: { POINT_SCIENCE_ROOT: '/runtime', POINT_SCIENCE_SOURCE_SHA256: 'b'.repeat(64) }, tools: ['search_articles'] };
  const merged = mergeResearchDiscovery({ args: [], tools: [], env: { NCBI_EMAIL: 'researcher@example.org', NCBI_API_KEY: { secretRef: 'pubmed.key' }, POINT_SCIENCE_ROOT: '/stale' } }, discovered);
  assert.deepEqual(merged.args, discovered.args); assert.deepEqual(merged.files, discovered.files);
  assert.deepEqual(merged.tools, []);
  assert.equal(merged.env.POINT_SCIENCE_ROOT, '/runtime'); assert.equal(merged.env.NCBI_EMAIL, 'researcher@example.org'); assert.deepEqual(merged.env.NCBI_API_KEY, { secretRef: 'pubmed.key' });
});
import { pointCatalog, providerIdForDefinition, suppliedKeys } from '../../../packages/connectors/src/connectors/catalog.mjs';
import { validateConnector } from '../../../packages/connectors/src/control.mjs';
import { mkdtemp, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { discoverProvider } from '../../../packages/connectors/src/connectors/discovery.mjs';

const catalog = pointCatalog();
test('research OAuth presets can be saved without a client ID and retain minimal scopes', async () => {
  for (const [id, scopes, count] of [['scite', ['mcp'], 0], ['synapse', ['openid', 'view'], 5]]) {
    const provider = catalog.provider(id);
    const definition = seedDefinition(provider);
    assert.equal(definition.oauth.registration, 'dcr');
    assert.equal(definition.oauth.clientId, undefined);
    assert.deepEqual(definition.oauth.scopes, scopes);
    assert.equal(definition.tools.length, count);
    assert.equal(providerIdForDefinition(definition), id);
    assert.deepEqual(await validateConnector(definition), definition);
    assert.ok(provider.operations.every(operation => operation.effect === 'read'));
    assert.equal(provider.launchGatePassed, false);
  }
});

test('Zotero manual and discovered definitions agree on local read access', async t => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'point-zotero-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const command = join(home, 'zotero-mcp');
  const content = '#!/bin/sh\nexit 99\n';
  await writeFile(command, content, { mode: 0o755 });
  const sha256 = createHash('sha256').update(content).digest('hex');
  const provider = catalog.provider('zotero');
  const manual = seedDefinition(provider);
  const discovered = await discoverProvider(provider, { env: { PATH: '', ZOTERO_API_KEY: 'must-not-leak' }, homedir: home, extraDirs: [home] });
  assert.equal(discovered.definition.command, command);
  assert.equal(discovered.definition.sha256, sha256);
  for (const definition of [manual, discovered.definition]) {
    assert.deepEqual(definition.args, ['serve']);
    assert.equal(definition.env.ZOTERO_LOCAL, 'true');
    assert.equal(definition.env.ZOTERO_MCP_TOOLSETS, 'none');
    assert.equal(definition.env.ZOTERO_API_KEY, undefined);
    assert.equal(definition.tools.length, 8);
    assert.ok(definition.tools.every(name => !/write|create|delete|update|add|manage|authorize/.test(name)));
    const pinned = { ...definition, command, sha256 };
    assert.equal(providerIdForDefinition(pinned), 'zotero');
    assert.deepEqual(await validateConnector(pinned), pinned);
  }
  assert.equal(provider.installHint, 'uv tool install zotero-mcp-server==0.9.1');
});

test('unaccepted providers are documentation candidates, not connection presets', () => {
  for (const id of ['onshape', 'quilt', 'wiley', 'biorender']) {
    const provider = catalog.provider(id);
    assert.equal(provider.listed, true);
    assert.equal(provider.preregistered, false);
    assert.equal(provider.launchGatePassed, false);
    assert.equal(provider.endpoint, undefined);
    assert.deepEqual(provider.defaultTools, []);
    assert.ok(provider.prerequisiteEn);
    assert.ok(provider.gotchaEn);
  }
});

test('existing providers keep required launch environments, headers and explicit empty allowlists', () => {
  assert.equal(seedDefinition(catalog.provider('foxglove')).allowLoopbackHttp, true);
  assert.deepEqual(seedDefinition(catalog.provider('labkey')).headers, { apikey: { secretRef: 'labkey.api-key' } });
  assert.equal(seedDefinition(catalog.provider('biocontext')).env.MCP_ENVIRONMENT, 'DEVELOPMENT');
  const synapse = catalog.provider('synapse');
  assert.deepEqual(seedDefinition({ ...synapse, defaultTools: [] }).tools, []);
  const before = structuredClone(synapse);
  seedDefinition(synapse).tools.push('must-not-mutate-directory');
  assert.deepEqual(synapse, before);
});


test('computing presets pin discovered executables, carry only explicit credentials, and satisfy configuration requirements', async t => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'point-computing-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const content = '#!/bin/sh\nexit 99\n';
  const sha256 = createHash('sha256').update(content).digest('hex');
  for (const [id, executable] of [['mlflow', 'mlflow'], ['galaxy', 'galaxy-mcp'], ['jupyter', 'jupyter-mcp-server'], ['r-mcptools', 'Rscript']]) {
    const command = join(home, executable);
    await writeFile(command, content, { mode: 0o755 });
    const provider = catalog.provider(id);
    const manual = seedDefinition(provider);
    const discovered = await discoverProvider(provider, { env: { PATH: '', GALAXY_API_KEY: 'must-not-leak', JUPYTER_TOKEN: 'must-not-leak', MLFLOW_TRACKING_TOKEN: 'must-not-leak' }, homedir: home, extraDirs: [home] });
    assert.equal(discovered.definition.command, command);
    assert.equal(discovered.definition.sha256, sha256);
    for (const [key, value] of Object.entries(manual.env ?? {})) assert.deepEqual(discovered.definition.env[key], value);
    for (const definition of [manual, discovered.definition]) {
      assert.deepEqual(definition.args, provider.stdioTemplate.args);
      assert.deepEqual(definition.tools, provider.defaultTools);
      assert.equal(definition.env?.MLFLOW_TRACKING_TOKEN, undefined);
      if (id === 'jupyter') {
        assert.equal(definition.env.START_NEW_CODE_SANDBOX, 'false');
        assert.equal(validateResearchSettings(id, definition, 'en').field, 'DOCUMENT_ID');
        definition.env.DOCUMENT_ID = 'experiments/results.ipynb';
      }
      const pinned = { ...definition, command, sha256 };
      assert.equal(validateResearchSettings(id, pinned), null);
      assert.equal(providerIdForDefinition(pinned), id);
      const supplied = suppliedKeys(pinned);
      assert.ok(provider.requires.filter(r => r.required).every(r => supplied.includes(r.key)), id);
      assert.deepEqual(await validateConnector(pinned), pinned);
      assert.ok(provider.operations.every(op => op.effect === 'read'));
    }
  }
});

test('computing HTTP presets preserve authentication, loopback scope, and conservative tool defaults', async () => {
  for (const id of ['wolfram', 'wandb', 'autodesk-fusion']) {
    const definition = seedDefinition(catalog.provider(id));
    assert.equal(providerIdForDefinition(definition), id);
    assert.deepEqual(await validateConnector(definition), definition);
    if (id === 'wolfram') assert.deepEqual(definition.tools, ['WolframAlpha', 'WolframContext']);
    else assert.deepEqual(definition.tools, []);
  }
  const wandb = seedDefinition(catalog.provider('wandb'));
  assert.deepEqual(wandb.headers.Authorization, { secretRef: 'wandb.token' });
  assert.ok(suppliedKeys(wandb).includes('token'));
  delete wandb.headers;
  assert.ok(!suppliedKeys(wandb).includes('token'));
  const fusion = seedDefinition(catalog.provider('autodesk-fusion'));
  assert.equal(fusion.allowLoopbackHttp, true);
  await assert.rejects(validateConnector({ ...fusion, url: 'http://example.com:27182' }));
  assert.notEqual(providerIdForDefinition({ ...fusion, url: 'https://example.com/' }), 'autodesk-fusion');
  assert.equal(providerIdForDefinition({ transport: 'stdio', command: '/usr/bin/mlflow', args: ['server'] }), 'local-process');
  assert.equal(providerIdForDefinition({ transport: 'stdio', command: '/usr/bin/Rscript', args: ['-e', 'other()', 'mcptools::mcp_server()'] }), 'local-process');
});

test('research forms reject credential URLs and invalid notebook paths; rediscovery preserves edits', () => {
  for (const value of ['', 'ftp://example.com', 'https://secret@example.com', 'https://example.com?token=secret', 'https://example.com#token']) {
    const problem = validateResearchSettings('mlflow', { env: { MLFLOW_TRACKING_URI: value } }, 'en');
    assert.equal(problem.field, 'MLFLOW_TRACKING_URI');
    assert.match(problem.message, /^Enter/);
  }
  for (const path of ['', '/tmp/x.ipynb', '../x.ipynb', 'a/../x.ipynb', 'x.py']) {
    const draft = seedDefinition(catalog.provider('jupyter'));
    draft.env.DOCUMENT_ID = path;
    assert.equal(validateResearchSettings('jupyter', draft).field, 'DOCUMENT_ID');
  }
  const current = { ...seedDefinition(catalog.provider('galaxy')), tools: [], env: { GALAXY_URL: 'https://galaxy.example.org', GALAXY_API_KEY: { secretRef: 'custom.key' } } };
  const merged = mergeResearchDiscovery(current, { ...seedDefinition(catalog.provider('galaxy')), command: '/new/galaxy-mcp', sha256: 'a'.repeat(64), env: { HOME: '/home/test' } });
  assert.equal(mergeResearchDiscovery({ ...current, command: '/custom/galaxy-mcp', sha256: 'b'.repeat(64) }, { command: '', sha256: '' }).command, '/custom/galaxy-mcp');
  assert.equal(merged.command, '/new/galaxy-mcp');
  assert.equal(merged.sha256, 'a'.repeat(64));
  assert.deepEqual(merged.tools, []);
  assert.deepEqual(merged.env, { HOME: '/home/test', ...current.env });
});

test('credential references come from the definition, so OAuth-only connectors ask for no secret', () => {
  assert.deepEqual(secretReferences(seedDefinition({ providerId: 'gitlab', transport: 'gitlab', operations: [] })), ['gitlab.token']);
  assert.deepEqual(secretReferences(seedDefinition({ providerId: 'm365', transport: 'microsoft365', operations: [], auth: { recommendedScopes: [] } })), []);
  assert.deepEqual(secretReferences({ env: { A: { secretRef: ' a ' }, B: { secretRef: 'b' } }, headers: { X: { secretRef: 'a' } } }), ['a', 'b']);
  assert.deepEqual(secretReferences(null), []);
});
