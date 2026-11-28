import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';

const root = resolve(import.meta.dirname, '../..');
const origin = process.env.PERO_CAMPAIGN_ORIGIN;
const reviewer = process.env.PERO_CAMPAIGN_REVIEWER;
const project = process.env.PERO_CAMPAIGN_PROJECT;
const campaign = process.env.PERO_CAMPAIGN_ID;
const output = process.env.PERO_CAMPAIGN_OUTPUT;
assert(origin && reviewer && project && campaign && output, 'Run this driver through the PyBaMM acceptance fixture');
const profile = await mkdtemp(join(output, 'desktop-profile-'));
let app;
let page;
const snapshot = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const campaignState = async () => (await snapshot()).projectCampaign;

async function click(key) {
  let bounds;
  await expect.poll(async () => {
    bounds = (await snapshot()).projectControls[key];
    return bounds?.width ?? 0;
  }, { timeout: 30000, message: `Project control ${key}` }).toBeGreaterThan(0);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

async function openCampaign() {
  app = await electron.launch({
    args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')],
    cwd: root,
    env: { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_SETTINGS_PATH: join(profile, 'settings.json'),
      PERO_HISTORY_PATH: join(profile, 'history.jsonl'), PERO_CLOUD_URL: origin,
      PERO_CLIENT_TOKEN: reviewer, PERO_LOCALE: process.env.PERO_CAMPAIGN_LOCALE || 'en' },
  });
  page = await app.firstWindow();
  page.on('pageerror', error => console.error(error.message));
  page.on('console', message => {
    if (message.type() === 'error') console.error(message.text());
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 980));
  await page.waitForFunction(() => window.peroDiagnostics &&
    (!document.getElementById('loading') || document.querySelector('#loading[role="alert"]')), undefined, { timeout: 90000 });
  assert.equal(await page.locator('#loading').count(), 0, 'Desktop Workbench failed to open');
  await click(`sidebar:open:shared:${project}`);
  await click('tab:campaign.title');
  await expect.poll(async () => (await campaignState())?.detail?.plan?.id, { timeout: 30000 }).toBe(campaign);
}

try {
  await openCampaign();
  await expect.poll(async () => (await campaignState())?.detail?.phase).toBe('awaiting_review');
  const before = (await campaignState()).detail.progress;
  assert.deepEqual(before.trials.map(trial => trial.status), ['succeeded', 'not_started']);
  assert.equal(before.evidence[0].status, 'consistent');
  await click('campaign:evidence:0');
  await expect.poll(async () => (await campaignState()).expanded[0]).toBe(true);
  await page.screenshot({ path: join(output, '01-campaign-awaiting-review.png'), scale: 'css' });
  await click('campaign:evidence:0');
  await click('campaign:approve');
  await expect.poll(async () => {
    const state = await campaignState();
    return state?.detail?.decision?.choice ?? state?.receipt?.choice;
  }, { timeout: 30000 }).toBe('approve');
  await expect.poll(async () => (await campaignState())?.detail?.result?.outcome,
    { timeout: 85000 }).toBe('execution_completed');
  const completed = (await campaignState()).detail;
  assert.deepEqual(completed.result.trials.map(trial => trial.status), ['succeeded', 'succeeded']);
  assert.deepEqual(completed.result.evidence.map(item => item.status), ['consistent', 'consistent']);
  assert.equal(completed.result.trials[0].run.run_id, before.trials[0].run.run_id);
  assert.notEqual(completed.result.trials[1].run.run_id, before.trials[0].run.run_id);
  assert.equal(completed.decision.gate_id, before.review_gate.id);
  await page.screenshot({ path: join(output, '02-campaign-complete.png'), scale: 'css' });
  await app.close();
  app = undefined;
  await openCampaign();
  await expect.poll(async () => (await campaignState())?.detail?.decision?.request_id)
    .toBe(completed.decision.request_id);
  assert.deepEqual((await campaignState()).detail.result.evidence.map(item => item.digest),
    completed.result.evidence.map(item => item.digest));
  console.log('Desktop approved the reviewed PyBaMM follow-up and reopened the saved receipt.');
} catch (error) {
  await page?.screenshot({ path: join(output, 'desktop-failure.png'), scale: 'css' }).catch(() => {});
  app?.process().kill('SIGTERM');
  app = undefined;
  throw error;
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
