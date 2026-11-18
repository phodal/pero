import { bundleReader } from './reader.mjs';
import { run } from '../lib/run.mjs';

await run(process.execPath, ['scripts/build/wasm.mjs']);
const reader = await bundleReader();
await run(process.execPath, ['scripts/build/apps.mjs', '--reader-dist', reader]);
