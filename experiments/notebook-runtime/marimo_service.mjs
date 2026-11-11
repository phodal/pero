// Opt-in interactive marimo service; the same authored task as the CLI probe.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
const python = resolve(process.argv[2]), output = resolve(process.argv[3]);
await mkdir(output); // Refuse to reuse old output as a new successful run.
execFileSync(python, ['-c', `import sys,pathlib,shutil
sys.path.insert(0,sys.argv[1])
from task import marimo_source
out=pathlib.Path(sys.argv[2])
(out/'analysis.py').write_text(marimo_source())
shutil.copyfile(pathlib.Path(sys.argv[1])/'input.csv',out/'input.csv')`, import.meta.dirname, output]);
const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
const port = portProbe.address().port; await new Promise(done => portProbe.close(done));
const started = performance.now();
const child = spawn(python, ['-m', 'marimo', 'edit', resolve(output, 'analysis.py'), '--headless', '--no-token',
  '--host', '127.0.0.1', '--port', String(port), '--skip-update-check', '--no-sandbox'], { cwd: output, stdio: ['ignore','pipe','pipe'] });
let log = ''; child.stdout.on('data', bytes => log += bytes); child.stderr.on('data', bytes => log += bytes);
const exited = once(child, 'exit');
const browser = await chromium.launch();
let page;
const errors = [];
try {
  const origin = `http://127.0.0.1:${port}`;
  await expect.poll(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, { timeout: 30_000 }).toBe(true);
  const readySeconds = (performance.now()-started)/1000;
  page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await expect(page.locator('.cm-content').first()).toBeVisible();
  // Upstream's global.runStale shortcut; edit mode does not autorun this source.
  await page.keyboard.press('ControlOrMeta+Shift+r');
  await expect(page.getByRole('heading', { name: 'Authored CSV runtime fixture' })).toBeVisible({ timeout: 30_000 });
  assert.deepEqual(JSON.parse(await readFile(resolve(output, 'result.json'), 'utf8')),
    { control: { n: 3, mean_mg_l: '2' }, treatment: { n: 3, mean_mg_l: '4' } });
  await page.screenshot({ path: resolve(output, 'marimo-editor.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('.cm-content').first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+r');
  await expect(page.getByRole('heading', { name: 'Authored CSV runtime fixture' })).toBeVisible({ timeout: 30_000 });
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify({ readySeconds, errors,
    memory: JSON.parse(execFileSync(python, ['-c', 'import sys,json;sys.path.insert(0,sys.argv[1]);from process_memory import process_memory;print(json.dumps(process_memory(int(sys.argv[2]))))', import.meta.dirname, String(child.pid)], {encoding:'utf8'})),
    browserReload: true, execution: 'completed', verification: 'authored_fixture_equal', scientificAcceptance: 'not-assessed' }, null, 2));
} finally {
  if (page) {
    await page.screenshot({ path: resolve(output, 'checkpoint.png'), fullPage: true });
    await writeFile(resolve(output, 'browser.json'), JSON.stringify({errors, body: await page.locator('body').innerText()}, null, 2));
  }
  await browser.close(); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited; clearTimeout(timer);
  await writeFile(resolve(output, 'server.log'), log);
}
