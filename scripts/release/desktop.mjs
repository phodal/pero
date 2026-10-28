// CI-owned release metadata and packaged smoke. Publication is the workflow's final step.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const taskCenter = 'https://app.openpero.com';
const kitRevision = 'ec89cfc36404667b7947aeb3d40b1c2859d729dd';
const tag = process.env.RELEASE_TAG || '';
const standalone = process.env.RELEASE_PRODUCT === 'virtual-cell';
const platform = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform];
const product = JSON.parse(readFileSync(resolve(root, standalone ? 'products/virtual-cell/product.json' : 'products/pero.json'), 'utf8'));
const asset = `${product.name}-${platform}-${process.arch}`;
if (process.env.GITHUB_ACTIONS !== 'true' || !platform || (standalone && process.platform !== 'darwin')) {
  throw new Error('Release packages require a native GitHub Actions runner; Virtual Cell requires macOS.');
}
if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag)) throw new Error('RELEASE_TAG must identify an existing version tag.');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
if (git('rev-parse', `refs/tags/${tag}^{commit}`) !== revision) throw new Error('The release tag must match the checked out source.');
const packageDir = resolve(root, standalone ? 'target/products/package-com.openpero.virtualcell' : 'target/package');
const app = join(packageDir, process.platform === 'darwin' ? `${product.name}.app` : asset);
const executable = process.platform === 'darwin' ? join(app, 'Contents/MacOS/Pero') : join(app, process.platform === 'win32' ? 'Pero.exe' : 'pero');
const payload = join(app, process.platform === 'darwin' ? 'Contents/Resources/app' : 'resources/app');
const archive = join(packageDir, asset + (process.platform === 'darwin' ? '.dmg' : process.platform === 'win32' ? '.zip' : '.tar.gz'));
const metadataPath = resolve(root, 'desktop/dist/release.json');
const outputDir = resolve(root, 'test-results/release');
mkdirSync(outputDir, { recursive: true });
const operation = process.argv[2];

