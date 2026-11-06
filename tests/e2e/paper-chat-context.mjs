// Production Paper UI + SDK in Chromium; persisted records and Chat are fixtures.
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { installResearchChatFixture } from '../fixtures/research-import.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/paper-chat-context');
await mkdir(out, { recursive: true });
const paper = (id, title) => ({ id: id.repeat(64), title, source: 'openalex', sourceId: id,
  url: `https://example.invalid/${id}`, authors: [], contentKind: 'abstract', contentDigest: id.repeat(64),
  fetchedAt: '2026-11-04T00:00:00Z', content: 'Synthetic abstract; no research acceptance.' });
const papers = [paper('a', 'Harness as an Asset: Enforcing Determinism via the Convergent AI Agent Framework (CAAF)'), paper('b', '另一篇论文')];
let savedPdf = false;
const browser = await chromium.launch({ headless: true,
  ...(process.env.PERO_CHROMIUM_PATH ? { executablePath: process.env.PERO_CHROMIUM_PATH } : {}) });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(installResearchChatFixture);
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    requests.push({ path, method: request.method() });
    let value;
    if (path === '/host/sdk') value = { name: 'paper-agent', permissions: { api: ['/api'], events: ['chat:closed'], host: [] } };
    else if (path === '/api/library') value = { papers, intents: [], reports: [] };
    else if (path.startsWith('/api/papers/')) value = papers.find(paper => path.endsWith(paper.id));
    else if (path === '/api/pdf') value = { document: savedPdf && url.searchParams.get('paperId') === papers[0].id
      ? { id: 'd'.repeat(64), paperId: papers[0].id, pages: [] } : null, annotations: [] };
    else if (path === '/api/paper-documents') value = { revisions: [], sources: [] };
    else if (path.startsWith('/api/')) throw Error(`Unexpected fixture request: ${path}`);
    if (value) return route.fulfill({ json: value });
    const asset = path === '/' ? '/index.html' : path;
    await route.fulfill({ body: await readFile(resolve(root, `apps/paper-agent/dist${asset}`)),
      contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(asset)] || 'application/octet-stream' });
  });
  await page.goto('http://localhost/');
  const read = title => page.locator('.pa-paper-main .pero-list-open').filter({ hasText: title }).dblclick();
  const ask = async () => {
    const count = await page.evaluate(() => window.researchChatFixture.snapshots.length);
    await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.researchChatFixture.snapshots.length)).toBe(count + 1);
    return page.evaluate(() => ({ snapshot: window.researchChatFixture.snapshots.at(-1),
      selection: window.researchChatFixture.requests.at(-1).options.attachments[0].selection }));
  };
  await read(papers[0].title);
  await expect(page.getByRole('radio', { name: 'PDF', exact: true })).toBeDisabled();
  // Change persisted content while the reader retains its opening snapshot.
  savedPdf = true;
  papers[0] = { ...papers[0], contentKind: 'full-text', contentDigest: 'c'.repeat(64), content: 'Newly saved full text.', pdfUrl: 'https://example.invalid/a.pdf' };
  await page.getByRole('button', { name: 'Ask AI', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Ask AI');
  await expect(page.locator('.pa-ask')).toHaveText('');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.screenshot({ path: resolve(out, 'ask-light-focus.png') });
  let context = await ask();
  expect(context.snapshot.label).toBe(papers[0].title);
  expect(context.snapshot.state).toMatchObject({ readingId: papers[0].id, title: papers[0].title,
    contentDigest: papers[0].contentDigest, sourceExcerpt: papers[0].content,
    sources: [{ id: papers[0].id, contentKind: 'full-text', hasPdf: true }] });
  expect(context.selection.paperIds).toEqual([papers[0].id]);
  expect(context.selection.fullText).toBe(true);
  await expect(page.locator('.pa-source-text')).toContainText(papers[0].content);
  await page.screenshot({ path: resolve(out, 'current-paper-light.png') });
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await read(papers[1].title);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'zh-CN', dark: true, active: true } }, '*'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  const askButton = page.locator('.pa-ask');
  await askButton.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(askButton).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveText('询问 AI');
  await page.screenshot({ path: resolve(out, 'ask-dark-narrow-focus.png') });
  await page.locator('.pa-reading-bar').screenshot({ path: resolve(out, 'ask-dark-toolbar.png') });
  await page.screenshot({ path: resolve(out, 'ask-dark-tooltip.png'), clip: { x: 0, y: 0, width: 390, height: 90 } });
  await askButton.press('Enter');
  await expect.poll(() => page.evaluate(() => window.researchChatFixture.snapshots.length)).toBe(2);
  context = await page.evaluate(() => ({ snapshot: window.researchChatFixture.snapshots.at(-1),
    selection: window.researchChatFixture.requests.at(-1).options.attachments[0].selection }));
  expect(context.snapshot.label).toBe(papers[1].title);
  expect(context.snapshot.state.readingId).toBe(papers[1].id);
  expect(context.selection.paperIds).toEqual([papers[1].id]);
  expect(context.snapshot.state.contentDigest).toBe(papers[1].contentDigest);
  expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: resolve(out, 'switched-paper-dark-narrow.png') });
  expect(requests.every(request => request.method === 'GET')).toBe(true);
  expect(errors).toEqual([]);
  console.log('PASS: paper title, refreshed source, paper switch, unsent draft, dark/narrow and keyboard handoff');
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(out, 'failure.png') });
    console.error(await page.locator('body').innerText());
  }
  throw error;
} finally {
  await browser.close();
}
