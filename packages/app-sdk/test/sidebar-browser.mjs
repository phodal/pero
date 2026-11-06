import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const repository = resolve(import.meta.dirname, '../../..');
const output = resolve(repository, 'target/design-review');
await mkdir(output, { recursive: true });
const server = await createServer({
  root: resolve(repository, 'packages/pero-design/catalog'),
  configFile: resolve(repository, 'packages/pero-design/catalog/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  const nav = page.getByRole('navigation', { name: '组件导航' });
  await nav.waitFor();
  const group = nav.getByRole('group', { name: '组件示例' });
  assert.equal(await group.locator('.pero-sidebar-group-label').isVisible(), true);
  assert.equal(await group.locator('.pero-sidebar-count').isVisible(), true);
  await page.screenshot({ path: resolve(output, 'sidebar-light-expanded.png'), fullPage: true });
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
  assert.equal(await group.locator('.pero-sidebar-group-label').isVisible(), false);
  assert.equal(await group.locator('.pero-sidebar-count').isVisible(), false);
  const rows = nav.locator('.pero-sidebar-row');
  for (const row of await rows.all()) {
    const box = await row.boundingBox();
    const lead = await row.locator('.pero-lead').boundingBox();
    assert.ok(box && lead && box.width >= 24 && box.height >= 24);
    assert.ok(Math.abs((box.x + box.width / 2) - (lead.x + lead.width / 2)) < 1);
  }
  const target = nav.getByRole('button', { name: '标题与列表', exact: true });
  await target.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.pero-library-heading h1').textContent(), '标题与列表');
  assert.equal(await target.getAttribute('aria-current'), 'page');
  await nav.getByRole('button', { name: '窗口与导航', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'sidebar-dark-collapsed.png'), fullPage: true });
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  assert.equal(await group.locator('.pero-sidebar-group-label').isVisible(), true);
  assert.equal(await group.locator('.pero-sidebar-count').isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('Sidebar browser checks passed: group labels, count visibility, centered targets, keyboard navigation and expand/collapse.');
} finally {
  await browser?.close();
  await server.close();
}
