// Debug GPUI preview. Closing the window ends this process.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, watch } from 'node:fs';
import { resolve } from 'node:path';
import { cargoArgs, ensureGpuiLock } from '../lib/cargo.mjs';
import { writeIcns } from '../lib/macos-icon.mjs';
import { root } from '../lib/paths.mjs';
import { run } from '../lib/run.mjs';
import { buildHarness } from '../build/harness.mjs';

if (process.platform !== 'darwin') throw new Error('This preview is for macOS.');
if (process.argv.slice(2).some(arg => arg !== '--build-only')) throw new Error('Usage: npm run dev:native [-- --build-only]');
const buildOnly = process.argv.includes('--build-only');

const host = resolve(root, 'target/debug/pero-host');
const binary = resolve(root, 'target/debug/pero-native');
const icon = resolve(root, 'target/debug/AppIcon.icns');
const sources = [
  ...['pero-ui', 'pero-chat-ui', 'pero-contracts', 'pero-runtime', 'pero-host', 'pero-worker', 'pero-theme'].map(name => `crates/${name}`),
  'harness/go', 'packages/connectors/src', 'desktop/src/main', 'locales',
];

let preview = null;
let replacing = false;
let busy = false;
let queued = false;
let opened = false;

function sourceChange(filename) {
  return /\.(rs|go|ts|mjs|json|py)$/.test(filename ?? '') || /(^|\/)(Cargo\.toml|go\.mod|go\.sum)$/.test(filename ?? '');
}

function stopPreview() {
  const child = preview;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  replacing = true;
  return new Promise((resolveStop) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveStop();
    });
    child.kill('SIGTERM');
  });
}

function openPreview() {
  replacing = false;
  const child = spawn(binary, [], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PERO_NATIVE_HOST: host, PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_NATIVE_ICON: icon },
  });
  preview = child;
  child.on('exit', (code, signal) => {
    if (replacing || child !== preview) return;
    console.log(`Native preview closed (${code ?? signal}).`);
    process.exit(code === 0 || signal ? 0 : (code ?? 1));
  });
  opened = true;
  console.log('Native preview is open. Watching UI, Host, Harness and connector sources. Close the window to stop.');
}

async function cycle() {
  if (busy) {
    queued = true;
    return;
  }
  busy = true;
  do {
    queued = false;
    try {
      await buildHarness();
      await run(process.execPath, ['scripts/build/connectors.mjs']);
      await run('cargo', cargoArgs(['build', '--locked', '-p', 'pero-host', '-p', 'pero-worker']));
      await run('cargo', cargoArgs(['+nightly-2026-10-28', 'build', '--locked', '-p', 'pero-ui', '--features', 'native', '--bin', 'pero-native']));
    } catch (error) {
      console.error(error.message);
      if (!opened) process.exit(1);
      continue;
    }
    if (queued) continue;
    if (buildOnly) { console.log('Native preview and runtime dependencies built.'); continue; }
    await stopPreview();
    openPreview();
  } while (queued);
  busy = false;
  if (queued) await cycle();
}

let timer = null;
if (!buildOnly) for (const source of sources) watch(resolve(root, source), { recursive: true }, (_event, filename) => {
  if (!sourceChange(filename)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    cycle().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  }, 300);
});

console.log('Building the debug Harness, Host and native preview. Secrets stay in this process; the login keychain is not opened.');
// The installed profile has no checkout harness/ tree. Package the chart core before the Host seeds Data.
const dataCore = resolve(root, 'apps/data/backend/_core');
mkdirSync(dataCore, { recursive: true });
for (const name of ['dataset.py', 'view.py', 'chart_document.py'])
  cpSync(resolve(root, 'harness/go/charts/python', name), resolve(dataCore, name));
writeIcns(resolve(root, 'resources/app-icon.svg'), icon);
await ensureGpuiLock();
await run(process.execPath, ['scripts/build/apps.mjs', '--app', 'connectors']);
await cycle();
