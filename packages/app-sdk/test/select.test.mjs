import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from './ui-test-runtime.mjs';

const options = [
  { value: 'alpha', label: 'Alpha', group: 'Letters', hint: 'First' },
  { value: 'beta', label: 'Beta', group: 'Letters', disabled: true },
  { value: 'gamma', label: 'Gamma', group: 'Letters' },
  { value: 'one', label: 'One', group: 'Numbers' },
];

test('select keeps listbox semantics, controlled intent, and dialog portal', async t => {
  const env = await createUiRuntime(t, {
    contents: "export { Select } from './components/select'; export { Dialog } from './components/dialog';",
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
  }); if (!env) return;
  const { React, dom, ui, render, click } = env;
  const { Select } = ui;
  if (!dom.window.HTMLElement.prototype.scrollIntoView) dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const anchorBox = () => ({ x: 10, y: 10, width: 120, height: 30, top: 10, left: 10, right: 130, bottom: 40, toJSON() { return this; } });
  const stubAnchor = () => {
    const button = document.querySelector('.pero-select-trigger');
    if (button) button.getBoundingClientRect = anchorBox;
    return button;
  };
  const key = (target, value, shiftKey = false) => React.act(async () => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
  });
  const panel = () => document.querySelector('.pero-select-panel');
  const tree = (value, extra = {}) => React.createElement(Select, { value, options, onChange: extra.onChange ?? (() => {}), label: 'Kind', ...extra });

  await t.test('controlled value stays until the parent updates and reports one intent', async () => {
    const picks = [];
    await render(tree('alpha', { onChange: next => picks.push(next) }));
    const button = stubAnchor();
    assert.equal(button.type, 'button');
    assert.equal(button.getAttribute('data-value'), 'alpha');
    assert.equal(button.querySelector('svg').getAttribute('width'), '12');
    await click(button);
    assert.equal(document.querySelector('[data-keyboard-active=true]'), null, 'pointer opening does not paint a keyboard focus marker');
    const chosen = document.querySelector('[data-value="gamma"]');
    await click(chosen);
    assert.deepEqual(picks, ['gamma']);
    assert.equal(document.querySelector('.pero-select-trigger').getAttribute('data-value'), 'alpha');
    assert.equal(panel(), null);
    await render(tree('gamma', { onChange: next => picks.push(next) }));
    stubAnchor();
    assert.equal(document.querySelector('.pero-select-trigger').getAttribute('data-value'), 'gamma');
    await click(document.querySelector('.pero-select-trigger'));
    assert.equal(document.querySelector('[role="option"][data-value="gamma"] svg').getAttribute('width'), '14');
    await render(null);
  });

  await t.test('a listbox option is chosen by its value, not by a native select', async () => {
    const picks = [];
    await render(tree('alpha', { onChange: next => picks.push(next), label: 'Template' }));
    const trigger = stubAnchor();
    assert.equal(trigger.getAttribute('aria-haspopup'), 'listbox');
    assert.equal(trigger.getAttribute('aria-label'), 'Template');
    await click(trigger);
    const list = document.querySelector('[role="listbox"]');
    assert.equal(list.getAttribute('aria-label'), 'Template');
    const options = [...list.querySelectorAll('[role="option"]')];
    assert.equal(options.length, 4);
    await click(options.find(option => option.getAttribute('data-value') === 'gamma'));
    assert.deepEqual(picks, ['gamma']);
    assert.equal(document.querySelector('.pero-select-trigger').getAttribute('aria-expanded'), 'false');
    await render(null);
  });

  await t.test('keyboard skips disabled options', async () => {
    await render(tree('alpha'));
    const button = stubAnchor();
    await key(button, 'ArrowDown');
    const list = document.querySelector('[role="listbox"]');
    await key(list, 'ArrowDown');
    const active = document.querySelector('[data-active="true"]');
    assert.equal(active.getAttribute('data-value'), 'gamma');
    assert.equal(active.getAttribute('data-keyboard-active'), 'true');
    await React.act(async () => active.dispatchEvent(new dom.window.Event('pointermove', { bubbles: true })));
    assert.equal(active.hasAttribute('data-keyboard-active'), false, 'pointer navigation removes keyboard emphasis');
    assert.equal(document.querySelector('[aria-selected=true]').getAttribute('data-value'), 'alpha', 'hover does not change selection');
    assert.equal(document.querySelector('[data-value="beta"]').getAttribute('aria-disabled'), 'true');
    await key(list, 'Home');
    assert.equal(document.querySelector('[data-active="true"]').getAttribute('data-value'), 'alpha');
    assert.equal(document.querySelector('[data-active="true"]').getAttribute('data-keyboard-active'), 'true');
    await render(null);
  });

  await t.test('search filters groups, empty state, and aria-activedescendant', async () => {
    const many = [...options, ...Array.from({ length: 6 }, (_, index) => ({ value: `n${index}`, label: `Extra ${index}`, group: 'More' }))];
    await render(React.createElement(Select, { value: 'alpha', options: many, onChange: () => {}, label: 'Kind', searchLabel: 'Find kind', emptyLabel: 'None' }));
    await click(stubAnchor());
    const search = document.querySelector('.pero-select-search');
    assert.equal(search.getAttribute('role'), 'combobox');
    assert.equal(search.getAttribute('aria-label'), 'Find kind');
    const list = document.querySelector('[role="listbox"]');
    assert.ok(search.getAttribute('aria-activedescendant') === list.getAttribute('aria-activedescendant'), 'search and list share the active option');
    assert.ok(document.getElementById(search.getAttribute('aria-activedescendant')).getAttribute('data-value') === 'alpha', 'active descendant is the current value');
    const typeSearch = value => React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
      search._valueTracker?.setValue('');
      setter.call(search, value);
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await typeSearch('one');
    assert.equal(document.querySelectorAll('[role="option"]').length, 1);
    assert.equal(document.querySelector('[role="group"]').getAttribute('aria-label'), 'Numbers');
    await typeSearch('missing');
    assert.equal(document.querySelector('.pero-select-empty').textContent, 'None');
    assert.equal(document.querySelector('[role="listbox"]').hasAttribute('aria-activedescendant'), false);
    await typeSearch('First');
    assert.equal(document.querySelector('[role="option"]').getAttribute('data-value'), 'alpha', 'search includes the option hint');
    await render(null);
  });

  await t.test('IME candidate keys leave search, focus, and selection alone', async () => {
    for (const mode of ['composition events', 'native isComposing', 'legacy keyCode']) {
      const picks = [];
      await render(tree('alpha', { searchable: true, onChange: next => picks.push(next) }));
      const button = stubAnchor();
      await click(button);
      const search = document.querySelector('.pero-select-search');
      const activeId = search.getAttribute('aria-activedescendant');
      if (mode === 'composition events') await React.act(async () => {
        search.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      });
      for (const value of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab']) {
        const event = new dom.window.KeyboardEvent('keydown', {
          key: value, bubbles: true, cancelable: true,
          isComposing: mode === 'native isComposing', keyCode: mode === 'legacy keyCode' ? 229 : 0,
        });
        await React.act(async () => search.dispatchEvent(event));
        assert.equal(event.defaultPrevented, false, `${mode}: ${value} remains available to the IME`);
        assert.ok(panel(), `${mode}: ${value} keeps the menu open`);
        assert.equal(document.activeElement, search, `${mode}: ${value} keeps search focus`);
        assert.equal(search.getAttribute('aria-activedescendant'), activeId, `${mode}: ${value} does not navigate options`);
        assert.deepEqual(picks, [], `${mode}: ${value} does not select an option`);
      }
      if (mode === 'composition events') await React.act(async () => {
        search.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true, data: '字' }));
      });
      await key(search, 'ArrowDown');
      assert.equal(document.querySelector('[data-active="true"]').getAttribute('data-value'), 'gamma', `${mode}: navigation resumes`);
      await key(search, 'Enter');
      assert.deepEqual(picks, ['gamma'], `${mode}: ordinary Enter selects once`);
      assert.equal(panel(), null);
      assert.equal(document.activeElement, button);
      await render(null);
    }
  });

  await t.test('IME Escape stays inside Select before ordinary Escape closes each layer', async () => {
    for (const mode of ['composition events', 'native isComposing', 'legacy keyCode']) {
      let closes = 0;
      function Form() {
        const [open, setOpen] = React.useState(true);
        return open ? React.createElement(ui.Dialog, {
          title: 'Choose kind', closeLabel: 'Close',
          onClose: () => { closes++; setOpen(false); },
        }, tree('alpha', { searchable: true })) : null;
      }
      await render(React.createElement(Form));
      const dialog = document.querySelector('dialog');
      // jsdom has no native dialog close method; keep the real component's handlers.
      dialog.close = () => { dialog.removeAttribute('open'); };
      const button = stubAnchor();
      await click(button);
      const search = document.querySelector('.pero-select-search');
      assert.ok(dialog.contains(panel()));
      if (mode === 'composition events') await React.act(async () => {
        search.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
      });
      const escape = new dom.window.KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true,
        isComposing: mode === 'native isComposing', keyCode: mode === 'legacy keyCode' ? 229 : 0,
      });
      await React.act(async () => search.dispatchEvent(escape));
      assert.equal(escape.defaultPrevented, false, `${mode}: the IME retains default handling`);
      assert.equal(closes, 0, `${mode}: the dialog receives no close intent`);
      assert.ok(dialog.open && dialog.isConnected && panel(), `${mode}: both layers stay open`);
      assert.equal(document.activeElement, search);
      if (mode === 'composition events') await React.act(async () => {
        search.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
      });
      await key(search, 'Escape');
      assert.equal(panel(), null);
      assert.equal(closes, 0);
      assert.ok(dialog.open && dialog.isConnected);
      assert.equal(document.activeElement, button);
      await key(button, 'Escape');
      assert.equal(closes, 1);
      assert.equal(document.querySelector('dialog'), null);
      await render(null);
    }
  });

  await t.test('closing during composition does not leave the next search locked', async () => {
    await render(tree('alpha', { searchable: true }));
    const button = stubAnchor();
    await click(button);
    const search = document.querySelector('.pero-select-search');
    await React.act(async () => {
      search.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
      document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    });
    assert.equal(panel(), null);
    await click(button);
    await key(document.querySelector('.pero-select-search'), 'ArrowDown');
    assert.equal(document.querySelector('[data-active="true"]').getAttribute('data-value'), 'gamma');
    await key(document.querySelector('.pero-select-search'), 'Escape');
    assert.equal(panel(), null);
    await render(null);
  });

  await t.test('hints, footer actions, and trigger-sized menus stay outside the listbox', async () => {
    const picks = [];
    let actions = 0;
    dom.window.HTMLElement.prototype.getBoundingClientRect = anchorBox;
    await render(React.createElement(Select, {
      value: 'alpha', options, onChange: next => picks.push(next), label: 'Kind', showHint: true, searchable: true, menuMinWidth: 0,
      footer: React.createElement('button', { type: 'button', onClick: () => { actions += 1; } }, 'Add'),
    }));
    const button = document.querySelector('.pero-select-trigger');
    await click(button);
    assert.equal(panel().style.width, '120px');
    assert.equal(document.querySelector('[data-value="alpha"] small').textContent, 'First');
    const search = document.querySelector('.pero-select-search');
    await key(search, 'Tab');
    assert.equal(document.activeElement.textContent, 'Add');
    assert.equal(panel() != null, true, 'tab reaches the footer before closing');
    await click(document.activeElement);
    assert.equal(actions, 1);
    assert.deepEqual(picks, []);
    await render(null);
  });

  await t.test('depth indents nested options without changing the label', async () => {
    const nested = [
      { value: 'driver', label: 'TEST-A · driver' },
      { value: 'mod', label: 'MOD-A', depth: 1, hint: 'via TEST-A' },
    ];
    await render(React.createElement(Select, { value: 'driver', options: nested, onChange: () => {}, label: 'Kind', searchable: false }));
    await click(stubAnchor());
    const child = document.querySelector('[data-value="mod"]');
    assert.equal(child.getAttribute('data-depth'), '1');
    assert.equal(child.querySelector('span')?.textContent, 'MOD-A');
    assert.equal(getComputedStyle(child).getPropertyValue('padding-inline-start') !== '', true);
    await render(null);
  });

  await t.test('forwards the trigger ref and aria associations', async () => {
    const ref = React.createRef();
    await render(tree('alpha', { ref, id: 'kind', 'aria-describedby': 'kind-help', 'aria-invalid': true }));
    const button = document.getElementById('kind');
    assert.ok(ref.current === button, 'forwarded ref is the trigger');
    assert.equal(button.getAttribute('aria-describedby'), 'kind-help');
    assert.equal(button.getAttribute('aria-invalid'), 'true');
    assert.equal(button.ownerDocument.getElementById('pero-select-styles').textContent.includes('.pero-select-panel'), true);
    await render(null);
  });

  await t.test('explicit and native dialog portals, Escape focus, and Tab', async () => {
    const sink = document.createElement('div');
    document.body.append(sink);
    const wrapped = container => React.createElement(React.Fragment, null,
      React.createElement('button', { id: 'before' }, 'Before'),
      tree('alpha', { container }),
      React.createElement('button', { id: 'after' }, 'After'));
    await render(wrapped(sink));
    await click(stubAnchor());
    assert.ok(sink.contains(panel()), 'explicit container receives the popup');
    const moved = document.createElement('div'); document.body.append(moved);
    await render(wrapped(moved));
    assert.ok(moved.contains(panel()), 'the owner can change container while open');
    assert.equal(panel().style.visibility, 'visible', 'a moved popup is positioned again');
    const list = document.querySelector('[role="listbox"]');
    await key(list, 'Escape');
    assert.equal(panel(), null);
    assert.ok(document.activeElement === document.querySelector('.pero-select-trigger'), 'escape restores the trigger');
    await key(document.querySelector('.pero-select-trigger'), 'ArrowDown');
    const openList = document.querySelector('[role="listbox"]');
    await key(openList, 'Tab');
    assert.equal(panel(), null);
    assert.ok(document.activeElement === document.querySelector('.pero-select-trigger'), 'tab returns focus to the trigger');
    sink.remove(); moved.remove();
    await render(null);

    for (const placement of ['dialog', 'dialog-in-popup', 'popup-in-dialog']) {
      const content = placement === 'popup-in-dialog'
        ? React.createElement('div', { 'data-pero-popup-container': '', id: 'inner-popup' }, tree('alpha')) : tree('alpha');
      const dialog = React.createElement('dialog', { open: true, id: 'host-dialog' }, content);
      await render(placement === 'dialog-in-popup'
        ? React.createElement('div', { 'data-pero-popup-container': '' }, dialog) : dialog);
      const host = document.getElementById('host-dialog');
      await click(stubAnchor());
      assert.ok(panel().parentElement === (document.getElementById('inner-popup') ?? host), placement);
      await key(document.querySelector('[role="listbox"]'), 'Escape');
      assert.ok(host.contains(document.activeElement), `${placement}: escape focus stays in the dialog`);
      await render(null);
    }
  });
});

