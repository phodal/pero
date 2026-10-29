// Debug GPUI preview. Closing the window ends this process.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { cargoArgs, ensureGpuiLock } from '../lib/cargo.mjs';
import { root } from '../lib/paths.mjs';
import { run } from '../lib/run.mjs';

if (process.platform !== 'darwin') throw new Error('This preview is for macOS.');

const host = resolve(root, 'target/debug/pero-host');
const binary = resolve(root, 'target/debug/pero-native');
const sources = resolve(root, 'crates/pero-ui');

let preview = null;
let replacing = false;
let busy = false;
let queued = false;
let opened = false;

function sourceChange(filename) {
  return filename?.endsWith('.rs') || filename?.endsWith('Cargo.toml');
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
    env: { ...process.env, PERO_NATIVE_HOST: host },
  });
  preview = child;
  child.on('exit', (code, signal) => {
    if (replacing || child !== preview) return;
    console.log(`Native preview closed (${code ?? signal}).`);
    process.exit(code === 0 || signal ? 0 : (code ?? 1));
  });
  opened = true;
  console.log('Native preview is open. Watching crates/pero-ui. Close the window to stop.');
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
      await run('cargo', cargoArgs(['+nightly-2026-10-28', 'build', '--locked', '-p', 'pero-ui', '--features', 'native', '--bin', 'pero-native']));
    } catch (error) {
      console.error(error.message);
      if (!opened) process.exit(1);
      continue;
    }
    if (queued) continue;
    await stopPreview();
    openPreview();
  } while (queued);
  busy = false;
  if (queued) await cycle();
}

let timer = null;
watch(sources, { recursive: true }, (_event, filename) => {
  if (!sourceChange(filename)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    cycle().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  }, 300);
});

console.log('Building the debug Host and native preview.');
await ensureGpuiLock();
await run('cargo', cargoArgs(['build', '--locked', '-p', 'pero-host', '-p', 'pero-worker']));
await cycle();
