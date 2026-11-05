import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const annotation = { id: 'figure-one', paperId: 'paper-one', documentId: 'pdf-one', page: 3,
  kind: 'figure', rects: [{ x: 12, y: 22, width: 140, height: 90 }], quote: '', note: 'Selected response curve', createdAt: '2026-11-04' };
const emptyHistory = () => ({ extractions: [], assessments: [], references: [], layouts: [] });
const candidate = () => ({ id: 'evidence-one', identity: { metric: 'Force', condition: '300 K', series: 'Sample A', statistic: 'mean', unit: 'N' },
  value: 12, rawText: '12', sourceKind: 'caption', method: 'native_text', role: 'paper_reported', engine: 'pdfium', engineVersion: 'test',
  recognitionScore: null, semanticConfirmed: false, unitConfirmed: false, transcriptionConfirmed: false, seriesReliable: false, directionReliable: false });
const assessed = (item = candidate(), id = 'assessment-one') => ({ id, extractionId: 'extraction-one', evidence: [item],
  assessment: { status: 'needs_review', issues: ['semantic_identity_unconfirmed', 'unit_unconfirmed', 'transcription_unconfirmed'], supersededIds: [], crossCheck: { status: 'not_checked' } } });

async function fixture(t, initial = emptyHistory()) {
  const env = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `export { NumericValues } from './numeric-values'; export { AppApiProvider, appSurface } from '@pero/app-sdk';` });
  const { React, ui, dom, render } = env;
  if (!dom.window.HTMLElement.prototype.scrollIntoView) dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 10, y: 10, width: 240, height: 32, top: 10, left: 10, right: 250, bottom: 42, toJSON() { return this; } });
  let history = initial;
  const writes = [], reads = [], chats = [];
  const api = { get: async path => { reads.push(path); return history; }, post: async (path, body) => { writes.push({ path, body }); return assessed(body.evidence?.[0]); } };
  t.mock.method(window, 'postMessage', message => {
    if (message.type !== 'pero:app:chat') return;
    chats.push(message.options);
    queueMicrotask(() => window.dispatchEvent(new dom.window.MessageEvent('message', { source: window, data: { type: 'pero:app:chat-result', id: message.id, ok: true, value: {} } })));
  });
  const mount = (selected = annotation, selectedApi = api) => render(React.createElement(ui.AppApiProvider, {
    appName: 'paper-agent', locale: 'en', allowedApiPaths: ['/api'], surface: ui.appSurface,
    allowedEvents: [], subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {},
  }, React.createElement(ui.NumericValues, { key: selected.id, api: selectedApi, annotation: selected, onSource() {} })));
  await mount();
  const button = label => {
    const result = [...document.querySelectorAll('button')].find(node => node.textContent === label);
    assert.ok(result, `Missing button: ${label}`); return result;
  };
  const details = label => [...document.querySelectorAll('details')].find(node => node.querySelector(':scope > summary')?.textContent === label);
  const refresh = async next => { history = next; await React.act(async () => window.dispatchEvent(new dom.window.Event('pero:app:data-changed'))); };
  return { ...env, api, mount, button, details, refresh, writes, reads, chats };
}

test('candidate preparation keeps manual fields collapsed and only prepares an exact-source Host draft', async t => {
  const history = { ...emptyHistory(), extractions: [{ id: 'extraction-one', result: { status: 'needs-review', classification: 'native', nativeRegionText: 'Force is 12 N.', anchor: { documentId: 'pdf-one', page: 3, fileDigest: 'saved-pdf-digest', rects: annotation.rects } } }] };
  const f = await fixture(t, history);
  assert.equal(f.details('Enter or correct manually').open, false);
  assert.equal(f.details('Axis calibration (pixel reading)').open, false);
  assert.equal(f.details('Inspect extraction').open, false);
  await f.click(f.button('Prepare candidates with Agent'));
  assert.equal(f.chats.length, 1);
  const attachment = f.chats[0].attachments[0];
  assert.equal(attachment.objectId, 'numeric-region-figure-one');
  assert.equal(attachment.selection.annotationId, annotation.id);
  assert.equal(attachment.selection.paperId, annotation.paperId);
  assert.equal(attachment.selection.extractionId, 'extraction-one');
  const state = f.ui.appSurface.observe(attachment.objectId).objects[0].state;
  assert.deepEqual(state.annotation, annotation);
  assert.deepEqual(state.source, history.extractions[0].result.anchor);
  assert.match(f.chats[0].message, /numeric-propose/);
  assert.match(f.chats[0].message, /Do not review or freeze/);
  assert.match(f.chats[0].message, /missing or still needs review, say there is insufficient evidence to determine the result yet/);
  assert.match(f.chats[0].message, /Do not evaluate the tolerance or give a pass or fail, even provisionally/);
  assert.deepEqual(f.writes, []);
  assert.match(document.body.textContent, /Send it to start extraction/);
});

