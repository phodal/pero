// Build for the current OS. Release uses independent native runners in parallel.
import { run } from '../lib/run.mjs';
import { root } from '../lib/paths.mjs';
await run(process.execPath, ['scripts/build/apps.mjs']);
await run(process.execPath, ['scripts/build/wasm.mjs'], { env: { ...process.env, PERO_BUILD_RELEASE: '1' } });
await run(process.execPath, ['scripts/cargo.mjs', 'build', '--release', '--locked', '-p', 'pero-host', '-p', 'pero-worker']);
await run(process.execPath, ['scripts/build/computer.mjs', '--release']);
await run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'build'], { cwd: `${root}/web` });
await run(process.execPath, ['scripts/build/desktop.mjs']);
await run(process.execPath, [`scripts/build/${process.platform === 'darwin' ? 'macos' : 'portable'}-package.mjs`]);
