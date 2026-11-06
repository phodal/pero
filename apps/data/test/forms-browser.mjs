/** Real DOM submission behavior, with and without Desktop's form restriction. */
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { appSdkAliases } from '../../../scripts/build/app-sdk.mjs';

const root = resolve(import.meta.dirname, '../../..'), appRoot = resolve(root, 'apps/data');
let browser, directory, html;
before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'pero-data-forms-'));
  const result = await build({ stdin: { contents: `
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { DataForm, SubmitButton } from './ui-src/submit-button';
    function Fixture() {
      const [count, setCount] = useState(0), [busy, setBusy] = useState(false), [footer, setFooter] = useState(false);
      return <><label><input type="checkbox" checked={busy} onChange={e => setBusy(e.target.checked)} />Busy</label>
        <label><input type="checkbox" checked={footer} onChange={e => setFooter(e.target.checked)} />Footer action</label>
        <DataForm id="data-form" onSubmit={e => { e.preventDefault(); setCount(n => n + 1); }}>
          <label>Name<input name="name" required /></label>
          <label>Notes<textarea /></label>
          <label>Choice<select><option>One</option><option>Two</option></select></label>
          {!footer && <SubmitButton disabled={busy}>Save</SubmitButton>}
        </DataForm>{footer && <footer><SubmitButton form="data-form" disabled={busy}>Save</SubmitButton></footer>}
        <output aria-label="Submissions">{count}</output></>;
    }
    createRoot(document.getElementById('app')).render(<Fixture />);
  `, resolveDir: appRoot, loader: 'tsx' }, outfile: resolve(directory, 'fixture.js'), write: false,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', alias: appSdkAliases(root),
    nodePaths: [resolve(appRoot, 'node_modules')], loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' },
    plugins: [{ name: 'app-react-runtime', setup(builder) {
      builder.onResolve({ filter: /^(react|react-dom)(\/|$)/ }, args => args.resolveDir === appRoot ? undefined : builder.resolve(args.path, { kind: args.kind, resolveDir: appRoot }));
    } }] });
  const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  html = '<!doctype html><div id="app"></div><script>' + js.replaceAll('</script', '<\\/script') + '</script>';
  browser = await chromium.launch({ ...(process.env.PERO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PERO_CHROMIUM_EXECUTABLE } : {}), headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

for (const footer of [false, true]) for (const sandboxed of [true, false]) test(`validated ${footer ? 'footer' : 'inline'} submission ${sandboxed ? 'without allow-forms' : 'outside sandbox'}`, async t => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); expect(errors).toEqual([]); });
  await page.setContent('<iframe title="fixture"></iframe>');
  await page.locator('iframe').evaluate((frame, { html, sandboxed }) => {
    if (sandboxed) frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.srcdoc = html;
  }, { html, sandboxed });
  const frame = page.frameLocator('iframe');
  const name = frame.getByRole('textbox', { name: 'Name', exact: true });
  const count = frame.getByLabel('Submissions');
  const save = frame.getByRole('button', { name: 'Save', exact: true });
  await expect(name).toBeVisible();
  if (footer) await frame.getByRole('checkbox', { name: 'Footer action', exact: true }).check();
  await save.click(); await expect(count).toHaveText('0');
  await expect(name).toBeFocused();
  await name.press('Enter'); await expect(count).toHaveText('0');
  await name.fill('Dataset');
  await name.press('Enter'); await expect(count).toHaveText('1');
  await save.click(); await expect(count).toHaveText('2');
  await save.press('Enter'); await expect(count).toHaveText('3');
  await frame.getByRole('checkbox', { name: 'Busy' }).check();
  await expect(save).toBeDisabled();
  await name.press('Enter'); await expect(count).toHaveText('3');
  await frame.getByRole('checkbox', { name: 'Busy' }).uncheck();
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true }, { shiftKey: true }]) {
    await name.dispatchEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
    await expect(count).toHaveText('3');
  }
  const notes = frame.getByRole('textbox', { name: 'Notes' });
  await notes.fill('First'); await notes.press('End'); await notes.press('Enter'); await notes.press('X');
  await expect(notes).toHaveValue('First\nX'); await expect(count).toHaveText('3');
  await frame.getByRole('combobox', { name: 'Choice' }).press('Enter');
  await expect(count).toHaveText('3');
  await name.press('Enter'); await expect(count).toHaveText('4');
});