test('persisted Agent candidates refresh into results without automatically confirming or freezing', async t => {
  const f = await fixture(t);
  await f.refresh({ ...emptyHistory(), assessments: [assessed()] });
  assert.match(document.querySelector('.pa-numeric-result').textContent, /Force: 12 N/);
  assert.match(document.querySelector('.pa-numeric-result').textContent, /300 K/);
  assert.equal(f.button('Freeze reference').disabled, true);
  assert.equal(f.button('Confirm review as new revision').disabled, true);
  assert.deepEqual(f.writes, []);
  const missing = candidate(); missing.identity.unit = ''; missing.identity.condition = ''; missing.value = null;
  const assessment = assessed(missing); assessment.assessment.status = 'blocked'; assessment.assessment.issues = ['unit_missing', 'numeric_value_missing'];
  await f.refresh({ ...emptyHistory(), assessments: [assessment] });
  assert.match(document.querySelector('.pa-numeric-result').textContent, /Unknown/);
  assert.match(document.body.textContent, /Unit is missing/);
  assert.equal(f.button('Freeze reference').disabled, true);
});

test('manual correction opens saved values and preserves their provenance until explicit save', async t => {
  const f = await fixture(t, { ...emptyHistory(), assessments: [assessed()] });
  await f.click(f.button('Enter or correct manually'));
  assert.equal(f.details('Enter or correct manually').open, true);
  const form = f.details('Enter or correct manually').querySelector('form');
  assert.equal(form.querySelector('input[type="number"]').value, '12');
  assert.equal(form.querySelector('textarea').value, '12');
  assert.equal(form.querySelector('[aria-label="Source kind"]').textContent, 'Caption');
  assert.equal(form.querySelector('[aria-label="Acquisition method"]').textContent, 'Native text');
  assert.deepEqual(f.writes, []);
});

test('switching selected annotations ignores an earlier history response', async t => {
  const f = await fixture(t);
  let resolveOld;
  const oldApi = { ...f.api, get: () => new Promise(resolve => { resolveOld = resolve; }) };
  await f.mount(annotation, oldApi);
  const second = { ...annotation, id: 'figure-two', page: 8 };
  const next = candidate(); next.identity.metric = 'Second figure';
  await f.mount(second, { ...f.api, get: async () => ({ ...emptyHistory(), assessments: [assessed(next, 'assessment-two')] }) });
  await f.React.act(async () => resolveOld({ ...emptyHistory(), assessments: [assessed()] }));
  assert.match(document.querySelector('.pa-numeric-result').textContent, /Second figure/);
  assert.doesNotMatch(document.querySelector('.pa-numeric-result').textContent, /Force/);
});

test('new Agent results revoke a checked review rather than inheriting approval', async t => {
  const f = await fixture(t, { ...emptyHistory(), assessments: [assessed()] });
  const review = () => [...document.querySelectorAll('label')].find(node => node.textContent === 'I checked these details against the source').querySelector('input');
  await f.click(review());
  assert.equal(review().checked, true);
  assert.equal(f.button('Confirm review as new revision').disabled, false);
  const next = candidate(); next.value = 13; next.rawText = '13';
  await f.refresh({ ...emptyHistory(), assessments: [assessed(), assessed(next, 'assessment-two')] });
  assert.match(document.querySelector('.pa-numeric-result').textContent, /Force: 13 N/);
  assert.equal(review().checked, false);
  assert.equal(f.button('Confirm review as new revision').disabled, true);
  assert.deepEqual(f.writes, []);
});


test('unavailable Host leaves an honest error and the manual fallback usable', async t => {
  const f = await fixture(t);
  t.mock.method(window, 'postMessage', message => {
    if (message.type !== 'pero:app:chat') return;
    queueMicrotask(() => window.dispatchEvent(new f.dom.window.MessageEvent('message', { source: window,
      data: { type: 'pero:app:chat-result', id: message.id, ok: false, error: 'No Agent is available' } })));
  });
  await f.click(f.button('Prepare candidates with Agent'));
  assert.match(document.body.textContent, /No Agent is available/);
  assert.doesNotMatch(document.body.textContent, /Request prepared in chat/);
  assert.equal(f.button('Prepare candidates with Agent').disabled, false);
  await f.React.act(async () => { const manual = f.details('Enter or correct manually'); manual.open = true; manual.dispatchEvent(new f.dom.window.Event('toggle')); });
  assert.equal(f.button('Save and assess candidate').disabled, false);
  assert.deepEqual(f.writes, []);
});

