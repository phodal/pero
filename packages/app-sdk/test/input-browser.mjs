// Real keyboard focus and computed colors across the two shared input implementations.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const sdk = resolve(import.meta.dirname, '..');
const palettes = JSON.parse(await readFile(resolve(sdk, '../../web/src/theme.generated.json'), 'utf8'));
let browser, script, stylesheet;
before(async () => {
  const built = await build({
    stdin: { resolveDir: sdk, loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { Input, Textarea, NativeSelect, MultiSelect } from './src/components/input';
      import { Button } from './src/components/button';
      import { SearchField, SidebarRow } from '../pero-design/src/components';
      import { Tabs, TabsList, TabsTrigger } from './src/components/tabs';
      import './src/ui.css';
      createRoot(document.getElementById('app')).render(<>
        <Button>Before form</Button>
        <form>
          <Input aria-label="Name"/>
          <Textarea aria-label="Description"/>
          <SearchField aria-label="Search"/>
          <Input aria-label="Invalid name" aria-invalid="true"/>
          <Textarea aria-label="Invalid description" aria-invalid="true"/>
          <SearchField aria-label="Invalid search" aria-invalid="true"/>
          <Input aria-label="Disabled" disabled defaultValue="Preserved value"/>
          <NativeSelect aria-label="Native choice"><option>First</option></NativeSelect>
          <MultiSelect aria-label="Multiple choices"><option>First</option></MultiSelect>
          <Input aria-label="Unstyled" unstyled/>
        </form>
        <SidebarRow label="Navigation" selected/>
        <Tabs defaultValue="one"><TabsList aria-label="Views"><TabsTrigger value="one">One</TabsTrigger></TabsList></Tabs>
        <span id="muted" style={{color:'var(--pero-text-muted)'}}/>
        <span id="error" style={{color:'var(--pero-error)'}}/>
        <span id="focus" style={{color:'var(--pero-focus)'}}/>
      </>);` },
    bundle: true, write: false, outdir: '/tmp/pero-input-browser', platform: 'browser', format: 'esm', jsx: 'automatic',
  });
  script = built.outputFiles.find(file => file.path.endsWith('.js')).text;
  stylesheet = built.outputFiles.find(file => file.path.endsWith('.css')).text;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

function contrast(first, second) {
  const luminance = color => {
    const values = color.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

for (const [theme, size] of [['light', 14], ['dark', 24]]) test(`text inputs keep a neutral, fitted keyboard focus in ${theme} at ${size}px`, async t => {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  const colors = Object.entries(palettes[theme]).map(([name, color]) => `--pero-${name}:${color}`).join(';');
  await page.route('http://inputs.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: path === '/ui.js' ? 'text/javascript' : 'text/html', body: path === '/ui.js' ? script : `<!doctype html><html data-theme="${theme}"><head><style>${stylesheet}</style><style>:root {${colors};--pero-font-scale:${size / 14}} body {margin:24px;background:var(--pero-bg)} form {display:grid;gap:16px;margin:16px 0}</style></head><body><div id="app"></div><script type="module" src="/ui.js"></script></body></html>` });
  });
  await page.goto('http://inputs.test/');
  const muted = await page.locator('#muted').evaluate(node => getComputedStyle(node).color);
  const error = await page.locator('#error').evaluate(node => getComputedStyle(node).color);
  const focus = await page.locator('#focus').evaluate(node => getComputedStyle(node).color);
  await page.getByRole('button', { name: 'Before form', exact: true }).focus();
  for (const label of ['Name', 'Description', 'Search', 'Invalid name', 'Invalid description', 'Invalid search']) {
    await page.keyboard.press('Tab');
    const input = page.getByRole(label.toLowerCase().includes('search') ? 'searchbox' : 'textbox', { name: label, exact: true });
    await expect(input).toBeFocused();
    const ring = await input.evaluate(node => {
      const css = getComputedStyle(node);
      return { width: parseFloat(css.outlineWidth), offset: parseFloat(css.outlineOffset), style: css.outlineStyle, color: css.outlineColor, background: css.backgroundColor, border: css.borderColor, shadow: css.boxShadow };
    });
    assert.equal(ring.style, 'solid');
    assert.equal(ring.width, 1);
    assert.equal(ring.width + ring.offset, 0, 'focus stays within the existing border bounds');
    assert.equal(ring.color, label.startsWith('Invalid') ? error : muted);
    assert.ok(contrast(ring.color, ring.background) >= 3, `${label} focus has at least 3:1 surface contrast`);
    assert.equal(ring.shadow, 'none');
    if (label.startsWith('Invalid')) assert.equal(ring.border, error, 'validation remains visible on focus');
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Native choice', exact: true })).toBeFocused();
  const disabled = page.getByRole('textbox', { name: 'Disabled', exact: true });
  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveValue('Preserved value');
  assert.equal(await disabled.evaluate(node => getComputedStyle(node).opacity), '0.5');
  for (const control of [page.getByRole('combobox', { name: 'Native choice' }), page.getByRole('listbox', { name: 'Multiple choices' }), page.getByRole('textbox', { name: 'Unstyled' }), page.getByRole('button', { name: 'Navigation' }), page.getByRole('tab', { name: 'One' })]) {
    await control.focus();
    const ring = await control.evaluate(node => { const css = getComputedStyle(node); return { width: parseFloat(css.outlineWidth), color: css.outlineColor }; });
    assert.equal(ring.width, 2, 'other control families keep their existing focus width');
    assert.equal(ring.color, focus, 'other control families keep their existing focus color');
  }
});
