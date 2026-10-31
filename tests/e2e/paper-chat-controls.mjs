import { expect } from '@playwright/test';
export const chatState = page => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
export async function fillPaperChat(page, text) {
  const setup = page.getByRole('region', { name: 'App environment', exact: true });
  if (await setup.isVisible()) await setup.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect.poll(async () => { const s = await chatState(page); return s.appChatOpen && s.composer.includes('@Paper Agent'); }).toBe(true);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.mouse.click(viewport.width - 180, viewport.height - 55);
  const current = (await chatState(page)).composer;
  const referenceStart = current.indexOf('@Paper Agent');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  if (referenceStart >= 0) {
    for (let i = 0; i < referenceStart; i++) await page.keyboard.press('Shift+ArrowRight');
  } else await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(text + (referenceStart >= 0 ? ' ' : ''));
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await chatState(page)).composer).toContain(text);

}
export async function closePaperChat(page) {
  const state = await chatState(page);
  if (!state.appChatOpen) return;
  expect(state.floatingChat).toBe(true);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const rows = Math.min(3, Math.max(1, state.composer.split('\n').length));
  const compact = 100 + (rows - 1) * 22 + Math.min(3, Math.ceil(state.attachments.length / 3)) * 32;
  const height = Math.min(Math.max(viewport.height - 100, 100), state.floatingChatExpanded ? 560 : compact);
  await page.mouse.click(viewport.width - 30, viewport.height - 12 - height + 15);
  await expect.poll(async () => (await chatState(page)).appChatOpen).toBe(false);
}
export async function showPaperReport(frame, page, intentId) {
  await closePaperChat(page);
  const records = frame.getByRole('complementary', { name: 'Research record', exact: true });
  if (!await records.isVisible()) await frame.locator('.pa-reading-bar').getByRole('button', { name: 'Research record', exact: true }).click();
  const turn = frame.locator(`[data-turn-id="${intentId}"]`);
  if (!await turn.getAttribute('open').then(value => value !== null)) await turn.locator(':scope>summary').click();
  await expect(turn.locator('.pa-report')).toBeVisible();
  return turn;
}
