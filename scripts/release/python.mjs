// Acquire the pinned standalone CPython for macOS packages.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Bundled Python requires macOS arm64.');
const pin = JSON.parse(readFileSync(new URL('./python.json', import.meta.url), 'utf8'));
const directory = process.argv[2] ? resolve(process.argv[2]) : join(process.env.RUNNER_TEMP, 'virtual-cell-python');
mkdirSync(directory, { recursive: true });
const archive = join(directory, pin.asset);
let bytes;
if (existsSync(archive)) {
  bytes = readFileSync(archive);
} else {
  const response = await fetch(`https://github.com/${pin.repository}/releases/download/${pin.release}/${encodeURIComponent(pin.asset)}`);
  if (!response.ok) throw new Error(`Python download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw new Error('Pinned Python checksum mismatch.');
if (!existsSync(archive)) writeFileSync(archive, bytes);
rmSync(join(directory, 'python'), { recursive: true, force: true });
execFileSync('tar', ['-xzf', archive, '-C', directory], { stdio: 'inherit' });
