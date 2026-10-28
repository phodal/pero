// Real Electron/Host/PostgreSQL/Git. GitHub and ACP provider are explicit seams.
import { _electron as electron, chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const realAgent = process.env.PERO_CONTRIBUTION_REAL_AGENT === '1';
if (!process.env.PERO_TEST_DATABASE_URL) throw new Error('Set PERO_TEST_DATABASE_URL to an isolated PostgreSQL database');
const scratch = mkdtempSync(join(tmpdir(), 'pero-contribution-'));
const output = resolve(root, realAgent ? 'test-results/contribution-real' : 'test-results/contribution');
rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true });
const metadata = join(scratch, 'fixture.json');
const githubState = join(scratch, 'github');
writeFileSync(githubState + '.unauthenticated', 'not signed in');
const bare = join(scratch, 'upstream.git'), fork = join(scratch, 'fork.git');
const seed = join(scratch, 'seed'), parent = join(scratch, 'workspaces'), bin = join(scratch, 'bin');
for (const path of [seed, parent, bin]) mkdirSync(path);
const gitConfig = join(scratch, 'gitconfig');
writeFileSync(gitConfig, '[user]\n name = Contributor Fixture\n email = contributor@example.invalid\n[commit]\n gpgsign = false\n');
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' };
const git = (args, cwd = scratch) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(['init', '-b', 'main'], seed);
writeFileSync(join(seed, 'README.md'), '# Contributor fixture repository\n');
git(['add', '.'], seed); git(['commit', '-m', 'test: initial repository'], seed);
git(['clone', '--bare', seed, bare]); git(['init', '--bare', fork]);
git(['config', '--file', gitConfig, `url.${bare}.insteadOf`, 'https://github.com/acme/repo.git']);
symlinkSync(resolve(root, 'tests/fixtures/github-cli.mjs'), join(bin, 'gh'));
const agents = join(scratch, 'agents.json');
writeFileSync(agents, JSON.stringify([{ id: 'fixture', name: 'Contribution ACP fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs')] }]));
const child = spawn('go', ['test', '-count=1', '-run', '^TestContributorDesktopFixture$', './internal/community'], {
  cwd: resolve(root, 'server'), env: { ...process.env, PERO_CONTRIBUTOR_DESKTOP_FIXTURE: metadata, PERO_REQUIRE_TEST_DATABASE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = ''; child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x);
const finished = new Promise(done => child.on('exit', done));
let app, browser, ui;
const errors = [];
const state = async () => ui.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : {});
const command = value => ui.evaluate(value => window.pero.remoteCommand(value), value);
async function capture(name) { await ui.screenshot({ path: resolve(output, `${name}.png`) }); }
try {
  const deadline = Date.now() + 30_000;
  while (!existsSync(metadata)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(logs || 'Contributor fixture startup failed');
    await new Promise(done => setTimeout(done, 100));
  }
  const { url, task, private_task } = JSON.parse(readFileSync(metadata, 'utf8'));
  const packaged = process.env.PERO_PACKAGED_EXECUTABLE;
  const env = { ...gitEnv, PATH: `${bin}:${process.env.PATH}`, PERO_DESKTOP_DATA_DIR: join(scratch, 'profile'), PERO_SETTINGS_PATH: join(scratch, 'settings.json'),
    PERO_HISTORY_PATH: join(scratch, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_CLOUD_URL: url, PERO_LOCALE: 'en',
    CONTRIBUTION_FIXTURE_STATE: githubState, CONTRIBUTION_FIXTURE_FORK: fork };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PERO_OPERATOR_TOKEN', 'PERO_CLIENT_TOKEN']) delete env[key];
  app = await electron.launch({ ...(packaged ? { executablePath: packaged } : {}), args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), ...(packaged ? [] : [resolve(root, 'desktop')])], cwd: scratch, env });
  ui = await app.firstWindow(); ui.on('pageerror', error => errors.push(error.message));
  await expect.poll(async () => (await state()).ready, { timeout: 60_000 }).toBe(true);
  await app.evaluate(({ shell, dialog }, parent) => {
    globalThis.contributionLoginURL = '';
    shell.openExternal = async value => { globalThis.contributionLoginURL = value; };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parent] });
  }, parent);
  await command({ action: 'remote_login', url });
  const loginURL = await app.evaluate(() => globalThis.contributionLoginURL);
  browser = await chromium.launch({ headless: true, ...(process.env.PERO_CHROMIUM_PATH ? { executablePath: process.env.PERO_CHROMIUM_PATH } : {}) });
  const consent = await browser.newPage(); await consent.goto(loginURL);
  await expect(consent.getByRole('heading', { name: '连接 Pero Desktop' })).toBeVisible();
  await consent.getByRole('button', { name: '连接 Desktop', exact: true }).click();
  const callback = await consent.getByRole('link', { name: '打开 Pero Desktop', exact: true }).getAttribute('href');
  await app.evaluate(({ app }, link) => app.emit('open-url', { preventDefault() {} }, link), callback);
  await expect.poll(async () => (await state()).remote.state.identity?.name).toBe('alice');
  expect((await state()).remote.state.identity.projects).toEqual([]);
  await command({ action: 'remote_contribution_refresh' });
  await expect.poll(async () => (await state()).contribution.contributions.length).toBe(1);
  expect((await state()).contribution.contributions[0].task_id).toBe(task);
  expect(JSON.stringify(await state())).not.toContain(private_task);
  expect(JSON.stringify(await state())).not.toContain('PRIVATE_PROMPT_SENTINEL');
  await capture('01-public-tasks');
  // These coordinates target the inspected GPUI canvas, which has no DOM controls.
  await ui.mouse.click(330, 120);
  await expect.poll(async () => (await state()).contribution.selected_task_id).toBe(task);
  await ui.mouse.click(560, 240);
  await expect.poll(async () => (await state()).contribution.detail.state).toBe('claimed');
  expect((await state()).contribution.detail.state).toBe('claimed');
  await capture('02-claimed');
  await ui.mouse.click(realAgent ? 560 : 960, 316);
  await expect.poll(async () => (await state()).remote.agent).toBe(realAgent ? 'codex' : 'fixture');
  await ui.mouse.click(590, 240);
  await expect.poll(async () => (await state()).contribution.local?.session_state, { timeout: realAgent ? 120_000 : 30_000 }).toBe('idle');
  let snapshot = await state();
  expect(snapshot.contribution.error).toBe(null);
  const workspace = snapshot.contribution.local.workspace;
  expect(workspace.startsWith(realpathSync(parent) + '/')).toBe(true);
  const authored = readFileSync(join(workspace, 'CONTRIBUTOR.md'), 'utf8');
  expect(authored.trim().length).toBeGreaterThan(0);
  if (!realAgent) expect(authored).toContain('# Contributor workflow');
  expect(git(['branch', '--show-current'], workspace)).toBe(`codex/pero-${task}`);
  expect(git(['status', '--porcelain'], seed)).toBe('');
  await capture('03-agent-edited');
  expect(snapshot.contribution.local.gh_available).toBe(true);
  expect(snapshot.contribution.local.gh_authenticated).toBe(false);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
  await expect.poll(async () => (await state()).navigation).toBe(3);
  await capture('03-gh-login-before-review');
  await command({ action: 'remote_contribution_gh_help', task_id: task });
  expect(await app.evaluate(() => globalThis.contributionLoginURL)).toBe('https://cli.github.com/');
  writeFileSync(githubState + '.missing', 'not installed');
  await command({ action: 'remote_contribution_review', task_id: task });
  expect((await state()).contribution.local.gh_available).toBe(false);
  await capture('03-gh-install');
  rmSync(githubState + '.missing');
  await command({ action: 'remote_contribution_review', task_id: task });
  expect((await state()).contribution.local.gh_authenticated).toBe(false);
  await capture('03-gh-login');
  rmSync(githubState + '.unauthenticated');
  await command({ action: 'remote_contribution_review', task_id: task });
  snapshot = await state();
  expect(snapshot.contribution.local.diff).toContain('CONTRIBUTOR.md');
  expect(snapshot.contribution.local.changed_files).toContain('CONTRIBUTOR.md');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
  await expect.poll(async () => (await state()).navigation).toBe(3);
  await capture('04-review');
  // Review is a concrete candidate: changing it requires a second explicit review.
  writeFileSync(join(workspace, 'CONTRIBUTOR.md'), '# Contributor workflow\n\nReviewed revision two.\n');
  await command({ action: 'remote_contribution_publish', task_id: task });
  expect((await state()).contribution.error).toContain('Files changed after review');
  expect(existsSync(githubState + '.pr')).toBe(false);
  await capture('05-review-changed');
  await command({ action: 'remote_contribution_review', task_id: task });
  await command({ action: 'remote_contribution_publish', task_id: task });
  snapshot = await state();
  expect(snapshot.contribution.error).not.toBe(null);
  expect(snapshot.contribution.local.pr_url).toBe('https://github.com/acme/repo/pull/17');
  expect(snapshot.contribution.detail.state).toBe('claimed');
  await capture('06-registration-recovery');
  await command({ action: 'remote_contribution_submit', task_id: task });
  snapshot = await state();
  expect(snapshot.contribution.error).toBe(null);
  expect(snapshot.contribution.detail.state).toBe('submitted');
  const evidence = snapshot.contribution.detail.pull_request;
  expect(evidence.url).toBe('https://github.com/acme/repo/pull/17');
  expect(evidence.head_sha).toBe(git(['rev-parse', 'HEAD'], workspace));
  expect(git(['rev-parse', `refs/heads/codex/pero-${task}`], fork)).toBe(evidence.head_sha);
  expect(git(['show', `${evidence.head_sha}:CONTRIBUTOR.md`], fork)).toContain('Reviewed revision two.');
  expect(git(['status', '--porcelain'], workspace)).toBe('');
  await capture('07-pr-registered');
  await command({ action: 'remote_contribution_submit', task_id: task });
  expect((await state()).contribution.error).toBe(null);
  const calls = readFileSync(githubState + '.calls', 'utf8').trim().split('\n').map(JSON.parse);
  expect(calls.filter(args => args[0] === 'pr' && args[1] === 'create').length).toBe(1);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click());
  await expect.poll(async () => (await state()).locale).toBe('zh-CN');
  await ui.mouse.click(64, await ui.evaluate(() => innerHeight - 30));
  await expect.poll(async () => (await state()).dark).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await capture('08-dark-narrow');
  expect(errors).toEqual([]);
  writeFileSync(resolve(output, 'result.json'), JSON.stringify({ result: 'passed', mode: packaged ? 'packaged' : 'development',
    provider: realAgent ? 'Authenticated Codex ACP with actual tools' : 'ACP file-writing fixture', github: 'CLI fixture with real local Git push', projects: [],
    cases: ['new GitHub identity', 'public discovery', 'private goal excluded', 'canvas claim and start controls', 'dedicated clone and branch without prior checkout', 'gh setup before review', 'gh installation and login recovery', 'official gh help link', 'actual ACP file write', 'actual diff', 'stale review rejected', 'real Git commit and push', 'registration error recovery', 'draft PR evidence registered', 'idempotent registration', 'Chinese dark narrow layout'],
    evidence, errors }, null, 2));
  console.log('Contributor flow acceptance passed: new identity → public task → local ACP edit → Git diff → pushed commit → registered draft PR fixture');
} catch (error) {
  if (ui) { await capture('failure'); console.error(JSON.stringify(await state()).slice(0, 18000)); }
  throw error;
} finally {
  if (app) await app.close(); if (browser) await browser.close();
  writeFileSync(metadata + '.stop', 'stop');
  const code = await finished;
  if (process.env.PERO_KEEP_CONTRIBUTION_FIXTURE !== '1') rmSync(scratch, { recursive: true, force: true });
  if (code !== 0) throw new Error(`Contributor server fixture failed: ${logs}`);
}
