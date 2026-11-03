import { expect } from '@playwright/test';
import { resolve } from 'node:path';

function deferImportResponse(_element, path) {
  const original = window.paperNativeFetch;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const gate = window.paperImportGate = { arrived: false, error: '', release };
  // Hold delivery of a real saved response, not persistence or a timer-based mock.
  window.paperFetchObserver = async (...args) => {
    const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, window.location.href);
    const response = await original.apply(window, args);
    if (url.pathname !== path) return response;
    try {
      if (!response.ok) throw Error(`Import response failed: ${response.status}`);
      await response.clone().arrayBuffer();
      gate.arrived = true;
      await held;
      return response;
    } catch (error) { gate.error = String(error); throw error; }
  };
}

export async function exerciseTextImportNavigation({ frame, page, out }) {
  const form = frame.getByRole('group', { name: 'Import text', exact: true, includeHidden: true });
  const reader = frame.locator('.pa-reading-screen');
  const library = frame.locator('.pa-library-screen');
  const readLibrary = () => frame.locator('body').evaluate(async () => {
    const response = await fetch('/api/library');
    if (!response.ok) throw Error(`Library read failed: ${response.status}`);
    return response.json();
  });
  async function fill(name, content) {
    await frame.getByRole('tab', { name: 'Import text', exact: true }).click();
    await form.getByLabel('Paper title', { exact: true }).fill(name);
    await form.getByLabel('Original URL (HTTPS)', { exact: true }).fill(`https://example.org/${name.toLowerCase().replaceAll(' ', '-')}`);
    await form.getByLabel('Source text or abstract', { exact: true }).fill(content);
  }
  async function saveAndRead(name, content) {
    await form.getByRole('button', { name: 'Save source snapshot', exact: true }).click();
    await expect(reader.getByRole('heading', { name, exact: true })).toBeVisible();
    const paper = (await readLibrary()).papers.find(paper => paper.title === name);
    expect(paper).toBeDefined();
    await expect(reader.locator('[data-paper-id]')).toHaveAttribute('data-paper-id', paper.id);
    await expect(reader.locator('.pa-source-text')).toContainText(content);
    await expect(library).toBeHidden();
  }

  await frame.getByRole('button', { name: 'Add papers', exact: true }).click();
  await fill('Text import seed', 'importpreviewseed is the original saved text.');
  await saveAndRead('Text import seed', 'importpreviewseed is the original saved text.');
  await reader.getByRole('button', { name: 'Back to library', exact: true }).click();
  const search = frame.getByRole('searchbox', { name: 'Search saved text', exact: true });
  await search.fill('importpreviewseed');
  await search.press('Enter');
  await frame.locator('[data-search-hit]').getByRole('button', { name: 'Text import seed', exact: true }).click();
  await expect(frame.locator('[data-hit-preview="true"]')).toBeVisible();
  await frame.getByRole('button', { name: 'Add papers', exact: true }).click();
  await expect(reader).toBeHidden();
  await expect(frame.locator('[data-hit-preview="true"]')).toHaveCount(0);
  await fill('Text import from preview', 'The new original must open after saving from search preview.');
  await page.screenshot({ path: resolve(out, 'search-preview-import-active.png') });
  await saveAndRead('Text import from preview', 'The new original must open after saving from search preview.');
  await page.screenshot({ path: resolve(out, 'search-preview-import-opened.png') });
  await reader.getByRole('button', { name: 'Back to library', exact: true }).click();

  // Leaving during either persistence delivery or the parent's library refresh
  // must keep the user's navigation while still retaining the saved document.
  for (const [phase, path] of [['save', '/api/papers/import'], ['refresh', '/api/library']]) {
    await frame.getByRole('button', { name: 'Add papers', exact: true }).click();
    const name = `Text import left during ${phase}`;
    await fill(name, `Saving during ${phase} must not take over navigation.`);
    await frame.locator('body').evaluate(deferImportResponse, path);
    try {
      await form.getByRole('button', { name: 'Save source snapshot', exact: true }).click();
      await expect.poll(() => frame.locator('body').evaluate(() => {
        if (window.paperImportGate.error) throw Error(window.paperImportGate.error);
        return window.paperImportGate.arrived;
      })).toBe(true);
      await library.getByRole('button', { name: 'Back to library', exact: true }).click();
      await frame.locator('body').evaluate(() => window.paperImportGate.release());
      await expect(form.getByRole('button', { name: 'Save source snapshot', exact: true, includeHidden: true })).toBeEnabled();
      await expect(reader).toBeHidden();
      await expect(library.getByRole('button', { name: 'Add papers', exact: true })).toBeVisible();
      expect((await readLibrary()).papers.filter(paper => paper.title === name)).toHaveLength(1);
    } finally {
      await frame.locator('body').evaluate(() => {
        window.paperImportGate.release(); delete window.paperImportGate; delete window.paperFetchObserver;
      });
    }
  }
  await search.fill('');
}
