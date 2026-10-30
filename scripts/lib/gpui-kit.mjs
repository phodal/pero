// Keep the caller's Kit checkout immutable. All Kit path dependencies share one patched copy.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { root } from './paths.mjs';
import { run } from './run.mjs';

const source = resolve(process.env.PERO_GPUI_KIT_PATH || resolve(root, '../../test/gpui-kit'));
if (!existsSync(resolve(source, 'crates/kit/Cargo.toml'))) {
  throw new Error('Set PERO_GPUI_KIT_PATH to your gpui-kit checkout (see desktop/README.md).');
}
export const kit = realpathSync(source);
const patch = resolve(root, 'patches/gpui-base-0.8.1-source-search.patch');
const version = readFileSync(resolve(kit, 'crates/base/Cargo.toml'), 'utf8');
if (!/^version\s*=\s*"0\.8\.1"\s*$/m.test(version)) {
  throw new Error('The source-search patch requires gpui-base 0.8.1. Revalidate it before updating Kit.');
}
const excluded = new Set(['.git', 'target', 'node_modules']);
const hash = createHash('sha256').update(readFileSync(patch));
// File contents, not mtimes or checkout names, determine the baseline cache identity.
function fingerprint(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (excluded.has(entry.name)) continue;
    const path = resolve(directory,entry.name);
    if (entry.isDirectory()) fingerprint(path);
    else if (entry.isFile()) hash.update(relative(kit,path)).update('\0').update(readFileSync(path)).update('\0');
  }
}
fingerprint(kit);
const digest = hash.digest('hex');
const target = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
mkdirSync(target, { recursive:true });
export const patchedKit = resolve(realpathSync(target), `patched-dependencies/gpui-kit-0.8.1-${digest.slice(0,12)}`);

export async function prepareKit() {
  const stamp = resolve(patchedKit,'.pero-patch');
  if (existsSync(stamp) && readFileSync(stamp,'utf8') === digest) return;
  mkdirSync(patchedKit,{recursive:true});
  cpSync(kit,patchedKit,{recursive:true,filter:path=>!relative(kit,path).split(/[\\/]/).some(part=>excluded.has(part))});
  await run('git',['apply','--unsafe-paths',`--directory=${patchedKit}`,patch]);
  writeFileSync(stamp,digest);
}
