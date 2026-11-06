// The shared adapter must leave finalization available when Host owns the budget.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const directory = await mkdtemp(join(tmpdir(), 'pero-research-plugin-budget-'));
try {
  const module = join(directory, 'binding.mjs');
  await build({ stdin: { contents: "export { AppAgentPluginBinding } from './desktop/src/main/app-agent-plugin.ts';", resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile: module });
  const { AppAgentPluginBinding } = await import(pathToFileURL(module).href);
  const revision = 'a'.repeat(64);
  const routes = ['research-program', 'research-deliver'].map(name => ({ app: 'paper-agent', panel: 'main',
    version: '1', revision, name, description: name, path: '/api/programs/agent', schema: { type: 'object' } }));
  const declaration = { app: 'paper-agent', revision, maxCalls: 1,
    tools: routes.map(({ name, description, path, schema }) => ({ name, description, path, schema })) };
  for (const mode of ['ordinary-default', 'ordinary-explicit', 'host-budgeted']) {
    const flags = mode === 'ordinary-default' ? {} : { hostBudgeted: mode === 'host-budgeted' };
    let binding = AppAgentPluginBinding.bind({ ...declaration, ...flags }, { app: 'paper-agent', panel: 'main' });
    binding = binding.consume(routes[0], routes);
    if (mode === 'host-budgeted') {
      // Repeated feedback and checkpoint delivery still reach the Host's durable budget owner.
      for (let attempt = 0; attempt < 3; attempt++) {
        binding = binding.consume(routes[0], routes);
        binding = binding.consume(routes[1], routes);
      }
      assert.deepEqual(binding.definitions(routes), routes, mode);
    } else {
      assert.deepEqual(binding.definitions(routes), [], mode);
      for (const route of routes)
        assert.throws(() => binding.consume(route, routes), error => error.code === 'APP_PLUGIN_BUDGET', mode);
    }
  }
  console.log('Paper research plugin budget: Host-owned finalizers remain available; ordinary limits remain enforced.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
