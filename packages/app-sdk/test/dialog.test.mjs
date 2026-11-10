import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from './ui-test-runtime.mjs';

function installDialogElements(window) {
  const proto = window.HTMLDialogElement?.prototype;
  if (!proto) return;
  proto.showModal = function showModal() {
    this.setAttribute('open', '');
    this.open = true;
    this.__previousFocus = this.ownerDocument.activeElement;
    this.querySelector('button,input,textarea,select,a[href]')?.focus();
  };
  proto.close = function close() {
    if (!this.open) return;
    this.open = false;
    this.removeAttribute('open');
    const previous = this.__previousFocus;
    this.__previousFocus = null;
    if (previous?.isConnected) window.HTMLElement.prototype.focus.call(previous);
    this.dispatchEvent(new window.Event('close'));
  };
}

test('dialog is a native modal with refusal, escape, form, focus and backdrop bounds', async (t) => {
  const runtime = await createUiRuntime(t, {
    contents: "export { Dialog } from './components/dialog'; export { resolvePopupContainer } from './components/popup-container';",
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
  });
  if (!runtime) return;
  const { React, ui, render, click } = runtime;
  const { Dialog, resolvePopupContainer } = ui;
  const { createElement: h, createRef, useState } = React;
  installDialogElements(window);

  const opened = [];
  const dialogRef = createRef();
  const fieldRef = createRef();
  const opener = document.createElement('button');
  opener.textContent = 'open';
  document.body.append(opener);
  opener.focus();
  let connectedAtClose = null;
  const nativeClose = window.HTMLDialogElement.prototype.close;
  window.HTMLDialogElement.prototype.close = function close() {
    connectedAtClose = this.isConnected;
    return nativeClose.call(this);
  };
  const ownedWindow = runtime.dom.window;
  t.after(() => { ownedWindow.HTMLDialogElement.prototype.close = nativeClose; opener.remove(); });

  await render(h(Dialog, {
    ref: dialogRef,
    id: 'notes',
    title: 'Edit note',
    closeLabel: 'Close',
    size: 'lg',
    className: 'extra',
    frameClassName: 'frame-extra',
    headerClassName: 'head-extra',
    bodyClassName: 'body-extra',
    footerClassName: 'foot-extra',
    closeButtonClassName: 'close-extra',
    'data-kind': 'meta',
    initialFocus: '#note-name',
    footerStart: h('span', { id: 'alt' }, 'alt'),
    footer: h('button', { type: 'button', id: 'stay' }, 'Stay'),
    onClose: () => { opened.push('close'); },
  }, h('input', { id: 'note-name', ref: fieldRef, defaultValue: 'kept' })));

  const dialog = dialogRef.current;
  assert.equal(dialog, document.getElementById('notes'));
  assert.equal(dialog.tagName, 'DIALOG');
  assert.equal(dialog.open, true);
  assert.equal(connectedAtClose, null);
  assert.equal(dialog.getAttribute('data-size'), 'lg');
  assert.equal(dialog.getAttribute('data-kind'), 'meta');
  assert.equal(dialog.hasAttribute('data-unstyled'), false);
  assert.ok(dialog.classList.contains('pero-ui-dialog'));
  assert.ok(dialog.classList.contains('extra'));
  assert.equal(document.getElementById('pero-app-ui-styles')?.isConnected, true);
  const title = dialog.querySelector('h2');
  assert.equal(title.textContent, 'Edit note');
  assert.equal(dialog.getAttribute('aria-labelledby'), title.id);
  assert.ok(title.id.length > 0);
  const frame = dialog.querySelector('.pero-ui-dialog-frame');
  assert.equal(frame.tagName, 'DIV');
  assert.ok(frame.classList.contains('frame-extra'));
  assert.ok(dialog.querySelector('.pero-ui-dialog-head').classList.contains('head-extra'));
  assert.ok(dialog.querySelector('.pero-ui-dialog-body').classList.contains('body-extra'));
  assert.ok(dialog.querySelector('.pero-ui-dialog-foot').classList.contains('foot-extra'));
  assert.equal(document.getElementById('alt').parentElement.className, 'pero-ui-dialog-foot-start');
  const closeButton = dialog.querySelector('.pero-ui-dialog-close');
  assert.equal(closeButton.tagName, 'BUTTON');
  assert.equal(closeButton.getAttribute('aria-label'), 'Close');
  assert.equal(closeButton.getAttribute('type'), 'button');
  assert.ok(closeButton.classList.contains('close-extra'));
  assert.equal(closeButton.querySelector('svg')?.isConnected, true);
  assert.equal(document.activeElement, fieldRef.current);
  assert.equal(resolvePopupContainer(fieldRef.current), dialog);

  await click(closeButton);
  assert.deepEqual(opened, ['close']);
  assert.equal(dialog.open, true, 'the owner refuses by staying mounted');
  assert.equal(dialog.isConnected, true);

  const key = async (node, value, shiftKey = false) => React.act(async () => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })));
  const last = document.getElementById('stay');
  last.focus(); await key(last, 'Tab'); assert.equal(document.activeElement, closeButton);
  await key(closeButton, 'Tab', true); assert.equal(document.activeElement, last);

  const parentHits = [];
  function Layered() {
    return h('div', { id: 'shell', onKeyDown: () => { parentHits.push('parent'); } },
      h(Dialog, {
        id: 'outer', title: 'Outer', closeLabel: 'Close outer', onClose: () => { parentHits.push('outer'); },
      }, h(Dialog, {
        id: 'inner', title: 'Inner', closeLabel: 'Close inner', onClose: () => { parentHits.push('inner'); },
      }, h('button', {
        type: 'button', id: 'popup',
        onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); parentHits.push('popup'); } },
      }, 'popup'))));
  }
  await render(h(Layered));
  await React.act(async () => {
    document.getElementById('popup').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  assert.deepEqual(parentHits, ['popup']);
  assert.equal(document.getElementById('inner').open, true);

  await React.act(async () => {
    const inner = document.getElementById('inner');
    inner.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    inner.dispatchEvent(new window.Event('cancel', { bubbles: true, cancelable: true }));
  });
  assert.deepEqual(parentHits, ['popup', 'inner']);
  assert.equal(document.getElementById('outer').open, true);
  assert.equal(document.getElementById('shell').isConnected, true);

  let consumerSaw = 0;
  await render(h('div', { id: 'shell', onKeyDown: () => { parentHits.push('parent'); }, onCancel: () => { parentHits.push('parent'); } },
    h(Dialog, {
      id: 'chain', title: 'Chain', closeLabel: 'Close',
      onKeyDown: event => { consumerSaw += 1; if (event.key === 'Escape') event.preventDefault(); },
      onCancel: event => { consumerSaw += 1; event.preventDefault(); },
      onClose: () => { parentHits.push('chain'); },
    }, 'body')));
  await React.act(async () => {
    const chain = document.getElementById('chain');
    chain.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const cancel = new window.Event('cancel', { bubbles: true, cancelable: true });
    chain.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
  });
  assert.equal(consumerSaw, 2);
  assert.equal(parentHits.includes('chain'), false);
  assert.equal(parentHits.includes('parent'), false);

  const submitted = [];
  function NoteForm() {
    return h(Dialog, {
      id: 'form', title: 'Save', closeLabel: 'Close',
      onClose: () => {},
      onSubmit: event => {
        event.preventDefault();
        submitted.push(new window.FormData(event.currentTarget).get('name'));
      },
      footer: h('button', { type: 'submit', id: 'save' }, 'Save'),
    }, h('input', { name: 'name', defaultValue: 'Ada', required: true }));
  }
  await render(h(NoteForm));
  const form = document.querySelector('#form form');
  assert.equal(form.classList.contains('pero-ui-dialog-frame'), true);
  await React.act(async () => { form.requestSubmit(); });
  assert.deepEqual(submitted, ['Ada']);
  const required = form.querySelector('input');
  await React.act(async () => {
    required.value = '';
    form.requestSubmit();
  });
  assert.deepEqual(submitted, ['Ada']);
  assert.equal(required.validity.valueMissing, true);

  await render(null);
  const editor = document.createElement('div');
  editor.tabIndex = 0;
  editor.textContent = 'paragraph';
  const focusCalls = [];
  editor.focus = () => { focusCalls.push('editor'); HTMLElement.prototype.focus.call(editor); };
  document.body.append(editor);
  editor.focus();
  focusCalls.length = 0;
  await render(h(Dialog, { id: 'editor-dialog', title: 'Insert', closeLabel: 'Close', restoreFocus: false, onClose: () => {} }, 'body'));
  assert.equal(document.getElementById('editor-dialog').open, true);
  await render(null);
  assert.equal(connectedAtClose, true);
  assert.deepEqual(focusCalls, []);
  editor.remove();

  const returned = document.createElement('button');
  returned.id = 'returned';
  document.body.append(returned);
  returned.focus();
  function Restore() {
    const [alive, setAlive] = useState(true);
    return h(React.Fragment, null,
      h('button', { type: 'button', id: 'drop', onClick: () => setAlive(false) }, 'drop'),
      alive && h(Dialog, { id: 'restore', title: 'Restore', closeLabel: 'Close', onClose: () => setAlive(false) }, h('input', { 'aria-label': 'field' })));
  }
  await render(h(Restore));
  assert.equal(document.getElementById('restore').open, true);
  await click(document.getElementById('drop'));
  assert.equal(document.getElementById('restore'), null);
  assert.equal(document.activeElement, returned);

  const kept = document.createElement('button');
  kept.id = 'kept-focus';
  document.body.append(kept);
  function NestedFocus() {
    const [first, setFirst] = useState(true);
    return h(React.Fragment, null,
      h('button', { type: 'button', id: 'drop-first', onClick: () => setFirst(false) }, 'drop first'),
      first && h(Dialog, { id: 'first-modal', title: 'First', closeLabel: 'Close', onClose: () => {} }, 'first'),
      h(Dialog, { id: 'second-modal', title: 'Second', closeLabel: 'Close', initialFocus: '#second-field', onClose: () => {} }, h('input', { id: 'second-field' })));
  }
  kept.focus();
  await render(h(NestedFocus));
  assert.equal(document.activeElement, document.getElementById('second-field'));
  await click(document.getElementById('drop-first'));
  assert.equal(document.getElementById('first-modal'), null);
  assert.equal(document.getElementById('second-modal').open, true);
  assert.equal(document.activeElement, document.getElementById('second-field'));
  returned.remove();
  kept.remove();

  const bounds = { left: 10, top: 20, right: 110, bottom: 80 };
  function Backdrop({ dismiss }) {
    return h(Dialog, {
      id: 'backdrop', title: 'Bounds', closeLabel: 'Close', dismissOnBackdrop: dismiss, onClose: () => { opened.push('backdrop'); },
    }, h('button', { type: 'button', id: 'inside' }, 'inside'));
  }
  await render(h(Backdrop, { dismiss: false }));
  const backdrop = document.getElementById('backdrop');
  backdrop.getBoundingClientRect = () => bounds;
  await React.act(async () => {
    backdrop.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
  });
  assert.equal(opened.includes('backdrop'), false);
  opened.length = 0;
  await render(h(Backdrop, { dismiss: true }));
  const dismissing = document.getElementById('backdrop');
  dismissing.getBoundingClientRect = () => bounds;
  await React.act(async () => {
    dismissing.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 40, clientY: 40 }));
    document.getElementById('inside').dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
  });
  assert.deepEqual(opened, []);
  await React.act(async () => {
    dismissing.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
  });
  assert.deepEqual(opened, ['backdrop']);

  await render(h(Dialog, {
    id: 'plain', title: 'Plain', closeLabel: 'Close', onClose: () => {},
    footerStart: h('span', null, 'Saved locally.'),
    footer: h('button', { type: 'button', id: 'plain-ok' }, 'OK'),
  }, 'No fields here.'));
  assert.equal(document.activeElement, document.getElementById('plain'));
  assert.notEqual(document.activeElement, document.querySelector('#plain .pero-ui-dialog-close'));
  assert.equal(document.getElementById('plain-ok').parentElement.className, 'pero-ui-dialog-foot-actions');

  await render(h(Dialog, { id: 'quiet', title: 'Quiet', closeButton: false, open: false, onClose: () => {} }, 'hidden'));
  assert.equal(Boolean(document.getElementById('quiet').open), false);
  assert.equal(document.querySelector('#quiet .pero-ui-dialog-close'), null);
  assert.equal(document.querySelector('#quiet .pero-ui-dialog-foot'), null);
});
