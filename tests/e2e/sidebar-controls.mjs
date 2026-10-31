// Shared gestures for visible sidebar controls; no internal navigation actions.
import { expect } from '@playwright/test';
const state = page => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
// Bounds come from the actual GPUI paint, so title bars and reordered rows do
// not change the pointer target. Callers still assert the resulting UI state.
async function clickBounds(page, select) {
  let bounds;
  await expect.poll(async () => {
    bounds = select(await state(page));
    return !!bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      && bounds.width > 0 && bounds.height > 0;
  }).toBe(true);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}
export async function clickNewChat(page) {
  if (!(await state(page)).newChatButtonBounds) await clickAppShortcut(page, 'sessions');
  await clickBounds(page, snapshot => snapshot.newChatButtonBounds);
}
export async function clickSessionRow(page, sessionId) {
  if (!(await state(page)).sessionRowBounds?.[sessionId]) await clickAppShortcut(page, 'sessions');
  await clickBounds(page, snapshot => snapshot.sessionRowBounds?.[sessionId]);
}
export async function clickAppOpen(page, appName) {
  await clickBounds(page, snapshot => snapshot.appOpenButtonBounds?.[appName]);
}
export async function clickAppShortcut(page, appName) {
  await clickBounds(page, snapshot => snapshot.sidebarButtonBounds?.[appName]);
}
export async function openSettings(page) {
  await page.waitForFunction(() => {
    const canvas=document.querySelector('canvas');
    return canvas?.width===Math.round(innerWidth*devicePixelRatio) && canvas.height===Math.round(innerHeight*devicePixelRatio);
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await clickBounds(page, snapshot => snapshot.settingsButtonBounds);
  await expect.poll(async () => (await state(page)).settingsMenuOpen).toBe(true);
}
export async function setAppearance(page, appearance) {
  await openSettings(page);
  // Start at the last action so account/header labels do not affect navigation.
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  for (let i = 0; i < ['light', 'dark', 'system'].indexOf(appearance); i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).preferences.appearance).toBe(appearance);
}
export async function setSidebarLocale(page, locale) {
  await openSettings(page);
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  if (locale === 'en') await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).locale).toBe(locale);
}
