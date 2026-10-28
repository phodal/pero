import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { cargoArgs } from '../lib/cargo.mjs';
import { root } from '../lib/paths.mjs';
import { run } from '../lib/run.mjs';
await import('../codegen/theme.mjs');
await import('./fonts.mjs');
const bindgen = `${root}/target/tools/bin/wasm-bindgen${process.platform === 'win32' ? '.exe' : ''}`;
const release = process.env.PERO_BUILD_RELEASE === '1';
if (!existsSync(bindgen)) await run('cargo', ['install', 'wasm-bindgen-cli', '--version', '0.2.127', '--locked', '--root', `${root}/target/tools`]);
await run('cargo', cargoArgs(['+nightly-2026-10-28', 'build', '--locked', ...(release ? ['--release'] : []), '-p', 'pero-ui', '--target', 'wasm32-unknown-unknown']));
mkdirSync(`${root}/web/src/wasm`, { recursive: true });
await run(bindgen, [`${root}/target/wasm32-unknown-unknown/${release ? 'release' : 'debug'}/pero_ui.wasm`, '--target', 'web', '--out-dir', `${root}/web/src/wasm`]);
if (release) {
  const wasm = `${root}/web/src/wasm/pero_ui_bg.wasm`;
  await run(process.platform === 'win32' ? process.execPath : 'npm', [...(process.platform === 'win32' ? [process.env.npm_execpath] : []), 'exec', '--yes', '--package=binaryen@132.0.0', '--', 'wasm-opt', wasm,
    '-Oz', '--strip-debug', '--strip-producers', '-o', `${wasm}.optimized`]);
  renameSync(`${wasm}.optimized`, wasm);
}
