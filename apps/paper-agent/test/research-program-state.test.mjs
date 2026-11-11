import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

async function fixture(t, hostCallFn) {
  const f = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'),
    contents: "export { useResearchProgramState } from './research-program-state'; export { ResearchPrograms } from './research-programs'; export { AppApiProvider, appSurface } from '@pero/app-sdk';" });
  let state;
  function Workspace({ api, seed, active }) { state = f.ui.useResearchProgramState(api, seed, active); return null; }
  const mount = (api, active = true, seed = null) => f.render(f.React.createElement(f.ui.AppApiProvider, {
    appName: 'paper-agent', locale: 'en', allowedApiPaths: ['/api'], surface: f.ui.appSurface,
    allowedHostCapabilities: hostCallFn ? ['agent'] : [], hostCallFn,
    allowedEvents: [], subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {},
  }, f.React.createElement(Workspace, { api, seed, active })));
  return { ...f, mount, get state() { return state; } };
}

const limits = { rounds: 3, searches: 8, candidates: 24, reads: 24, downloads: 6, downloadBytes: 62914560, modelRequests: 40, appCalls: 80 };
const program = id => ({ id, checkpoint: 'ready',
  protocol: { question: `Saved question ${id}`, scope: 'fixed scope', inclusion: 'include', exclusion: 'exclude', seedPaperIds: ['paper1'], acquisition: 'saved_only', limits, deadline: '2027-01-01' },
  usage: { ...limits, rounds: 2 }, runtime: null, candidates: [], rounds: [], gaps: [], stopReason: null, jobs: [],
});

test('saved research pages remain readable without Agent or execution prerequisites', async t => {
  const f = await fixture(t), saved = program('p1');
  const api = { get: async () => { throw Error('execution configuration unavailable'); }, post: async (_path, request) => {
    if (request.operation === 'list') return { programs: [saved] };
    return { ...saved, roundPage: { offset: request.roundOffset, total: 2, nextOffset: request.roundOffset ? null : 1 },
      rounds: [{ id: `round${request.roundOffset}`, number: request.roundOffset + 1, question: request.roundOffset ? 'Second saved report' : 'First saved report', claims: [], gaps: [], nextAction: 'Review', newEvidence: 1 }] };
  } };
  await f.mount(api);
  assert.equal(f.state.listLoaded, true);
  assert.equal(f.state.listError, '');
  assert.equal(f.state.available, false);
  assert.equal(f.state.scope, null);
  assert.equal(f.state.capabilityError, 'execution configuration unavailable');
  await f.React.act(async () => f.state.selectProgram(saved));
  assert.equal(f.state.selected.rounds[0].question, 'First saved report');
  await f.React.act(async () => f.state.setRoundOffset(1));
  assert.equal(f.state.selected.rounds[0].question, 'Second saved report');
  assert.equal(f.state.selected.roundPage.offset, 1);
  assert.equal(f.state.run, null);
});

test('initial research load failure is distinct from successful empty data; refresh failure retains saved plans', async t => {
  const f = await fixture(t), saved = program('p1');
  const api = { get: async () => ({ items: [] }), post: async () => { throw Error('list unavailable'); } };
  await f.mount(api);
  assert.equal(f.state.listLoaded, false);
  assert.equal(f.state.listLoading, false);
  assert.equal(f.state.listError, 'list unavailable');
  api.post = async () => ({ programs: [] });
  await f.React.act(async () => f.state.reload());
  assert.equal(f.state.listLoaded, true);
  assert.equal(f.state.listError, '');
  assert.deepEqual(f.state.programs, []);
  api.post = async () => ({ programs: [saved] });
  await f.React.act(async () => f.state.reload());
  let rejectRefresh;
  api.post = () => new Promise((_, reject) => { rejectRefresh = reject; });
  let refresh;
  await f.React.act(async () => { refresh = f.state.reload(); });
  assert.equal(f.state.listRefreshing, true);
  assert.deepEqual(f.state.programs.map(item => item.id), ['p1']);
  await f.React.act(async () => { rejectRefresh(Error('refresh unavailable')); await refresh; });
  assert.equal(f.state.listLoaded, true);
  assert.equal(f.state.listLoading, false);
  assert.equal(f.state.listError, 'refresh unavailable');
  assert.deepEqual(f.state.programs.map(item => item.id), ['p1']);
});

