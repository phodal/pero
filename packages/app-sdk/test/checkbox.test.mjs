import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('checkbox reports intent, indeterminate state, form data and its label', async t => {
  const env = await createUiRuntime(t, 'checkbox'); if (!env) return;
  const { React, dom, ui, render, click } = env;
  const { Checkbox } = ui;
  const box = () => document.querySelector('[role="checkbox"]');
  const mark = () => document.querySelector('.pero-ui-checkbox-indicator');
  const formData = form => new dom.window.FormData(form);

  await t.test('controlled clicks report intent without changing checked or indeterminate', async () => {
    const values = [];
    const tree = checked => React.createElement(Checkbox, { checked, 'aria-label': 'Watch information changes', onCheckedChange: value => values.push(value) });
    await render(tree(false));
    const control = box();
    assert.equal(control.type, 'button');
    assert.equal(control.classList.contains('pero-ui-checkbox'), true);
    assert.equal(control.hasAttribute('data-unstyled'), false);
    assert.equal(control.getAttribute('aria-checked'), 'false');
    assert.equal(control.getAttribute('data-state'), 'unchecked');
    assert.equal(mark(), null);
    await click(control);
    assert.deepEqual(values, [true]);
    assert.equal(control.getAttribute('aria-checked'), 'false');
    assert.equal(mark(), null);
    await render(tree(true));
    assert.equal(control.getAttribute('aria-checked'), 'true');
    assert.equal(control.getAttribute('data-state'), 'checked');
    assert.equal(mark().textContent, '');
    assert.equal(mark().querySelector('svg').getAttribute('aria-hidden'), 'true');
    assert.equal(mark().querySelector('svg').getAttribute('width'), '14');
    assert.equal(mark().getAttribute('aria-hidden'), 'true');
    assert.equal(mark().classList.contains('pero-ui-checkbox-indicator'), true);
    await click(control);
    assert.deepEqual(values, [true, false]);
    assert.equal(control.getAttribute('aria-checked'), 'true');
    const checkedPath = mark().querySelector('path').getAttribute('d');
    await render(tree('indeterminate'));
    assert.equal(control.getAttribute('aria-checked'), 'mixed');
    assert.equal(control.getAttribute('data-state'), 'indeterminate');
    assert.equal(mark().textContent, '');
    assert.notEqual(mark().querySelector('path').getAttribute('d'), checkedPath);
    assert.equal(mark().getAttribute('aria-hidden'), 'true');
    await click(control);
    assert.deepEqual(values, [true, false, true]);
    assert.equal(control.getAttribute('aria-checked'), 'mixed');
    await render(React.createElement(Checkbox, { checked: false, unstyled: true, className: 'pero-webhook-check', 'aria-label': 'Watch information changes' }));
    assert.equal(box().getAttribute('data-unstyled'), 'true');
    assert.equal(box().classList.contains('pero-ui-checkbox'), true);
    assert.equal(document.querySelectorAll('#pero-app-ui-styles').length, 1);
  });

  await t.test('defaultChecked submits, resets and skips disabled controls', async () => {
    const values = [];
    await render(React.createElement('form', null,
      React.createElement(Checkbox, { name: 'requireSignature', defaultChecked: true, onCheckedChange: value => values.push(value) }),
      React.createElement(Checkbox, { name: 'locked', defaultChecked: true, disabled: true, onCheckedChange: value => values.push(['locked', value]) })));
    const form = document.querySelector('form');
    const [signature, locked] = document.querySelectorAll('[role="checkbox"]');
    assert.equal(signature.getAttribute('aria-checked'), 'true');
    assert.equal(mark().textContent, '');
    assert.equal(mark().querySelector('svg').getAttribute('aria-hidden'), 'true');
    assert.equal(mark().querySelector('svg').getAttribute('width'), '14');
    assert.equal(formData(form).get('requireSignature'), 'on');
    assert.equal(formData(form).get('locked'), null);
    assert.equal(locked.disabled, true);
    await click(signature);
    assert.deepEqual(values, [false]);
    assert.equal(signature.getAttribute('aria-checked'), 'false');
    assert.equal(formData(form).get('requireSignature'), null);
    await click(locked);
    assert.deepEqual(values, [false]);
    assert.equal(locked.getAttribute('aria-checked'), 'true');
    await React.act(async () => { form.reset(); });
    assert.equal(signature.getAttribute('aria-checked'), 'true');
    assert.equal(mark().textContent, '');
    assert.equal(mark().querySelector('svg').getAttribute('aria-hidden'), 'true');
    assert.equal(mark().querySelector('svg').getAttribute('width'), '14');
    assert.equal(formData(form).get('requireSignature'), 'on');
    assert.equal(formData(form).get('locked'), null);
    assert.deepEqual(values, [false, true]);
  });

  await t.test('the existing label and ref toggle the button without submitting', async () => {
    const ref = React.createRef();
    const values = [];
    let submits = 0;
    await render(React.createElement('form', { onSubmit: event => { event.preventDefault(); submits++; } },
      React.createElement('label', null,
        React.createElement('span', null, React.createElement(Checkbox, { ref, name: 'requireSignature', defaultChecked: false, onCheckedChange: value => values.push(value) }), ' Require HMAC-SHA256 signature')),
      React.createElement('button', { type: 'submit' }, 'Create source')));
    const control = box();
    const label = document.querySelector('label');
    assert.equal(ref.current, control);
    assert.equal(control.tagName, 'BUTTON');
    assert.equal(control.type, 'button');
    assert.equal(control.getAttribute('aria-label'), null);
    assert.equal(label.control, control);
    assert.equal(control.labels[0], label);
    assert.equal(label.textContent.includes('Require HMAC-SHA256 signature'), true);
    await click(label);
    assert.deepEqual(values, [true]);
    assert.equal(control.getAttribute('aria-checked'), 'true');
    assert.equal(submits, 0);
    await React.act(async () => {
      const event = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      control.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    });
    assert.equal(submits, 0);
    assert.equal(control.getAttribute('aria-checked'), 'true');
    await click(document.querySelector('button[type="submit"]'));
    assert.equal(submits, 1);
    await render(null);
    assert.equal(ref.current, null);
  });

  await t.test('required and indeterminate stay on the hidden input; the button is not a validation anchor', async () => {
    await render(React.createElement('form', null, React.createElement(Checkbox, { name: 'ack', required: true, defaultChecked: false, 'aria-label': 'Acknowledge' })));
    const control = box();
    const hidden = document.querySelector('input[type="checkbox"]');
    const form = document.querySelector('form');
    assert.notEqual(hidden, control);
    assert.equal(hidden.getAttribute('aria-hidden'), 'true');
    assert.equal(control.getAttribute('aria-required'), 'true');
    assert.equal(control.willValidate, false);
    assert.equal(control.checkValidity(), true);
    assert.equal(control.reportValidity(), true);
    control.setCustomValidity('Choose this');
    assert.equal(control.checkValidity(), true);
    assert.equal(control.validationMessage, '');
    assert.equal(form.checkValidity(), false);
    assert.equal(form.reportValidity(), false);
    assert.equal(hidden.validity.valueMissing, true);
    assert.equal(formData(form).get('ack'), null);
    await click(control);
    assert.equal(form.checkValidity(), true);
    assert.equal(formData(form).get('ack'), 'on');
    await render(React.createElement('form', null, React.createElement(Checkbox, { name: 'partial', required: true, checked: 'indeterminate', 'aria-label': 'Partial' })));
    const mixed = box();
    const mixedForm = document.querySelector('form');
    assert.equal(mixed.getAttribute('aria-checked'), 'mixed');
    assert.equal(mark().textContent, '');
    assert.equal(mark().querySelector('svg').getAttribute('aria-hidden'), 'true');
    assert.equal(formData(mixedForm).get('partial'), null);
    assert.equal(mixedForm.checkValidity(), false);
    assert.equal(document.querySelector('input[type="checkbox"]').validity.valueMissing, true);
    assert.equal(mixed.checkValidity(), true);
  });
});
