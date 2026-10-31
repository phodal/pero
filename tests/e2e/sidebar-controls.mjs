// Shared gestures for visible sidebar controls; no internal navigation actions.
import { expect } from '@playwright/test';
const state = page => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
export async function clickNewChat(page) {
  // Expanded GPUI sidebar is canvas-painted (no DOM button/bounds probe).
  // components/sidebar.rs + pero-theme/design_tokens.rs place Insights first,
  // then New chat: 8px inset + one 32px row + 4px gap + half a row.
  await page.mouse.click(100, 8 + (32 + 4) + 32 / 2);
}
export async function openSettings(page) {
  await page.waitForFunction(() => {
    const canvas=document.querySelector('canvas');
    return canvas?.width===Math.round(innerWidth*devicePixelRatio) && canvas.height===Math.round(innerHeight*devicePixelRatio);
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.mouse.click(100, await page.evaluate(() => innerHeight - 26));
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