test('retained inactive research workspace keeps its draft and adds seed context without loading hidden history', async t => {
  const f = await fixture(t);
  let reads = 0;
  const api = { get: async () => ({ items: [] }), post: async (_path, request) => { reads++; return request.operation === 'list' ? { programs: [] } : program('p1'); } };
  await f.mount(api, false);
  assert.equal(reads, 0);
  await f.mount(api, true);
  await f.React.act(async () => {
    f.state.setQuestion('Retain my scientific question');
    f.state.setResearchScope('A fixed research scope');
    f.state.setSeeds(['paper1']);
  });
  await f.React.act(async () => f.state.selectProgram(program('p1')));
  assert.equal(f.state.selected.id, 'p1');
  const loadedReads = reads;
  await f.mount(api, false, { id: 'paper2' });
  assert.equal(reads, loadedReads);
  assert.equal(f.state.question, 'Retain my scientific question');
  assert.equal(f.state.researchScope, 'A fixed research scope');
  assert.deepEqual(f.state.seeds, ['paper1', 'paper2']);
  assert.equal(f.state.selected, null, 'A paper-context action opens the retained draft instead of a former saved plan');
  await f.mount(api, true, { id: 'paper2' });
  assert.equal(f.state.question, 'Retain my scientific question');
  await f.React.act(async () => f.state.newPlan());
  assert.equal(f.state.selected, null);
  assert.equal(f.state.question, 'Retain my scientific question');
  assert.deepEqual(f.state.seeds, ['paper1', 'paper2']);
});

test('changing selected research discards a late former-page response', async t => {
  const f = await fixture(t), first = program('p1'), second = program('p2');
  let releaseFirst;
  const api = { get: async () => ({ items: [] }), post: async (_path, request) => request.operation === 'list' ? { programs: [first, second] }
    : request.programId === first.id ? new Promise(resolve => { releaseFirst = resolve; }) : second };
  await f.mount(api);
  let firstSelection;
  await f.React.act(async () => { firstSelection = f.state.selectProgram(first); });
  await f.React.act(async () => f.state.selectProgram(second));
  assert.equal(f.state.selected.id, second.id);
  await f.React.act(async () => { releaseFirst(first); await firstSelection; });
  assert.equal(f.state.selected.id, second.id);
});

test('an unresolved or failed Host lookup preserves the saved runtime and cannot authorize a fresh start', async t => {
  let rejectLookup, mode = 'pending', launches = 0;
  const current = { id: 'run1', sessionId: 'session1', scope: { workspaceId: 'w1' }, status: 'running', attempt: 1, requestId: 'p1', updatedAt: '2026-11-11' };
  const f = await fixture(t, async (_capability, operation) => {
    if (operation === 'lookup') return mode === 'pending' ? new Promise((_, reject) => { rejectLookup = reject; }) : { run: mode === 'found' ? current : null };
    if (operation === 'status') return current;
    assert.fail(`Unexpected execution: ${operation}`);
  });
  const saved = { ...program('p1'), runtime: { status: 'running', modelRequestsUsed: 3, appCallsUsed: 4 } };
  const api = { get: async path => ({ items: path === '/api/workspaces' ? [{ workspaceId: 'w1' }] : [{ id: 'pero', available: true }] }),
    post: async (_path, request) => { if (request.operation === 'launch') launches++; return request.operation === 'list' ? { programs: [saved] } : saved; } };
  await f.mount(api);
  await f.React.act(async () => f.state.perform(() => f.state.selectProgram(saved)));
  assert.equal(f.state.runLookupReady, false);
  assert.equal(f.state.run, null);
  assert.equal(f.state.selected.runtime.status, 'running');
  await f.React.act(async () => f.state.start());
  assert.equal(launches, 0);
  await f.React.act(async () => rejectLookup(Error('Host lookup unavailable')));
  assert.equal(f.state.runLookupReady, false);
  assert.equal(f.state.capabilityError, 'Host lookup unavailable');
  assert.equal(f.state.selected.runtime.modelRequestsUsed, 3);
  mode = 'unresolved';
  await f.React.act(async () => f.state.reload());
  assert.equal(f.state.runLookupReady, false, 'A null Host lookup cannot replace an existing saved execution with not-started');
  mode = 'found';
  await f.React.act(async () => f.state.reload());
  assert.equal(f.state.runLookupReady, true);
  assert.equal(f.state.run.id, 'run1');
  assert.equal(f.state.selected.runtime.appCallsUsed, 4);
});

