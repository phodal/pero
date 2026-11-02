// Pinned official Node runtime for the macOS Native distribution.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Native Node requires macOS arm64.');
const directory = resolve(import.meta.dirname, '../../target/native-node');
const asset = 'node-v22.23.4-darwin-arm64.tar.gz';
const sha256 = 'c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428';
mkdirSync(directory, { recursive: true });
const archive = join(directory, asset);
if (!existsSync(archive)) {
  const response = await fetch(`https://nodejs.org/dist/v22.23.4/${asset}`);
  if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
}
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== sha256) throw new Error('Pinned Node checksum mismatch.');
execFileSync('tar', ['-xzf', archive, '-C', directory], { stdio: 'inherit' });
console.log(join(directory, 'node-v22.23.4-darwin-arm64'));
