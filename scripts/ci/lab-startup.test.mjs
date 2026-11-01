import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the actual launch readiness block without Electron, Python or hardware.
const source = readFileSync(new URL('../../tests/e2e/lab.mjs', import.meta.url), 'utf8');
const start = source.indexOf('  frame = page.frameLocator(');
const end = source.indexOf('\n}\nconst readExperiment', start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);

for (const fails of [false, true]) test(`Lab startup uses its existing readiness budget before frame assertions (fails=${fails})`, async () => {
  const calls = [];
  let ready = false;
  const iframe = { name: 'iframe', async getAttribute(name) {
    assert.equal(name, 'sandbox'); calls.push('sandbox value');
    return 'allow-scripts allow-same-origin allow-downloads allow-popups';
  } };
  const page = {
    frameLocator(selector) {
      assert.equal(selector, 'iframe[title="lab"]');
      return { getByRole(role, options) { return { name: options.name, role }; } };
    },
    locator(selector) { assert.equal(selector, 'iframe[title="lab"]'); return iframe; },
  };
  const expect = target => ({
    async toBeEnabled(options) {
      assert.equal(target.name, 'Freeze experiment'); assert.equal(target.role, 'button');
      assert.equal(options.timeout, 120000); calls.push('startup ready');
      if (fails) throw Error('fixture startup failed');
      ready = true;
    },
    async toBeVisible() { assert.ok(ready, 'No premature five-second assertion before startup readiness'); calls.push(`${target.name} visible`); },
    async toHaveAttribute(name, pattern) { assert.ok(ready); assert.equal(name, 'sandbox'); assert.ok(pattern.test('allow-scripts')); calls.push('sandbox scripts'); },
    not: { toContain(value) { assert.equal(value, 'allow-forms'); assert.ok(!target.includes(value)); calls.push('sandbox forms excluded'); } },
  });
  const result = runInNewContext(`(async () => { let frame; ${block}\n})()`, { page, expect });
  if (fails) { await assert.rejects(result, /fixture startup failed/); assert.deepEqual(calls, ['startup ready']); }
  else { await result; assert.deepEqual(calls, ['startup ready', 'iframe visible', 'Lab visible', 'sandbox scripts', 'sandbox value', 'sandbox forms excluded']); }
});
