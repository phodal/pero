import { expect } from '@playwright/test';
export async function focusWorkbenchComposer(page) {
  const setup = page.getByRole('region', { name: 'App environment', exact: true });
  if (await setup.isVisible()) await setup.getByRole('button', { name: 'Hide', exact: true }).click();
  // Workbench paints Chat in the root canvas. Attachments and preview dialogs
  // move the input, and GPUI focus alone does not prove browser keyboard focus.
  let bounds;
  await expect.poll(async () => {
    bounds = await page.evaluate(async () => {
      const read = () => {
        const input = JSON.parse(window.peroDiagnostics.snapshot()).composerBounds?.input;
        const canvas = document.querySelector('canvas:not([role="textbox"])');
        if (!input || input.width <= 0 || input.height <= 0) return null;
        return document.elementFromPoint(input.x + input.width / 2, input.y + input.height / 2) === canvas ? input : null;
      };
      const before = read();
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      const after = read();
      return before && after && ['x', 'y', 'width', 'height'].every(key => before[key] === after[key]) ? after : null;
    });
    return !!bounds;
  }, { message: 'Workbench composer has stable painted input bounds and an unobstructed canvas hit target' }).toBe(true);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement;
    return JSON.parse(window.peroDiagnostics.snapshot()).composerFocused && document.hasFocus() && active?.hasAttribute('data-gpui-input');
  }), { message: 'Workbench composer and its browser input conduit own keyboard focus' }).toBe(true);
}
