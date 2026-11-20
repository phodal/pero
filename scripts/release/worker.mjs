// Stage a standalone Worker archive after verifying the extracted Linux binary.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('Worker releases require native Linux x86_64.');
}
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceRevision = git('rev-parse', 'HEAD');
const releaseTag = process.env.RELEASE_TAG || null;
if (process.env.GITHUB_ACTIONS === 'true' || releaseTag || process.env.RELEASE_SHA) {
  if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(releaseTag ?? '') ||
      process.env.RELEASE_SHA !== sourceRevision ||
      git('rev-parse', `refs/tags/${releaseTag}^{commit}`) !== sourceRevision) {
    throw new Error('The release tag and admitted SHA must match the checked out source.');
  }
}

const artifact = 'Pero-Worker-linux-x64';
const binary = 'pero-worker';
const unit = 'pero-worker.service';
const assets = resolve(root, 'target/release-assets');
const target = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
const scratch = mkdtempSync(join(tmpdir(), 'pero-worker-package-'));
const stage = join(scratch, 'stage');
const installed = join(scratch, 'installed');
const archive = join(scratch, `${artifact}.tar.gz`);
const metadata = join(scratch, `${artifact}.build.json`);
const checksums = join(scratch, `${artifact}.SHA256SUMS`);
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
try {
  mkdirSync(stage);
  mkdirSync(installed);
  copyFileSync(join(target, 'release', binary), join(stage, binary));
  copyFileSync(join(root, 'deployment/worker', unit), join(stage, unit));
  execFileSync('tar', ['-czf', archive, '-C', stage, binary, unit]);
  execFileSync('tar', ['-xzf', archive, '-C', installed]);
  const executable = join(installed, binary);
  const elf = readFileSync(executable);
  if (elf.length < 20 || elf.subarray(0, 6).toString('hex') !== '7f454c460201' || elf.readUInt16LE(18) !== 62) {
    throw new Error('The archived Worker must be a little-endian x86_64 ELF binary.');
  }
  const smoke = spawnSync(executable, [], {
    cwd: installed, env: { HOME: installed, PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 10_000,
  });
  if (smoke.error) throw smoke.error;
  if (smoke.status !== 1 || !smoke.stderr.includes('pero-worker: Set PERO_CLOUD_URL')) {
    throw new Error(`The unconfigured Worker did not fail with the expected diagnostic: ${smoke.stderr}`);
  }
  const hosted = process.env.GITHUB_ACTIONS === 'true';
  writeFileSync(metadata, JSON.stringify({
    schemaVersion: 1, releaseTag, sourceRevision, productId: 'com.openpero.worker',
    platform: process.platform, arch: process.arch, signing: 'unsigned',
    buildProvider: hosted ? 'GitHub Actions' : 'local',
    buildURL: hosted ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    archive: basename(archive), archiveSha256: digest(archive),
  }, null, 2) + '\n');
  writeFileSync(checksums, [archive, metadata].map(file => `${digest(file)}  ${basename(file)}\n`).join(''));
  mkdirSync(assets, { recursive: true });
  for (const file of [archive, metadata, checksums]) copyFileSync(file, join(assets, basename(file)));
  console.log(join(assets, basename(archive)));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