test('editing older evidence keeps its extraction, while independent candidates use the selected extraction', async t => {
  const old = { ...candidate(), extractionId: 'extraction-one' };
  const history = { ...emptyHistory(), assessments: [assessed(old)], extractions: [
    { id: 'extraction-one', result: { status: 'needs-review', classification: 'native', nativeRegionText: 'Force 12 N' } },
    { id: 'extraction-two', result: { status: 'needs-review', classification: 'native', nativeRegionText: 'Force 15 N' } },
  ] };
  const f = await fixture(t, history);
  const manualForm = () => f.details('Enter or correct manually').querySelector('form');
  const control = label => [...manualForm().querySelectorAll('label')].find(node => node.firstChild?.textContent === label)?.querySelector('input,textarea,button[aria-haspopup="listbox"]');
  const change = async (label, value) => {
    const node = control(label); assert.ok(node, `Missing input: ${label}`);
    if (node.getAttribute('aria-haspopup') === 'listbox') {
      await f.click(node);
      const optionLabel = { caption: 'Caption', native_text: 'Native text' }[value];
      const option = [...document.querySelectorAll('[role=option]')].find(item => item.textContent === optionLabel);
      assert.ok(option, `Missing option: ${optionLabel}`);
      await f.click(option);
    } else await f.React.act(async () => {
      const prototype = node instanceof f.dom.window.HTMLTextAreaElement ? f.dom.window.HTMLTextAreaElement.prototype : f.dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
      node.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
    });
  };
  await f.click(f.button('Enter or correct manually'));
  await change('Reviewer', 'Local reviewer');
  await change('Review reason', 'Checked the original retained extraction.');
  assert.equal(manualForm().checkValidity(), true);
  await f.click(f.button('Save and assess candidate'));
  assert.equal(f.writes.length, 1);
  const correction = f.writes[0];
  assert.equal(correction.path, '/api/numeric/assess');
  assert.equal(correction.body.extractionId, 'extraction-one');
  assert.equal(correction.body.evidence[0].extractionId, 'extraction-one');
  assert.equal(correction.body.evidence[0].previousId, old.id);
  assert.equal(correction.body.evidence[0].rawText, '12');
  assert.equal(correction.body.evidence[0].reviewer, 'Local reviewer');

  await f.click(f.button('New independent candidate'));
  for (const [label, value] of Object.entries({ Metric: 'Force', Condition: '300 K', Series: 'Sample B', Statistic: 'mean', 'Unit (use 1 for dimensionless)': 'N', 'Raw text': '15', Value: '15', 'Source kind': 'caption', 'Acquisition method': 'native_text' })) await change(label, value);
  await f.click(f.button('Save and assess candidate'));
  assert.equal(f.writes.length, 2);
  const independent = f.writes[1].body;
  assert.equal(independent.extractionId, 'extraction-two');
  assert.equal(independent.evidence[0].extractionId, 'extraction-two');
  assert.equal(independent.evidence[0].previousId, undefined);
  assert.equal(independent.previousAssessmentId, undefined);
  assert.equal(independent.evidence[0].rawText, '15');
});

test('saved candidate navigation exposes different quantities and keeps only their latest revision', async t => {
  const first = candidate();
  const second = candidate(); second.id = 'evidence-two'; second.identity.series = 'Sample B'; second.value = 15; second.rawText = '15';
  const firstAssessment = assessed(first, 'first-assessment');
  const secondAssessment = assessed(second, 'second-assessment');
  const f = await fixture(t, { ...emptyHistory(), assessments: [firstAssessment, secondAssessment] });
  const nav = () => document.querySelector('nav[aria-label="Saved candidates"]');
  assert.equal(nav().querySelectorAll('button').length, 2);
  assert.match(nav().textContent, /Sample A/);
  assert.match(nav().textContent, /Sample B/);
  assert.match(document.querySelector('.pa-numeric-result').textContent, /Sample B/);
  await f.click([...nav().querySelectorAll('button')].find(node => node.textContent.includes('Sample A')));
  assert.match(document.querySelector('.pa-numeric-result').textContent, /Sample A/);
  assert.match(document.querySelector('.pa-numeric-result').textContent, /Force: 12 N/);

  const revised = { ...first, id: 'reviewed-evidence', previousId: first.id, semanticConfirmed: true, unitConfirmed: true, transcriptionConfirmed: true };
  const reviewed = assessed(revised, 'reviewed-assessment'); reviewed.assessment.status = 'numeric_ready'; reviewed.assessment.issues = [];
  await f.refresh({ ...emptyHistory(), assessments: [firstAssessment, secondAssessment, reviewed] });
  assert.equal(nav().querySelectorAll('button').length, 2);
  const firstButton = [...nav().querySelectorAll('button')].find(node => node.textContent.includes('Sample A'));
  assert.match(firstButton.textContent, /Ready to freeze/);
  await f.click(firstButton);
  assert.equal(f.button('Freeze reference').disabled, false);
  const history = f.details('Assessment history').querySelector('[aria-label="Assessment history"]');
  await f.click(history);
  assert.equal(document.querySelectorAll('[role=option]').length, 3, 'Earlier unreviewed evidence remains in the history');
  assert.equal(document.querySelector('[role=option][aria-selected=true]').textContent, '3: Ready to freeze');
  assert.deepEqual(f.writes, []);
});
