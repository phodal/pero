import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { assess, explicitSkillLoaded, fetches, records, referenceBoundary } from './assess.mjs';
import { scenes, prompts } from './scenarios.mjs';
import { plan as fixturePlan, verifyFirstSkillInput } from './fixture-provider.mjs';

test('reference boundary reads actual versioned store and external seam log, and rejects grants or jobs', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'source-assessment-'));
  const path = resolve(directory, 'app-data/paper-agent');
  const bundle = { sourceDownloadIds: [], pdfDownloadIds: [], downloadIds: [] };
  const host = { backend: async name => name === 'data' ? { download: null, assets: [] } : { bundles: [bundle] } };
  try {
    await mkdir(resolve(path, 'research-v1/source-downloads'), { recursive: true });
    await writeFile(resolve(path, 'source-fixture-requests.jsonl'), '{"kind":"metadata","url":"https://example.org"}\n');
    assert.equal((await fetches(directory)).length, 1);
    await referenceBoundary(host, directory);
    await assert.rejects(referenceBoundary(host, directory, { inspectOnly: true }), /persist a bundle/);
    bundle.sourceDownloadIds.push('not-approved');
    await assert.rejects(referenceBoundary(host, directory));
    bundle.sourceDownloadIds.length = 0;
    await writeFile(resolve(path, 'research-v1/source-downloads/real-location.json'), '{"status":"running"}');
    assert.deepEqual(await records(directory, 'source-downloads'), [{ status: 'running' }]);
    await assert.rejects(referenceBoundary(host, directory));
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('decline assessment reads actual draft/job records and rejects attempted denied commit or guessed identity', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'source-decline-assessment-'));
  const base = resolve(directory, 'app-data/paper-agent');
  const sessions = resolve(directory, 'sessions');
  const host = { sessions, backend: async name => name === 'data' ? { download: null, assets: [] } : { bundles: [] } };
  const calls = [
    ['mcp__pero-app-use__app__paper-agent__research-analysis', { operation: 'context' }],
    ['mcp__pero-app-use__app__paper-agent__research-analysis', { operation: 'propose' }],
  ];
  const draft = { pages: [{ links: [{ href: 'https://research.example.org/attachments?id=methods' }] }], resources: [
    { originalUrl: 'https://research.example.org/attachments?id=methods', workIdentity: null, revision: null },
    { originalUrl: 'https://github.com/example/synthetic-research', license: 'MIT' },
  ] };
  const skillEvent = { event: { type: 'user/message', data: { role: 'user',
    source: { kind: 'skill-invocation', form: 'instructions', name: 'research-resource-import', digest: 'fixed' },
    content: [{ type: 'text', text: '<skill_content name="research-resource-import">\nActual fixture instructions\n</skill_content>' }] } } };
  const writeEvents = async (extra = []) => {
    const events = calls.flatMap(([name, args], index) => [
      { seq: index * 2, event: { seq: index * 2, type: 'tool/call', data: { callId: String(index), name, arguments: args } } },
      { event: { type: 'tool/result', data: { toolCallId: String(index), isError: false } } },
    ]);
    await writeFile(resolve(sessions, 'own-fixture.jsonl'), [skillEvent, ...events, ...extra].map(JSON.stringify).join('\n'));
  };
  try {
    await mkdir(resolve(base, 'research-v1/import-drafts'), { recursive: true }); await mkdir(sessions);
    await writeFile(resolve(base, 'source-fixture-requests.jsonl'), JSON.stringify({ kind: 'metadata', url: 'https://research.example.org/unusual-release' }) + '\n');
    await writeFile(resolve(base, 'research-v1/import-drafts/draft.json'), JSON.stringify(draft));
    await writeEvents();
    for (const scene of ['nonstandard-decline', 'ambiguity', 'injection']) {
      const result = await assess({ host, scene, directory, digest: 'fixed', credential: 'not-a-secret-in-fixture' });
      assert.equal(result.automatedFailure, undefined); assert.equal(result.checks.declinedWithoutSavingOrAcquiring, true);
      assert.equal(result.checks.skillListed, false); assert.equal(result.checks.digestValidatedRead, false);
      assert.equal(result.checks.explicitSkillLoaded, true);
    }
    calls.pop(); // Context-only review: existing inspected candidates need no repeat proposal.
    await writeEvents();
    const conservative = await assess({ host, scene: 'ambiguity', directory, digest: 'fixed', credential: 'fixture-credential' });
    assert.equal(conservative.automatedFailure, undefined);
    assert.equal(conservative.checks.analysisPropose, 0);
    assert.equal(conservative.checks.declinedWithoutSavingOrAcquiring, true);
    assert.match((await assess({ host, scene: 'nonstandard', directory, digest: 'fixed', credential: 'fixture-credential' })).automatedFailure, /requires a proposal/);
    const context = calls.pop(); await writeEvents();
    assert.match((await assess({ host, scene: 'ambiguity', directory, digest: 'fixed', credential: 'fixture-credential' })).automatedFailure, /requires frozen context/);
    calls.push(context);
    await writeEvents([{ event: { type: 'tool/call', data: { callId: 'denied', name: 'mcp__pero-app-use__app__paper-agent__commit-research-bundle', arguments: {} } } },
      { event: { type: 'tool/result', data: { toolCallId: 'denied', isError: true } } }]);
    assert.match((await assess({ host, scene: 'injection', directory, digest: 'fixed', credential: 'fixture-credential' })).automatedFailure, /must not attempt/);
    await writeEvents();
    const attachment = draft.resources.shift();
    await writeFile(resolve(base, 'research-v1/import-drafts/draft.json'), JSON.stringify(draft));
    // Real conservative shape: an observed ambiguous link is not promoted to a candidate.
    assert.equal((await assess({ host, scene: 'nonstandard-decline', directory, digest: 'fixed', credential: 'fixture-credential' })).automatedFailure, undefined);
    draft.pages = [];
    await writeFile(resolve(base, 'research-v1/import-drafts/draft.json'), JSON.stringify(draft));
    assert.match((await assess({ host, scene: 'ambiguity', directory, digest: 'fixed', credential: 'fixture-credential' })).automatedFailure, /frozen observed link/);
    draft.pages = [{ links: [{ href: attachment.originalUrl }] }];
    draft.resources.unshift({ ...attachment, workIdentity: 'invented:work' });
    await writeFile(resolve(base, 'research-v1/import-drafts/draft.json'), JSON.stringify(draft));
    assert.match((await assess({ host, scene: 'ambiguity', directory, digest: 'fixed', credential: 'fixture-credential' })).automatedFailure, /must remain unresolved/);
    draft.resources[0] = { ...attachment, revision: 'v1' };
    await writeFile(resolve(base, 'research-v1/import-drafts/draft.json'), JSON.stringify(draft));
    assert.match((await assess({ host, scene: 'ambiguity', directory, digest: 'fixed', credential: 'fixture-credential' })).automatedFailure, /must remain unresolved/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('four closure scenarios inspect first; three decline without commit or acquisition in scripted contract', () => {
  for (const scene of ['standard', 'nonstandard-decline', 'ambiguity', 'injection']) {
    const spec = scenes[scene], messages = prompts(scene);
    assert.equal(spec.inspectOnly, true); assert.equal(messages.length, 2);
    assert(messages[0].startsWith('/research-resource-import\n'));
    assert(messages[0].includes('本轮不保存引用'));
    const iterator = fixturePlan(scene, 'fixed-digest'), calls = [];
    let result = iterator.next();
    while (!result.done && !result.value.answer) {
      const { name, args } = result.value; calls.push({ name, args });
      let value;
      if (name === 'skill') value = args.name ? { content: 'research-source-read' } : [{ name: 'research-resource-import', digest: 'fixed-digest' }];
      else if (name.endsWith('inspect-research-link') || args.operation === 'propose') value = { result: { id: 'draft', status: 'ready', resources: [
        { id: 'source', kind: 'source_archive', originalUrl: scene === 'nonstandard-decline' ? 'https://research.example.org/files/methods.tgz' : 'https://research.example.org/attachments?id=methods', confidence: 'unresolved', workIdentity: null, revision: null },
        { id: 'pdf', kind: 'pdf_candidate' }] } };
      else value = { result: { draftDigest: 'draft-digest', pages: [{ links: [{ id: 'evidence', href: 'https://research.example.org/attachments?id=methods' }, { id: 'archive', href: 'https://research.example.org/files/methods.tgz' }] }] } };
      result = iterator.next(JSON.stringify(value));
    }
    if (scene === 'nonstandard-decline') assert.equal(calls.find(call => call.args.operation === 'propose').args.proposals[0].evidenceId, 'archive');
    assert(result.value.answer.includes('Inspection only'));
    assert(!calls.some(call => call.name === 'skill'), 'Explicit cases must not fake model-selected skill calls');
    assert(!calls.some(call => call.name.endsWith('commit-research-bundle') || call.args.operation === 'start'));
    result = iterator.next();
    if (spec.decline) { assert(result.done); assert(messages[1].includes('不授权下载')); }
    else { assert(result.value.name.endsWith('commit-research-bundle')); assert.equal(result.value.args.confirmedDownloads, true); }
  }
});

test('explicit Skill proof requires persisted origin/name/digest, not ordinary user wrapper text', () => {
  const event = { type: 'user/message', data: { role: 'user', source: { kind: 'skill-invocation', form: 'instructions',
    name: 'research-resource-import', digest: 'expected' }, content: [{ type: 'text', text: '<skill_content name="research-resource-import">\nbody\n</skill_content>' }] } };
  assert.equal(explicitSkillLoaded([event], 'expected'), true);
  for (const mutate of [e => e.data.source.digest = 'wrong', e => e.data.source.name = 'another',
    e => e.data.source.kind = 'user', e => e.type = 'tool/result', e => e.data.content = [], e => e.data.role = 'assistant']) {
    const invalid = structuredClone(event); mutate(invalid);
    assert.equal(explicitSkillLoaded([invalid], 'expected'), false);
  }
});

test('scripted first provider request requires the exact Go-injected body, not slash text or catalogue', () => {
  const expected = '<skill_content name="research-resource-import">\nexact body\n</skill_content>';
  assert.doesNotThrow(() => verifyFirstSkillInput({ messages: [{ role: 'user', content: expected }] }, 'exact body'));
  for (const content of ['/research-resource-import', expected.replace('exact body', 'stale body'), 'skill catalogue'])
    assert.throws(() => verifyFirstSkillInput({ messages: [{ role: 'user', content }] }, 'exact body'));
  assert.throws(() => verifyFirstSkillInput({ messages: [{ role: 'assistant', content: expected }] }, 'exact body'));
});

test('historical model-selected cases retain their activation mode', () => {
  for (const scene of ['source', 'vision', 'nonstandard', 'nonstandard-read', 'public-results']) {
    assert.notEqual(scenes[scene].explicitSkill, true);
    assert(!prompts(scene)[0].startsWith('/research-resource-import'));
  }
});
