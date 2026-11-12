import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('Notebook tool popups dismiss by keyboard and retain mounted scientific tools', async t => {
  const { React, ui, dom, render, click } = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `export { NotebookEditor } from './editor'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';`,
  });
  const rect = { x: 10, y: 10, top: 10, left: 10, width: 120, height: 28, right: 130, bottom: 38, toJSON() {} };
  const nativeRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains('pero-ui-popover-trigger') ? rect : nativeRect.call(this);
  };
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const content = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'notes' }, content: [{ type: 'text', text: 'Keep this entry' }] }] };
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) },
    React.createElement(ui.NotebookEditor, {
      document: { schemaVersion: 1, title: 'Menu regression', content }, content,
      entryId: 'a'.repeat(32), revision: 1, onChange() {},
    })));
  const editor = (document.querySelector('.tiptap') as HTMLElement & { editor: { destroy(): void } }).editor;
  const trigger = (menu: string) => {
    const node = document.querySelector<HTMLButtonElement>(`[data-notebook-menu="${menu}"] .pero-ui-popover-trigger`);
    assert.ok(node, `Missing ${menu} trigger`);
    return node;
  };
  const panel = (menu: string) => document.querySelector<HTMLElement>(`.notebook-menu-${menu}-panel`)!;
  const key = (value: string) => React.act(async () => {
    document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  });
  for (const menu of ['insert', 'format', 'file']) {
    await click(trigger(menu));
    assert.equal(trigger(menu).getAttribute('aria-expanded'), 'true', menu);
    assert.equal(trigger(menu).getAttribute('aria-controls'), panel(menu).id, menu);
    assert.equal(panel(menu).hidden, false, menu);
    if (menu === 'insert') {
      await key('End');
      assert.equal(document.activeElement?.textContent, 'Finding', 'Menu keys skip the closed nested groups');
      await key('Home');
      assert.equal(document.activeElement?.textContent, 'Section');
    }
    await key('Escape');
    assert.equal(trigger(menu).getAttribute('aria-expanded'), 'false', menu);
    assert.equal(panel(menu).hidden, true, menu);
    assert.equal(document.activeElement, trigger(menu), menu);
  }
  await click(trigger('insert'));
  assert.match(panel('insert').textContent ?? '', /Structure/);
  assert.ok(panel('insert').querySelector('.notebook-menu-items > .notebook-menu-label')?.textContent === 'Structure');
  const submenu = [...panel('insert').querySelectorAll<HTMLDetailsElement>('details.notebook-submenu')]
    .find(node => node.querySelector('summary')?.textContent?.includes('More blocks'))!;
  assert.ok(submenu);
  const summary = submenu.querySelector<HTMLElement>('summary')!;
  await click(summary);
  assert.equal(submenu.open, true);
  assert.ok(submenu.querySelector(':scope > .notebook-submenu-body'), 'Nested items sit in an indented body');
  assert.match(submenu.textContent ?? '', /Lab records/);
  assert.match(submenu.textContent ?? '', /Chemistry/);
  const scientificAction = [...submenu.querySelectorAll('button')].find(node => node.textContent === 'Insert source excerpt');
  assert.ok(scientificAction, 'Scientific tool is mounted inside the retained popup');
  await click(trigger('insert'));
  assert.equal(panel('insert').hidden, true);
  assert.equal(scientificAction.isConnected, true);
  await click(trigger('insert'));
  assert.equal(submenu.open, true, 'Closing the popup does not recreate the tools');
  await click(scientificAction);
  const dialog = document.querySelector('dialog[open]');
  assert.ok(dialog, 'The retained scientific tool can still open its own dialog');
  const field = dialog.querySelector('input');
  assert.ok(field);
  await React.act(async () => field.focus());
  await key('ArrowDown');
  assert.equal(document.activeElement, field, 'Menu navigation does not steal dialog editing keys');
  await key('ArrowLeft');
  assert.equal(submenu.open, true, 'Dialog cursor movement does not close its containing group');
  await key('Escape');
  assert.equal(document.querySelector('dialog[open]'), null);
  assert.equal(trigger('insert').getAttribute('aria-expanded'), 'true', 'Dialog Escape leaves the tool popup open');
  await React.act(async () => summary.focus());
  await key('Escape');
  assert.equal(submenu.open, false, 'First Escape closes only the nested group');
  assert.equal(document.activeElement, summary);
  assert.equal(trigger('insert').getAttribute('aria-expanded'), 'true');
  await key('Escape');
  assert.equal(trigger('insert').getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger('insert'));
  await render(null);
  await React.act(async () => editor.destroy());
});
