// Disk image creation for both macOS shells. Retry only the observed transient busy error.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createMacOSDmg(app, name, archive) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    rmSync(archive, { force: true });
    const result = spawnSync('/usr/bin/hdiutil', [
      'create', '-volname', name, '-srcfolder', app, '-fs', 'HFS+',
      '-nospotlight', '-format', 'ULMO', archive,
    ], { encoding: 'utf8' });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status === 0) return;
    if (!result.stderr.includes('Resource busy') || attempt === 3) {
      throw new Error(`macOS disk image creation failed (${result.status ?? result.signal})`);
    }
    console.error(`Disk image resource was busy; retrying (${attempt}/3).`);
  }
}

export function withMountedMacOSDmg(archive, inspect) {
  const mount = realpathSync(mkdtempSync(join(tmpdir(), 'pero-release-dmg-')));
  try {
    execFileSync('/usr/bin/hdiutil', ['attach', archive, '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      return inspect(mount);
    } finally {
      execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: ['ignore', 'pipe', 'pipe'] });
    }
  } finally {
    rmdirSync(mount);
  }
}
