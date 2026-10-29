import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { root } from './paths.mjs';
import { run } from './run.mjs';
import { prepareWebBackend, webBackend } from './gpui-web.mjs';

export const kit = resolve(process.env.PERO_GPUI_KIT_PATH || resolve(root, '../../test/gpui-kit'));

const patchedCrates = ['gpui-kit', 'gpui-base', 'gpui-component', 'gpui-component-macros', 'gpui-kit-assets', 'gpui-pre-web'];

export function cargoArgs(args) {
  if (!existsSync(resolve(kit, 'crates/kit/Cargo.toml'))) {
    throw new Error('Set PERO_GPUI_KIT_PATH to your gpui-kit checkout (see desktop/README.md).');
  }
  const crates = { 'gpui-kit': 'kit', 'gpui-base': 'base', 'gpui-component': 'component',
    'gpui-component-macros': 'component-macros', 'gpui-kit-assets': 'assets' };
  const toolchain = args[0]?.startsWith('+') ? [args.shift()] : [];
  return [...toolchain, ...Object.entries(crates).flatMap(([name, path]) => [
    '--config', `patch.crates-io.${name}.path=${JSON.stringify(resolve(kit, 'crates', path))}`,
  ]), '--config', `patch.crates-io.gpui-pre-web.path=${JSON.stringify(webBackend)}`, ...args];
}

function lockUsesRegistryGpui() {
  const lock = readFileSync(resolve(root, 'Cargo.lock'), 'utf8');
  return patchedCrates.some((name) => {
    const at = lock.indexOf(`name = "${name}"`);
    if (at < 0) return true;
    return lock.slice(at, at + 240).includes('source = "registry+');
  });
}

// The committed lock records crates.io GPUI. Path patches change that resolution,
// and a --locked build refuses to rewrite the lock. Resolve once, and restore the
// committed lock if resolution stops halfway (Cargo writes before downloads finish).
export async function ensureGpuiLock() {
  await prepareWebBackend();
  if (!lockUsesRegistryGpui()) return;
  const lock = resolve(root, 'Cargo.lock');
  const backup = resolve(tmpdir(), `pero-Cargo.lock.${process.pid}`);
  copyFileSync(lock, backup);
  try {
    await run('cargo', cargoArgs(['metadata', '--format-version', '1']), {
      stdio: ['inherit', 'ignore', 'inherit'],
    });
  } catch (error) {
    copyFileSync(backup, lock);
    throw error;
  } finally {
    rmSync(backup, { force: true });
  }
}
