// Keep the caller's Kit checkout immutable. All Kit path dependencies share one patched copy.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { root } from './paths.mjs';
import { run } from './run.mjs';

const source = resolve(process.env.PERO_GPUI_KIT_PATH || resolve(root, '../../test/gpui-kit'));
if (!existsSync(resolve(source, 'crates/kit/Cargo.toml'))) {
  throw new Error('Set PERO_GPUI_KIT_PATH to your gpui-kit checkout (see desktop/README.md).');
}
export const kit = realpathSync(source);
const patches = ['gpui-base-0.8.1-source-search.patch','gpui-base-0.8.1-edit-events.patch'].map(name=>resolve(root,'patches',name));
const version = readFileSync(resolve(kit, 'crates/base/Cargo.toml'), 'utf8');
if (!/^version\s*=\s*"0\.8\.1"\s*$/m.test(version)) {
  throw new Error('The source-search patch requires gpui-base 0.8.1. Revalidate it before updating Kit.');
}
const excluded = new Set(['.git', 'target', 'node_modules']);
const hash = createHash('sha256');
for (const patch of patches) hash.update(readFileSync(patch));
// File contents, not mtimes or checkout names, determine the baseline cache identity.
function fingerprint(directory, base = directory, into = hash) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (excluded.has(entry.name) || (directory === base && entry.name === '.pero-patch')) continue;
    const path = resolve(directory,entry.name);
    if (entry.isDirectory()) fingerprint(path, base, into);
    else if (entry.isFile()) into.update(relative(base,path)).update('\0').update(readFileSync(path)).update('\0');
    else if (entry.isSymbolicLink()) into.update(relative(base,path)).update('\0link\0').update(readlinkSync(path)).update('\0');
  }
  return into;
}
fingerprint(kit);
const digest = hash.digest('hex');
const target = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
mkdirSync(target, { recursive:true });
export const patchedKit = resolve(realpathSync(target), `patched-dependencies/gpui-kit-0.8.1-${digest.slice(0,12)}`);

// The stamp records the patched tree's own contents. A CI target cache may restore a
// pruned or partial copy beside a valid-looking stamp, so the stamp alone is not trusted.
const tree = directory => fingerprint(directory, directory, createHash('sha256')).digest('hex');
const stampFor = () => `${digest}\n${tree(patchedKit)}`;

export async function prepareKit() {
  const stamp = resolve(patchedKit,'.pero-patch');
  if (existsSync(stamp) && readFileSync(stamp,'utf8') === stampFor()) return;
  // Copy into a clean directory: re-copying over an earlier copy's symlinks fails
  // (ERR_FS_CP_EINVAL), and patches must apply to pristine sources exactly once.
  rmSync(patchedKit,{recursive:true,force:true});
  mkdirSync(patchedKit,{recursive:true});
  // Keep Kit's relative symlinks (for example crates/*/LICENSE-APACHE) relative to the copy.
  cpSync(kit,patchedKit,{recursive:true,verbatimSymlinks:true,filter:path=>!relative(kit,path).split(/[\\/]/).some(part=>excluded.has(part))});
  for (const patch of patches) await run('git',['apply','--unsafe-paths',`--directory=${patchedKit}`,patch]);
  writeFileSync(stamp,stampFor());
}
