// Long-list and empty-calendar UI fixture. Does not prove scheduling or Agent execution.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';

async function withPreview(fixture, run) {
  const server = spawn(process.execPath, [resolve(import.meta.dirname, 'preview.mjs')], {stdio: ['ignore', 'pipe', 'inherit'], env: {...process.env, PERO_AUTOMATION_FIXTURE: fixture}});
  let browser;
  try {
    const origin = await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview not ready')), 10000);
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited ${code}`)); });
      server.stdout.on('data', chunk => { const match = /http:\/\/127\.0\.0\.1:\d+/.exec(String(chunk)); if (match) { clearTimeout(timer); done(match[0]); } });
    });
    browser = await chromium.launch({headless: true, executablePath: process.env.PERO_CHROMIUM_PATH || chromium.executablePath(), args: ['--no-sandbox']});
    const page = await browser.newPage({viewport: {width: 1280, height: 420}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/test-shell`);
    const app = page.frameLocator('iframe');
    await run(app);
    if (errors.length) throw new Error(errors.join('\n'));
  } finally { await browser?.close(); server.kill('SIGTERM'); }
}

await withPreview('long', async app => {
  const row = app.getByRole('row').filter({has: app.getByRole('button', {name: 'Pulse 每日简报', exact: true})});
  await row.getByRole('button', {name: 'Details', exact: true}).click();
  const details = app.getByRole('region', {name: 'Automation details'});
  const title = details.getByRole('heading', {name: 'Pulse 每日简报'});
  await expect(details).toBeInViewport();
  await expect(title).toBeFocused();
  await title.press('Tab');
  await expect(app.getByRole('button', {name: 'Edit', exact: true})).toBeFocused();
  await expect(app.locator('.latest')).not.toContainText('Summarize the supplied local material.');
  await expect(app.getByRole('button', {name: 'Open session', exact: true})).toBeVisible();
  await app.getByRole('button', {name: 'New automation', exact: true}).click();
  const name = app.getByLabel('Name', {exact: true});
  await expect(app.getByRole('region', {name: 'Automation editor'})).toBeInViewport();
  await expect(name).toBeFocused();
  await name.fill('Still focused');
  await pageWait(app, 6500);
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Still focused');
});

await withPreview('empty', async app => {
  await app.getByRole('radio', {name: 'Calendar'}).click();
  await app.getByRole('button', {name: 'Templates', exact: true}).click();
  await expect(app.getByRole('button', {name: 'Daily research brief'})).toBeVisible();
  await expect(app.getByRole('radio', {name: 'List'})).not.toHaveAttribute('data-unstyled');
});

function pageWait(app, ms) {
  return app.locator('body').evaluate((_body, delay) => new Promise(resolveWait => setTimeout(resolveWait, delay)), ms);
}

console.log('Automation long-list focus and empty-calendar template fixture passed. No Host/Agent execution claim.');
