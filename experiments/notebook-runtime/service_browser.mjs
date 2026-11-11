// Real upstream UI, no provider configuration or AI request.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
const output = resolve(process.argv[2]);
const { url } = JSON.parse(await readFile(resolve(output, 'connection.json'), 'utf8'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator('.jp-Notebook')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.jp-Notebook')).toContainText('concentration_mg_l');
  await page.screenshot({ path: resolve(output, 'jupyter-lab.png'), fullPage: true });
  const ai = page.locator('[title="Jupyter Chat"]');
  const titles = await page.locator('[title]').evaluateAll(nodes => nodes.map(node => node.getAttribute('title')).filter(t => /AI|Chat|Agent/i.test(t)));
  await expect(ai.first()).toBeVisible();
  await ai.first().click();
  const newChat = page.getByTitle('Create a new chat');
  if (await newChat.count()) await newChat.first().click();
  await page.screenshot({ path: resolve(output, 'jupyter-ai.png'), fullPage: true });
  await writeFile(resolve(output, 'browser.json'), JSON.stringify({ errors, aiTitles: titles, body: (await page.locator('body').innerText()).slice(0, 12000) }, null, 2));
} finally { await browser.close(); }
