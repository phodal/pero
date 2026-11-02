import { expect } from '@playwright/test';
import { closePaperChat } from './paper-chat-controls.mjs';
import { backToLibrary } from './paper-pdf-flow.mjs';

// Saving opens a bundle, whose header has Back, not Add papers. Use the same
// visible navigation as a user, including when a reader or Host Chat is open.
export async function openResearchImport(page, frame) {
  const setup = page.getByRole('region', { name: 'App environment', exact: true });
  if (await setup.isVisible()) await setup.getByRole('button', { name: 'Hide', exact: true }).click();
  await closePaperChat(page, frame);
  await backToLibrary(frame);
  const library = frame.locator('.pa-library-screen');
  const add = library.getByRole('button', { name: 'Add papers', exact: true });
  await expect(add).toBeVisible();
  await add.click();
  await frame.getByRole('tab', { name: 'Research URL', exact: true }).click();
}

// Build all locators from the current Desktop page, including after a restart.
// Return the current review only after the real inspection has rendered it.
export async function inspectResearchReview(frame, url) {
  const input = frame.getByRole('textbox', { name: 'Research URL', exact: true });
  await input.fill(url);
  await input.press('Enter');
  const review = frame.getByRole('region', { name: 'Review resources' });
  await review.waitFor({ state: 'visible', timeout: 65000 });
  return review;
}

// Structural diagnostics only: never serialize source text, image bytes, URLs,
// workspace paths, chat content or the full Host diagnostic snapshot.
export async function researchUiState(page, frame) {
  const host = await page.evaluate(() => {
    const state = JSON.parse(window.peroDiagnostics?.snapshot() ?? '{}');
    const iframe = document.querySelector('iframe[title="paper-agent"]');
    const rect = iframe?.getBoundingClientRect();
    return { viewport: { width: innerWidth, height: innerHeight },
      activePaper: state.activeApp?.name === 'paper-agent', appChatOpen: !!state.appChatOpen,
      iframe: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null };
  });
  const view = await frame.locator('body').evaluate(body => {
    const visible = selector => [...body.querySelectorAll(selector)].some(element => element.getClientRects().length > 0);
    return { screen: body.querySelector('.pa-workbench')?.getAttribute('data-screen'),
      library: visible('.pa-library-screen'), bundle: visible('.pa-research-bundle'),
      import: visible('[role="tablist"]'), reader: visible('.pa-reading-screen'),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
  });
  return { host, view };
}

// SDK Select is an accessible button/listbox, not a native select. Use the
// painted option and verify the exact stored value after the user interaction.
export async function selectPaperOption(frame, label, option, value) {
  const trigger = frame.getByRole('button', { name: label, exact: true });
  await trigger.click();
  await frame.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: option, exact: true }).click();
  await expect(trigger).toHaveAttribute('data-value', value);
}