test('a failed research selection survives background refresh and retries the failed target', async t => {
  const f = await fixture(t), first = program('one'), second = program('two');
  let failSecond = true;
  const api = { get: async () => ({ items: [] }), post: async (_path, request) => {
    if (request.operation === 'list') return { programs: [first, second] };
    if (request.programId === second.id && failSecond) throw Error('Cannot read the second plan');
    return request.programId === first.id ? first : second;
  } };
  await f.mount(api);
  await f.React.act(async () => f.state.perform(() => f.state.selectProgram(first)));
  await f.React.act(async () => f.state.perform(() => f.state.selectProgram(second)));
  assert.equal(f.state.selected.id, first.id);
  assert.equal(f.state.failedSelection.id, second.id);
  await f.React.act(async () => f.state.setRoundOffset(1));
  assert.equal(f.state.error, 'Cannot read the second plan');
  assert.equal(f.state.failedSelection.id, second.id);
  failSecond = false;
  await f.React.act(async () => f.state.perform(f.state.retryRead));
  assert.equal(f.state.selected.id, second.id);
  assert.equal(f.state.failedSelection, null);
  assert.equal(f.state.error, '');
});

for (const action of ['retry', 'cancel']) test(`a pending earlier status response cannot overwrite ${action}`, async t => {
  const initial = { id: 'run1', sessionId: 'session1', scope: { workspaceId: 'w1' }, status: action === 'retry' ? 'failed' : 'running', attempt: 1, requestId: 'p1', updatedAt: '2026-11-11' };
  let current = initial, statusReads = 0, releaseEarlier;
  const f = await fixture(t, async (_capability, operation) => {
    if (operation === 'lookup') return { run: current };
    if (operation === 'status') return ++statusReads === 2 ? new Promise(resolve => { releaseEarlier = () => resolve(initial); }) : current;
    assert.equal(operation, action);
    current = { ...current, status: action === 'retry' ? 'running' : 'cancelled', attempt: action === 'retry' ? 2 : 1 };
    return current;
  });
  const saved = program('p1');
  const api = { get: async path => ({ items: path === '/api/workspaces' ? [{ workspaceId: 'w1' }] : [{ id: 'pero', available: true }] }),
    post: async (_path, request) => request.operation === 'list' ? { programs: [saved] } : saved };
  await f.mount(api);
  await f.React.act(async () => f.state.perform(() => f.state.selectProgram(saved)));
  if (!releaseEarlier) await f.React.act(async () => f.state.reload());
  assert.equal(typeof releaseEarlier, 'function');
  assert.equal(f.state.runLookupReady, false);
  await f.React.act(async () => f.state.perform(() => f.state.control(action)));
  assert.equal(f.state.run.status, action === 'retry' ? 'running' : 'cancelled');
  await f.React.act(async () => releaseEarlier());
  assert.equal(f.state.run.status, action === 'retry' ? 'running' : 'cancelled');
  assert.equal(f.state.run.attempt, action === 'retry' ? 2 : 1);
});