if (operation === 'prepare') {
  if (!standalone) {
    const actualKit = execFileSync('git', ['-C', process.env.PERO_GPUI_KIT_PATH, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (actualKit !== kitRevision) throw new Error('The release requires the pinned GPUI snapshot.');
  }
  const metadata = {
    schemaVersion: 1, releaseTag: tag, productVersion: product.version, sourceRevision: revision,
    productId: product.id, taskCenter: standalone ? null : taskCenter, platform: process.platform, arch: process.arch, gpuiKitRevision: standalone ? null : kitRevision,
    buildProvider: 'GitHub Actions',
    buildURL: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    signing: process.platform === 'darwin' ? 'ad-hoc' : 'unsigned', notarized: false, bundledAgentCLIs: false,
    ...(standalone ? { python: JSON.parse(readFileSync(resolve(root, 'scripts/release/python.json'), 'utf8')) } : {}),
  };
  mkdirSync(resolve(root, 'desktop/dist'), { recursive: true });
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
} else if (operation === 'verify') {
  const metadata = JSON.parse(readFileSync(join(payload, 'desktop/dist/release.json'), 'utf8'));
  if (metadata.sourceRevision !== revision || metadata.releaseTag !== tag || metadata.taskCenter !== (standalone ? null : taskCenter) || metadata.productId !== product.id || metadata.platform !== process.platform || metadata.arch !== process.arch || metadata.buildProvider !== 'GitHub Actions') {
    throw new Error('Packaged release metadata does not match this workflow.');
  }
  const main = readFileSync(join(payload, `desktop/dist/${standalone ? 'product' : 'main'}.cjs`), 'utf8');
  if ((!standalone && !main.includes(taskCenter)) || main.includes('tests/fixtures') || main.includes('contribution-fixture')) {
    throw new Error('The packaged Desktop must use the online service and exclude fixture code.');
  }
  for (const name of ['tests', 'test-results', '.git', '.env', '.env.local', '.codex', '.claude', 'agents.local.json']) {
    if (existsSync(join(payload, name))) throw new Error(`Unexpected private or test input in package: ${name}`);
  }
  if (process.platform === 'darwin') {
    for (const executable of ['Contents/MacOS/Pero', 'Contents/Resources/app/bin/pero-host']) {
      const arch = execFileSync('/usr/bin/lipo', ['-archs', join(app, executable)], { encoding: 'utf8' }).trim();
      if (arch !== process.arch) throw new Error(`Unexpected packaged architecture: ${arch}`);
    }
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  }
  if (!existsSync(archive)) throw new Error('Missing native release archive.');
  if (process.platform === 'darwin' && !standalone) {
    const size = JSON.parse(readFileSync(join(packageDir, 'size.json'), 'utf8'));
    if (size.dmgBytes >= 100_000_000) throw new Error('Pero DMG exceeds its 100 MB budget.');
  }
  const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  const releaseMetadata = { ...metadata, archive: basename(archive), archiveSha256: sha256(archive) };
  const releasedMetadata = join(packageDir, `${asset}.build.json`);
  writeFileSync(releasedMetadata, JSON.stringify(releaseMetadata, null, 2) + '\n');
  writeFileSync(join(packageDir, `${asset}.SHA256SUMS`), [archive, releasedMetadata].map(path => `${sha256(path)}  ${basename(path)}\n`).join(''));
} else if (operation === 'smoke') {
  if (standalone) throw new Error('Use test:product:e2e for the standalone product.');
  const { _electron: electron, expect } = await import('@playwright/test');
  const scratch = mkdtempSync(join(tmpdir(), 'pero-release-'));
  const env = { ...process.env, PERO_DESKTOP_DATA_DIR: join(scratch, 'profile'), PERO_SETTINGS_PATH: join(scratch, 'settings.json'), PERO_HISTORY_PATH: join(scratch, 'history'), PERO_LOCALE: 'en' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PERO_CLOUD_URL', 'PERO_OPERATOR_TOKEN', 'PERO_CLIENT_TOKEN', 'PERO_AGENTS_FILE', 'PERO_AGENT_ROOT', 'PERO_HOST_PATH', 'GH_TOKEN', 'GITHUB_TOKEN', 'PERO_ADAPTER_NODE']) delete env[key];
  for (const adapter of ['codex-acp', 'claude-agent-acp']) {
    const version = execFileSync(executable, [join(payload, 'adapters', `${adapter}.mjs`), '--version'], {
      cwd: scratch, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000,
    }).trim();
    if (!version) throw new Error(`Packaged adapter failed to start: ${adapter}`);
  }
  let desktop;
  let page;
  try {
    desktop = await electron.launch({ executablePath: executable, args: ['--use-mock-keychain', ...(process.platform === 'linux' ? ['--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'] : [])], cwd: scratch, env });
    page = await desktop.firstWindow();
    page.on('console', message => appendFileSync(join(outputDir, 'browser.log'), `${message.type()}: ${message.text()}\n`));
    const errors = []; page.on('pageerror', error => { errors.push(error.message); appendFileSync(join(outputDir, 'browser.log'), `pageerror: ${error.message}\n`); });
    await page.waitForFunction(() => window.peroDiagnostics, undefined, { timeout: 60_000 });
    const snapshot = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
    await expect.poll(async () => (await snapshot()).ready, { timeout: 60_000 }).toBe(true);
    await expect.poll(async () => (await snapshot()).connected, { timeout: 60_000 }).toBe(true);
    const state = await snapshot();
    expect(state.remote.state.connection.url).toBe(taskCenter);
    expect(state.remote.state.configured).toBe(false);
    // The packaged Host must be executable outside the source checkout.
    expect(state.connected).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: join(outputDir, 'packaged-start.png') });
    writeFileSync(join(outputDir, 'smoke.json'), JSON.stringify({ result: 'passed', releaseTag: tag, sourceRevision: revision, taskCenter: state.remote.state.connection.url, hostReady: state.connected, errors }, null, 2) + '\n');
  } finally {
    if (page) {
      await page.screenshot({ path: join(outputDir, 'packaged-final.png') });
      writeFileSync(join(outputDir, 'renderer.html'), await page.content());
    }
    if (desktop) await desktop.close();
    rmSync(scratch, { recursive: true, force: true });
  }
} else if (operation === 'stage') {
  const assets = resolve(root, 'target/release-assets');
  mkdirSync(assets, { recursive: true });
  for (const file of [archive, join(packageDir, `${asset}.build.json`), join(packageDir, `${asset}.SHA256SUMS`)]) {
    cpSync(file, join(assets, basename(file)));
  }
} else {
  throw new Error('Use prepare, verify, smoke or stage.');
}
