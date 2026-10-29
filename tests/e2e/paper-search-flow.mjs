import { expect } from '@playwright/test';
import { resolve } from 'node:path';

export async function exerciseLocalSearch({ frame, page, app, out }) {
  const search = frame.getByRole('region', { name: 'Search saved text', exact: true });
  const input = search.getByRole('searchbox', { name: 'Search saved text', exact: true });
  await input.fill('source snapshot');
  await input.press('Enter');
  await expect(search.locator('[data-search-hit]').first()).toBeVisible();
  await expect(search.locator('[data-search-hit]').first()).toContainText('A source snapshot preserves');
  await search.locator('[data-search-hit]').first().getByText('Snapshot details', { exact: true }).click();
  await expect(search.locator('details[open] code')).toContainText('sha256:');
  await page.screenshot({ path: resolve(out, 'local-search.png') });
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  const preferences = await page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).preferences);
  await page.evaluate(preferences => window.pero.sessionCommand({ method: 'settings.workbench', preferences: { ...preferences, appearance: 'dark' } }), preferences);
  await expect.poll(async () => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  await expect.poll(async () => frame.locator('html').evaluate(element => element.clientWidth)).toBe(760);
  await expect.poll(async () => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(search.locator('details[open] code')).toBeVisible();
  await page.screenshot({ path: resolve(out, 'local-search-dark-narrow.png') });
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), size);
  await page.evaluate(preferences => window.pero.sessionCommand({ method: 'settings.workbench', preferences }), preferences);

  await input.fill('unfindable-query-term');
  await input.press('Enter');
  await expect(search.getByText(/No matching passages/)).toBeVisible();
  await expect(search.locator('[data-search-hit]')).toHaveCount(0);
  await input.fill('???');
  await input.press('Enter');
  await expect(search.getByRole('alert')).toContainText('searchable words');
  await expect(search.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await input.fill('source snapshot');
  await input.press('Enter');
  await expect(search.locator('[data-search-hit]').first()).toBeVisible();
  await search.locator('[data-search-hit]').first().getByRole('button').click();
  await expect(frame.getByRole('heading', { name: 'Synthetic reading · a reproducible citation example', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Back to library', exact: true }).click();
  await search.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(frame.locator('.pa-library-list')).toBeVisible();
}

export async function exercisePdfSearch({ frame, page, out, realPdf }) {
  const search = frame.getByRole('region', { name: 'Search saved text', exact: true });
  const input = search.getByRole('searchbox', { name: 'Search saved text', exact: true });
  await input.fill(realPdf ? 'attention mechanism' : 'Second page');
  await input.press('Enter');
  const hit = search.locator('[data-search-page]').first();
  await expect(hit).toBeVisible();
  const targetPage = await hit.getAttribute('data-search-page');
  await hit.getByRole('button').click();
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
  await expect(frame.locator('.pa-reading-bar').getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue(targetPage);
  await page.screenshot({ path: resolve(out, 'local-search-pdf.png') });
}
