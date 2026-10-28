// Release-only acquisition of the explicit Product runtime; the Product builder stays offline.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Virtual Cell release Python requires macOS arm64.');
const pin = JSON.parse(readFileSync(new URL('./python.json', import.meta.url), 'utf8'));
const directory = join(process.env.RUNNER_TEMP, 'virtual-cell-python');
mkdirSync(directory, { recursive: true });
const archive = join(directory, pin.asset);
const response = await fetch(`https://github.com/${pin.repository}/releases/download/${pin.release}/${encodeURIComponent(pin.asset)}`);
if (!response.ok) throw new Error(`Python download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw new Error('Pinned Python checksum mismatch.');
writeFileSync(archive, bytes);
execFileSync('tar', ['-xzf', archive, '-C', directory], { stdio: 'inherit' });
