import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('actual parameter editor binds typed fields and cross-step formulas, previews/rebinds changed pins, cancels and respects read-only', async t => {
  const { React, ui, dom, render, click } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export { ProcedureParameters } from './procedure-parameters'; export { NotebookContextProvider } from './notebook-context'; export { changeProcedures } from '@pero/notebook/workspace'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { left: 20, right: 320, top: 20, bottom: 50, width: 300, height: 30, x: 20, y: 20, toJSON() {} }; };
  const step = (id: string) => ({ id, text: id, level: 'step', critical: false, pause: false, minutes: null, completed: false });
  let value: any = { schemaVersion: 1, title: 'Method', content: { type: 'doc', content: [{ type: 'inputTable', attrs: { blockId: 'block', receipts: [], table: { id: 'table', name: 'Amounts', schema: { id: 'schema', revision: 1, columns: [{ id: 'amount', name: 'Amount', type: 'decimal', required: true, options: [], units: [] }] }, rows: [{ id: 'sample', cells: { amount: '3' } }] } } }] }, procedures: [{ id: 'method', title: 'Dilution', description: '', materials: [], steps: [step('prepare'), step('dilute')], parameters: [] }] };
  let setDocument: (document: any) => void = () => {}, writes = 0, readonly = false, latest: any = null;
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  function Harness() {
    const [document, setValue] = React.useState(value); value = document; setDocument = setValue;
    return React.createElement(ui.NotebookContextProvider, { value: { entryId: 'entry', revision: 4, readonly, document, getDocument: () => latest ?? value } }, React.createElement(ui.ProcedureParameters, {
      procedure: document.procedures[0], readonly, apply(change: any) { writes++; const result = ui.changeProcedures(value.procedures, change); assert.equal(result.status, 'ok'); setValue({ ...value, procedures: result.procedures }); },
    }));
  }
  const draw = () => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(Harness)));
  const button = (label: string, scope: ParentNode = document) => { const found = [...scope.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label); assert.ok(found, `Missing ${label}: ${scope.textContent}`); return found; };
  const input = async (label: string, text: string) => {
    const element = [...document.querySelectorAll('label')].find(item => item.textContent === label)!;
    assert.ok(element, label); const target = document.getElementById(element.htmlFor)!;
    await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(target, text); target.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  };
  const select = async (label: string, key: string) => {
    await click(button(label)); const option = [...document.querySelectorAll('[role="option"]')].find(item => item.getAttribute('data-value') === key); assert.ok(option, `Missing option ${key}`); await click(option);
  };
  const row = (id: string) => document.querySelector(`[data-parameter-id="${id}"]`)!;
  await draw();
  await click(button('Add parameter')); await input('Parameter name', 'Factor'); await input('Raw value', '3'); await select('Parameter scope', 'prepare');
  assert.equal(writes, 0); await click(button('Apply parameter'));
  const factor = value.procedures[0].parameters[0].id;
  assert.match(row(factor).textContent!, /Resolved: 3/); assert.equal(value.procedures[0].parameters[0].stepId, 'prepare');
  await click(button('Add parameter')); await input('Parameter name', 'Total'); await select('Parameter scope', 'dilute'); await select('Parameter source', 'formula');
  await click(button('Add reference slot')); await select('Reference for A1', `method/${factor}`);
  assert.match(document.querySelector('dialog')!.textContent!, /Preview: Resolved: 6/);
  await click(button('Apply parameter'));
  const total = value.procedures[0].parameters[1].id; assert.match(row(total).textContent!, /Resolved: 6/);
  await click(button('Edit parameter', row(factor))); await input('Raw value', '4'); await click(button('Cancel'));
  assert.equal(value.procedures[0].parameters[0].source.raw, '3'); assert.equal(writes, 2);
  await click(button('Edit parameter', row(factor))); await input('Raw value', '4'); await click(button('Apply parameter'));
  assert.equal(value.procedures[0].parameters[0].version, 2); assert.match(row(total).textContent!, /Changed since binding/);
  await click(button('Edit parameter', row(total))); await click(button('Review and repin references'));
  assert.match(document.querySelector('dialog')!.textContent!, /Preview: Resolved: 8/); await click(button('Apply parameter'));
  assert.match(row(total).textContent!, /Resolved: 8/);
  await click(button('Add parameter')); await input('Parameter name', 'Bound amount'); await select('Parameter source', 'table'); await select('Structured table field', 'block/table/sample/amount');
  assert.match(document.querySelector('dialog')!.textContent!, /Selected snapshot: 3/);
  const changed = structuredClone(value); changed.content.content[0].attrs.table.rows[0].cells.amount = '5';
  await React.act(async () => setDocument(changed));
  const beforeStale = writes; await click(button('Apply parameter'));
  assert.equal(writes, beforeStale); assert.match(document.querySelector('dialog')!.textContent!, /selected field changed/);
  await click(button('Review current field')); assert.match(document.querySelector('dialog')!.textContent!, /Selected snapshot: 5/);
  await click(button('Apply parameter'));
  const bound = value.procedures[0].parameters[2]; assert.equal(bound.source.raw, '5'); assert.equal(bound.source.observedRevision, 4);
  assert.equal(bound.source.rowId, 'sample'); assert.equal(bound.type, 'decimal');
  const withNewerField = structuredClone(value); withNewerField.content.content[0].attrs.table.rows[0].cells.amount = '6';
  await React.act(async () => setDocument(withNewerField)); assert.match(row(bound.id).textContent!, /Changed since binding/);
  await click(button('Edit parameter', row(factor))); await input('Raw value', '7');
  latest = structuredClone(value); latest.procedures[0].parameters[0].version++;
  await click(button('Apply parameter')); assert.match(document.querySelector('dialog')!.textContent!, /changed while the editor was open/);
  assert.equal(value.procedures[0].parameters[0].source.raw, '4'); latest = null; await click(button('Close'));
  const removed = ui.changeProcedures(value.procedures, { type: 'removeStep', id: 'method', stepId: 'prepare' });
  await React.act(async () => setDocument({ ...value, procedures: removed.procedures }));
  assert.match(row(factor).textContent!, /Missing step: prepare/); assert.match(row(total).textContent!, /Missing input or owner/);
  await click(button('Edit parameter', row(factor))); await select('Parameter scope', ''); await click(button('Apply parameter'));
  assert.equal(value.procedures[0].parameters[0].stepId, null); assert.match(row(factor).textContent!, /Resolved: 4/);
  await click(button('Edit parameter', row(total))); await click(button('Add reference slot')); await click(button('Remove last reference slot')); await click(button('Cancel'));
  assert.equal(value.procedures[0].parameters[1].source.bindings.length, 1);
  await click(button('Remove parameter', row(bound.id))); await click(button('Cancel')); assert.ok(row(bound.id));
  await click(button('Remove parameter', row(bound.id))); await click(button('Remove parameter', document.querySelector('dialog')!)); assert.equal(row(bound.id), null);
  await click(button('Edit parameter', row(factor))); await input('Raw value', '999');
  const savedWrites = writes; readonly = true; await draw();
  assert.equal(document.querySelector('dialog'), null); assert.equal(writes, savedWrites);
  assert.equal([...document.querySelectorAll('button')].some(item => ['Add parameter', 'Edit parameter', 'Remove parameter', 'Apply parameter'].includes(item.textContent!)), false);
  assert.equal(value.procedures[0].parameters[0].source.raw, '4');
});
