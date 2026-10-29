import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { cargoArgs, ensureGpuiLock } from '../lib/cargo.mjs';
import { root } from '../lib/paths.mjs';
import { run } from '../lib/run.mjs';
await run(process.execPath, [`${root}/scripts/codegen/theme.mjs`]);
await import('./fonts.mjs');
const bindgen = `${root}/target/tools/bin/wasm-bindgen${process.platform === 'win32' ? '.exe' : ''}`;
const release = process.env.PERO_BUILD_RELEASE === '1';
if (!existsSync(bindgen)) await run('cargo', ['install', 'wasm-bindgen-cli', '--version', '0.2.127', '--locked', '--root', `${root}/target/tools`]);
await ensureGpuiLock();
const chatOnly = process.argv.includes('--chat-only');
for (const [pkg, artifact, folder] of [
  ...(!chatOnly ? [['pero-ui', 'pero_ui', 'wasm']] : []),
  ['pero-chat-web', 'pero_chat_web', 'chat-wasm'],
]) {
  await run('cargo', cargoArgs(['+nightly-2026-10-28', 'build', '--locked', ...(release ? ['--release'] : []), '-p', pkg, '--target', 'wasm32-unknown-unknown']));
  const output = `${root}/web/src/${folder}`;
  mkdirSync(output, { recursive: true });
  await run(bindgen, [`${root}/target/wasm32-unknown-unknown/${release ? 'release' : 'debug'}/${artifact}.wasm`, '--target', 'web', '--out-dir', output]);
  if (release) {
    const wasm = `${output}/${artifact}_bg.wasm`;
    await run(process.platform === 'win32' ? process.execPath : 'npm', [...(process.platform === 'win32' ? [process.env.npm_execpath] : []), 'exec', '--yes', '--package=binaryen@132.0.0', '--', 'wasm-opt', wasm,
      '-Oz', '--strip-debug', '--strip-producers', '-o', `${wasm}.optimized`]);
    renameSync(`${wasm}.optimized`, wasm);
  }
}
