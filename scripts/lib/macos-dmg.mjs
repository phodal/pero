// Disk image creation for both macOS shells. Retry only the observed transient busy error.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmdirSync, rmSync, statSync } from 'node:fs';
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

export function withMountedMacOSDmg(archive, inspect, run = execFileSync) {
  const mount = realpathSync(mkdtempSync(join(tmpdir(), 'pero-release-dmg-')));
  const directoryDevice = statSync(mount).dev;
  const isMounted = () => statSync(mount).dev !== directoryDevice;
  const hdiutil = args => run('/usr/bin/hdiutil', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const errors = [];
  let result;
  try {
    hdiutil(['attach', archive, '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount]);
    if (!isMounted()) throw new Error('Disk image did not mount at ' + mount);
    result = inspect(mount);
  } catch (error) {
    errors.push(error);
  }
  try {
    // Check the owned mountpoint even if attach reported failure. Do not try
    // to remove the directory until it is back on its original filesystem.
    for (let attempt = 1; attempt <= 3 && isMounted(); attempt++) {
      try {
        hdiutil(['detach', mount]);
      } catch (error) {
        if (attempt === 3 && isMounted()) throw error;
      }
    }
    if (isMounted()) throw new Error('Disk image is still mounted at ' + mount);
    rmdirSync(mount);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 2) {
    throw new AggregateError(errors, 'Disk image verification and cleanup both failed at ' + mount, { cause: errors[0] });
  }
  if (errors.length === 1) throw errors[0];
  return result;
}
