import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/run.mjs';
const root = resolve(import.meta.dirname, '../..');
export async function buildHarness(directory = resolve(root, 'target/debug')) {
  mkdirSync(directory, { recursive: true });
  await run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', resolve(directory, process.platform === 'win32' ? 'pero-agent-acp.exe' : 'pero-agent-acp'), './cmd/pero-agent-acp'], { cwd: resolve(root, 'harness/go') });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await buildHarness();
