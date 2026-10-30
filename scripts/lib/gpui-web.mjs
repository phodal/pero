// Keep the registry cache immutable; prepare the pinned Web backend under target/.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { root } from './paths.mjs';
import { run } from './run.mjs';

const target=resolve(root,process.env.CARGO_TARGET_DIR || 'target');
mkdirSync(target,{recursive:true});
const patch = resolve(root, 'patches/gpui-pre-web-0.3.10-ime.patch');
const conduits=['js','rs'].map(extension=>resolve(root,`patches/gpui-pre-web-input-conduit.${extension}`));
const digest = createHash('sha256').update(readFileSync(patch)).update(readFileSync(conduits[0])).update(readFileSync(conduits[1])).digest('hex');
export const webBackend = resolve(realpathSync(target), `patched-dependencies/gpui-pre-web-0.3.10-${digest.slice(0,12)}`);

export async function prepareWebBackend() {
  const stamp = resolve(webBackend, '.pero-patch');
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === digest) return;

  const cache = resolve(process.env.CARGO_HOME || resolve(homedir(), '.cargo'), 'registry/cache');
  const name = 'gpui-pre-web-0.3.10.crate';
  const cached = existsSync(cache) && readdirSync(cache)
    .map(directory => resolve(cache, directory, name)).find(path => existsSync(path));
  let archive;
  if (cached) archive = readFileSync(cached);
  else {
    const response = await fetch(`https://static.crates.io/crates/gpui-pre-web/${name}`);
    if (!response.ok) throw new Error(`Cannot fetch ${name}: ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
  }
  const checksum = '1acd86af2347f0dd8b63c441a5dbd43b3fcd7dac69b340827c3497da5a13d6fb';
  if (createHash('sha256').update(archive).digest('hex') !== checksum) {
    throw new Error(`${name} does not match the pinned crates.io checksum`);
  }
  mkdirSync(webBackend, { recursive: true });
  const archivePath = resolve(webBackend, name);
  writeFileSync(archivePath, archive);
  await run('tar', ['-xzf', archivePath, '--strip-components=1', '-C', webBackend]);
  await run('git', ['apply', '--unsafe-paths', `--directory=${webBackend}`, patch]);
  for(let i=0;i<conduits.length;i++)copyFileSync(conduits[i],resolve(webBackend,`src/input_conduit.${i===0?'js':'rs'}`));
  writeFileSync(stamp, digest);
}
