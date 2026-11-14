// Keep the registry cache immutable; prepare the pinned Native backend under target/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { root } from './paths.mjs';
import { run } from './run.mjs';

const target = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
mkdirSync(target, { recursive: true });
const patch = resolve(root, 'patches/gpui-fast-0.1.13-a11y-prepaint-rollback.patch');
const digest = createHash('sha256').update(readFileSync(patch)).digest('hex');
export const fastBackend = resolve(realpathSync(target), `patched-dependencies/gpui-fast-0.1.13-${digest.slice(0,12)}`);

export async function prepareFastBackend() {
  const stamp = resolve(fastBackend, '.pero-patch');
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === digest) return;
  const name = 'gpui-fast-0.1.13.crate';
  const cache = resolve(process.env.CARGO_HOME || resolve(homedir(), '.cargo'), 'registry/cache');
  const cached = existsSync(cache) && readdirSync(cache)
    .map(directory => resolve(cache, directory, name)).find(path => existsSync(path));
  let archive;
  if (cached) archive = readFileSync(cached);
  else {
    const response = await fetch(`https://static.crates.io/crates/gpui-fast/${name}`);
    if (!response.ok) throw new Error(`Cannot fetch ${name}: ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(archive).digest('hex') !== '7ee67914f779fdcfce4c7f59f6ba8fa68f680bd137648b25a801cd5d9cb1b8ab') {
    throw new Error(`${name} does not match the pinned crates.io checksum`);
  }
  rmSync(fastBackend, { recursive: true, force: true });
  mkdirSync(fastBackend, { recursive: true });
  writeFileSync(resolve(fastBackend, name), archive);
  await run('tar', ['-xzf', name, '--strip-components=1'], { cwd: fastBackend });
  const patchLf = resolve(fastBackend, '.pero-patch.patch');
  writeFileSync(patchLf, readFileSync(patch, 'utf8').replace(/\r/g, ''));
  await run('git', ['apply', '--unsafe-paths', `--directory=${fastBackend}`, patchLf]);
  writeFileSync(stamp, digest);
}
