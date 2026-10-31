import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

export async function pinScienceFile(path) {
  const resolved = await realpath(path), info = await lstat(resolved);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('SCIENCE_FILE_INVALID');
  return { path: resolved, sha256: createHash('sha256').update(await readFile(resolved)).digest('hex'), executable: !!(info.mode & 0o111) };
}

// Hash relative paths as well as contents. Reject links and bound discovery work.
// Python uses a fresh cache prefix, so ignored upstream bytecode is never loaded.
export async function scienceTreeDigest(root) {
  if (await realpath(root) !== root) throw new Error('SCIENCE_ROOT_NOT_CANONICAL');
  const hash = createHash('sha256'); let count = 0, bytes = 0;
  async function walk(relative = '') {
    for (const name of (await readdir(join(root, relative))).sort()) {
      if (name === '__pycache__' || name.endsWith('.pyc')) continue;
      const child = relative ? `${relative}/${name}` : name, path = join(root, child), info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('SCIENCE_SOURCE_LINK');
      if (info.isDirectory()) { if (++count > 1024) throw new Error('SCIENCE_SOURCE_TOO_LARGE'); await walk(child); }
      else if (info.isFile()) {
        bytes += info.size;
        if (++count > 1024 || bytes > 64 * 1024 * 1024) throw new Error('SCIENCE_SOURCE_TOO_LARGE');
        hash.update(child).update('\0').update(createHash('sha256').update(await readFile(path)).digest()).update('\0');
      } else throw new Error('SCIENCE_SOURCE_TYPE');
    }
  }
  await walk(); return hash.digest('hex');
}
