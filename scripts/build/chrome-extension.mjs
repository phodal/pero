import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const source = resolve(root, 'packages/chrome-extension');
const output = resolve(process.argv[2] ?? resolve(root, 'target/chrome-extension'));
await mkdir(output, { recursive: true });
await Promise.all(['manifest.json', 'relay.html', 'relay.css'].map(file => copyFile(resolve(source, file), resolve(output, file))));
await build({ absWorkingDir: source, entryPoints: ['src/service-worker.ts', 'src/relay-panel.ts'], outdir: output,
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome125' });
console.log(output);
