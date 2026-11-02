import { expect } from '@playwright/test';
import { resolve } from 'node:path';

// Run inside the actual App frame: Electron's pero-app protocol is not a
// Playwright network route. Preserve the real backend Response and hold delivery.
export function deferPdfLocate() {
  const original = window.fetch;
  let release, ready;
  const held = new Promise(resolve => { release = resolve; });
  const gate = window.paperLocateGate = {
    arrived: false, delivered: false, error: '', ready: new Promise(resolve => { ready = resolve; }),
    release, restore() { window.fetch = original; release(); },
  };
  window.fetch = async (...args) => {
    const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, window.location.href);
    if (url.pathname !== '/api/pdf/locate') return original.apply(window, args);
    try {
      const response = await original.apply(window, args);
      if (!response.ok) throw Error(`PDF locate failed: ${response.status}`);
      await response.clone().arrayBuffer();
      gate.arrived = true; ready();
      await held;
      gate.delivered = true;
      return response;
    } catch (error) { gate.error = String(error); ready(); throw error; }
  };
}

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
  await expect.poll(async () => frame.locator('html').evaluate(element => element.clientWidth > 600 && element.clientWidth <= 800)).toBe(true);
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
  await exerciseSearchKeyboard({ frame, page, out });
}

export async function exerciseSearchKeyboard({ frame, page, out }) {
  const search = frame.getByRole('region', { name: 'Search saved text', exact: true });
  const input = search.getByRole('searchbox', { name: 'Search saved text', exact: true });
  let requests = 0;
  const observeSearch = request => { if (request.method() === 'POST' && request.url().endsWith('/api/library/search')) requests++; };
  page.on('request', observeSearch);
  try {
    await input.fill('');
    await input.fill('source snapshot');
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    // Flush the key event's render work before asserting that composition sent no request.
    await input.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(requests).toBe(0);
    await expect(search.locator('[data-search-hit]')).toHaveCount(0);
    for (const [index, activation] of ['Enter', 'Space', 'click'].entries()) {
      await input.fill('source snapshot');
      await input.press('Enter');
      await expect(search.locator('[data-search-hit]').first()).toBeVisible();
      expect(requests).toBe(index + 1);
      const clear = search.getByRole('button', { name: 'Clear search', exact: true });
      if (activation === 'click') await clear.click();
      else {
        await input.press('Tab');
        await expect(clear).toBeFocused();
        await clear.press(activation);
      }
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      await expect(search.locator('[data-search-hit]')).toHaveCount(0);
      await expect(frame.locator('.pa-library-list')).toBeVisible();
      expect(requests).toBe(index + 1);
      if (activation === 'Enter') await page.screenshot({ path: resolve(out, 'local-search-keyboard-clear.png') });
    }
  } finally { page.off('request', observeSearch); }
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
  await expect(viewer.locator(`[data-page-number="${targetPage}"] [data-citation-region="true"]`).first()).toBeVisible();
  await page.screenshot({ path: resolve(out, 'local-search-pdf.png') });
  // A real response is held until after a newer reader input, not delayed by a
  // timer. Await the real response body and render frames before checking that the
  // stale search did not change either the user's page or their Text view.
  const nav = frame.locator('.pa-reading-bar');
  for (const action of ['page', 'text']) {
    await nav.getByRole('button', { name: 'Back to library', exact: true }).click();
    await frame.locator('body').evaluate(deferPdfLocate);
    try {
      await hit.getByRole('button').click();
      await expect.poll(() => frame.locator('body').evaluate(() => {
        if (window.paperLocateGate.error) throw Error(window.paperLocateGate.error);
        return window.paperLocateGate.arrived;
      }), { message: 'Real PDF locate response reached the App fetch gate' }).toBe(true);
      const pageInput = nav.getByRole('spinbutton', { name: 'Page', exact: true });
      await expect(pageInput).toHaveValue(targetPage);
      const chosenPage = targetPage === '1' ? '2' : '1';
      if (action === 'page') {
        await pageInput.fill(chosenPage);
        await expect(pageInput).toHaveValue(chosenPage);
      } else {
        await viewer.focus(); await viewer.press('Shift+F10');
        await viewer.getByRole('menuitem', { name: 'Text', exact: true }).click();
        await expect(viewer).toHaveCount(0);
      }
      await frame.locator('body').evaluate(async () => {
        window.paperLocateGate.release();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      expect(await frame.locator('body').evaluate(() => window.paperLocateGate.delivered)).toBe(true);
      if (action === 'page') {
        await expect(pageInput).toHaveValue(chosenPage);
        await expect(viewer.locator('[data-citation-region="true"]')).toHaveCount(0);
      } else {
        await expect(viewer).toHaveCount(0);
        await expect(frame.locator('.pa-source-text')).toBeVisible();
        await frame.locator('.pa-pdf-reading').getByRole('button', { name: 'PDF', exact: true }).click();
        await expect(viewer).toBeVisible();
      }
      await page.screenshot({ path: resolve(out, `local-search-deferred-${action}.png`) });
    } finally {
      await frame.locator('body').evaluate(() => { window.paperLocateGate.restore(); delete window.paperLocateGate; });
    }
  }
  // Cancelling stale work must not disable the next explicit search reveal.
  await nav.getByRole('button', { name: 'Back to library', exact: true }).click();
  await hit.getByRole('button').click();
  await expect(viewer.locator(`[data-page-number="${targetPage}"] [data-citation-region="true"]`).first()).toBeVisible();

}