test('required selector blocks empty form submission, focuses its trigger, and submits the selected value', async t => {
  const env = await createUiRuntime(t, 'select'); if (!env) return;
  const { React, ui, render, click } = env;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  let submits = 0, submitted;
  function Form() {
    const [value, setValue] = React.useState('');
    return React.createElement('form', { onSubmit: event => { event.preventDefault(); submits++; submitted = new window.FormData(event.currentTarget).get('owner'); } },
      React.createElement(ui.Select, { label: 'Owner', name: 'owner', required: true, value, onChange: setValue, options: [{ value: '', label: 'Choose' }, { value: 'alice', label: 'Alice' }] }),
      React.createElement('button', { type: 'submit' }, 'Save'));
  }
  await render(React.createElement(Form));
  const trigger = document.querySelector('.pero-select-trigger');
  trigger.getBoundingClientRect=()=>({top:10,bottom:40,left:10,right:130,width:120,height:30});
  await click(document.querySelector('button[type="submit"]'));
  assert.equal(submits, 0);
  assert.equal(document.activeElement, trigger);
  assert.equal(trigger.getAttribute('aria-invalid'), 'true');
  await click(trigger);
  await click(document.querySelector('[role="option"][data-value="alice"]'));
  assert.equal(trigger.getAttribute('aria-invalid'), null);
  await click(document.querySelector('button[type="submit"]'));
  assert.equal(submits, 1); assert.equal(submitted, 'alice');
});
