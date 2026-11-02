// Compose the portable GPUI distribution using the same builtin App/runtime payload.
import { run } from '../lib/run.mjs';
import { root } from '../lib/paths.mjs';
await run(process.execPath, ['scripts/release/node.mjs']);
await run(process.execPath, ['scripts/build/apps.mjs'], { env: { ...process.env, PERO_BUILD_RELEASE: '1' } });
await run(process.execPath, ['scripts/cargo.mjs', 'build', '--release', '--locked', '-p', 'pero-host', '-p', 'pero-worker']);
await run(process.execPath, ['scripts/build/computer.mjs', '--release']);
await run(process.execPath, ['scripts/build/connectors.mjs', '--release']);
await run(process.execPath, ['scripts/cargo.mjs', '+nightly-2026-10-28', 'build', '--release', '--locked', '-p', 'pero-ui', '--features', 'native', '--bin', 'pero-native']);
await run(process.execPath, ['scripts/build/native-package.mjs'], { env: { ...process.env, PERO_NATIVE_NODE_ROOT: `${root}/target/native-node/node-v22.23.4-darwin-arm64` } });
