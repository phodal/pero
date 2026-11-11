// Run the pinned official tool-skill pre-step hook at mocked registration,
// snapshot and session seams. This is not a full DSH runtime/provider A/B.
// Usage: node scripts/harness/compare-skill-catalog.mjs /path/to/index.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(process.argv[2]);
const blob = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
assert.equal(blob, 'f08fb8206433bb40ec415c65e9a50382386a3bd0', 'requires the pinned official source, unchanged');
const fixtures = JSON.parse(readFileSync(new URL('../../harness/go/skills/testdata/catalog-publication.json', import.meta.url)));
const code = stripTypeScriptTypes(source.toString(), { mode: 'strip' })
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\n/gm, '')
  .replace(/^export /gm, '');
let id = 0;
const context = vm.createContext({
  createHash,
  z: { object: value => value, number: () => ({ default: value => value }) },
  defineTool: value => value,
  createUserMessage: value => ({ id: `fixture-${++id}`, role: 'user', ...value }),
  SessionSeq: value => value,
  isModelInvocable: value => !value.disableModelInvocation,
  // Inputs are ASCII summaries. No Skill loading/gesture path is executed.
  escapeText: value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
});
vm.runInContext(`${code}\nglobalThis.applyCatalogPlugin = apply;`, context);
const results = [];
for (const fixture of fixtures) {
  const listeners = [];
  const events = [];
  let surface = [], entries = [], visible = false, tool;
  const agent = { session: {
    get seq() { return events.length; },
    get surface() { return { nodes: surface }; },
    eventAt: seq => events[seq],
  } };
  context.applyCatalogPlugin({
    tools: { register: value => { tool = value; }, get: () => visible ? tool : undefined },
    skills: { snapshot: async () => ({ skills: entries, complete: true }) },
    workingDirectory: { ensure: async () => '/approved-fixture' },
    on: (event, listener) => { assert.equal(event, 'agent/pre-step'); listeners.push(listener); },
  });
  assert.equal(listeners.length, 2);
  const observations = [];
  for (const [index, step] of fixture.steps.entries()) {
    ({ entries, visible } = step);
    if (step.compact) surface = [];
    const decision = await listeners[1]({ agent, signal: new AbortController().signal }, async () => ({ kind: 'continue', messages: [] }));
    const published = decision.messages.length !== 0;
    assert.equal(published, step.publish, `${fixture.name} step ${index}: publication`);
    const observation = { publish: published };
    if (published) {
      assert.equal(decision.messages.length, 1);
      const message = decision.messages[0];
      observation.update = message.source.update === true;
      observation.names = Array.from(message.source.entries, entry => entry.name);
      assert.equal(message.role, 'user');
      assert.equal(message.source.kind, 'skill-catalog');
      assert.equal(observation.update, step.update);
      assert.deepEqual(observation.names, step.names);
      const seq = events.length;
      events.push({ seq, type: 'user/message', data: message });
      surface.push(seq);
    }
    observations.push(observation);
  }
  results.push({ name: fixture.name, observations });
}
console.log(JSON.stringify({ officialRef: 'f3803c96974ad4a94195fb97e5c637e9c2a3afe3', blob, scope: 'actual official catalog hook; mocked registration/snapshot/session seams; same fixture as Go TestCatalogPublicationTransitions', results }, null, 2));
