import { run } from '../lib/run.mjs';
import { root } from '../lib/paths.mjs';

if (!process.env.PERO_CONTENT_TEST_ROOT) {
  for (const script of ['build:host', 'build:wasm', 'build:web', 'build:connectors', 'build:desktop']) {
    await run(process.execPath, [process.env.npm_execpath, 'run', script], { cwd: root });
  }
}
await import('../../tests/e2e/browser-use.mjs');
