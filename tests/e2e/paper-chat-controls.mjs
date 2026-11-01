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
// Read the actual painted control twice; draft attachments can change Chat height
// after appChatOpen becomes true. Never reconstruct its layout from draft text.
export async function paintedPaperChatCloseTarget() {
  const read = () => {
    const state = window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot());
    const canvas = document.querySelector('canvas'), bounds = state?.chatCloseButtonBounds;
    if (!state?.appChatOpen || !state.floatingChat || document.getElementById('loading') || !canvas
        || canvas.width !== Math.round(innerWidth * devicePixelRatio) || canvas.height !== Math.round(innerHeight * devicePixelRatio)
        || !bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
        || bounds.width <= 0 || bounds.height <= 0) return null;
    return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === canvas ? bounds : null;
  };
  const before = read();
  if (!before) return false;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const after = read();
  return after && ['x', 'y', 'width', 'height'].every(key => before[key] === after[key]) ? after : false;
}

export async function closePaperChat(page) {
  const state = await chatState(page);
  if (!state.appChatOpen) return;
  expect(state.floatingChat).toBe(true);
  const setup = page.getByRole('region', { name: 'App environment', exact: true });
  if (await setup.isVisible()) await setup.getByRole('button', { name: 'Hide', exact: true }).click();
  let bounds;
  await expect.poll(async () => {
    bounds = await page.evaluate(paintedPaperChatCloseTarget);
    return !!bounds;
  }, { timeout: 5000, message: 'Paper Chat close has a stable painted Host hit target' }).toBe(true);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect.poll(async () => (await chatState(page)).appChatOpen).toBe(false);
  await expect.poll(async () => (await chatState(page)).chatCloseButtonBounds).toBeNull();
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