test('the research form saves without starting and uses a new creation identity when returning to the retained draft', async t => {
  const f = await fixture(t), created = [], requests = [];
  const api = { get: async () => ({ items: [] }), post: async (_path, request) => {
    requests.push(request);
    if (request.operation === 'list') return { programs: created };
    if (request.operation === 'read') return created.find(item => item.id === request.programId);
    assert.equal(request.operation, 'create', 'Editing and saving must not launch an Agent');
    const saved = { ...program(`p${created.length + 1}`), protocol: { ...program('template').protocol, question: request.question, scope: request.scope, inclusion: request.inclusion, exclusion: request.exclusion, seedPaperIds: request.seedPaperIds } };
    created.push(saved); return saved;
  } };
  const papers = [{ id: 'paper1', title: 'Saved source' }];
  await f.render(f.React.createElement(f.ui.AppApiProvider, { appName: 'paper-agent', locale: 'en', allowedApiPaths: ['/api'], surface: f.ui.appSurface,
    allowedEvents: [], subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {},
  }, f.React.createElement(f.ui.ResearchPrograms, { api, papers, seed: null })));
  for (const label of ['Research question', 'Scope', 'Include', 'Exclude']) {
    const field = [...document.querySelectorAll('textarea')].find(node => [...node.labels].some(node => node.textContent === label));
    assert.ok(field, `Missing labelled field: ${label}`);
    await f.React.act(async () => {
      Object.getOwnPropertyDescriptor(f.dom.window.HTMLTextAreaElement.prototype, 'value').set.call(field, `${label} retained draft`);
      field.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
    });
  }
  await f.click(document.querySelector('.pa-program-seed [role=checkbox]'));
  const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
  await f.click(button('Save and review plan'));
  assert.equal(created.length, 1);
  assert.match(document.querySelector('.pa-program-detail h1').textContent, /Research question retained draft/);
  assert.equal(document.querySelector('.pa-program-plan'), null, 'Saving opens the immutable plan for review');
  assert.ok(button('Start research').disabled, 'Saved plans remain readable without execution prerequisites');
  await f.click(button('New plan'));
  assert.equal(document.querySelector('.pa-program-plan textarea').value, 'Research question retained draft');
  await f.click(button('Save and review plan'));
  assert.equal(created.length, 2);
  const creations = requests.filter(request => request.operation === 'create');
  assert.notEqual(creations[0].requestId, creations[1].requestId);
});

test('the report interface pages saved rounds while execution is unavailable', async t => {
  const f = await fixture(t), saved = program('p1');
  const { id, checkpoint, protocol, usage, stopReason } = saved;
  const api = { get: async () => ({ items: [] }), post: async (_path, request) => request.operation === 'list'
    ? { programs: [{ id, checkpoint, protocol, usage, stopReason }] }
    : { ...saved, roundPage: { offset: request.roundOffset ?? 0, total: 2, nextOffset: request.roundOffset ? null : 1 },
      rounds: [{ id: `r${request.roundOffset ?? 0}`, number: (request.roundOffset ?? 0) + 1, question: request.roundOffset ? 'Second saved report' : 'First saved report', claims: [], gaps: [], nextAction: 'Review', newEvidence: 1 }] } };
  await f.render(f.React.createElement(f.ui.AppApiProvider, { appName: 'paper-agent', locale: 'en', allowedApiPaths: ['/api'], surface: f.ui.appSurface,
    allowedEvents: [], subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {},
  }, f.React.createElement(f.ui.ResearchPrograms, { api, papers: [], seed: null })));
  await f.click(document.querySelector('.pa-program-list .pero-list-open'));
  const reports = document.querySelector('[role=tab][data-state=active]');
  assert.equal(reports.textContent, 'Reports');
  const next = [...document.querySelectorAll('.pa-program-pagination button')].find(node => node.textContent === 'Next');
  assert.ok(next && !next.disabled);
  await f.click(next);
  assert.match(document.querySelector('.pa-program-report').textContent, /Second saved report/);
  assert.match(document.querySelector('.pa-program-pagination').textContent, /2 \/ 2/);
});
