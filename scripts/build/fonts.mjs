// Offline-first font preparation. Only source/licence text belongs in Git.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from '../lib/paths.mjs';
import { run } from '../lib/run.mjs';

const manifestPath = join(root, 'scripts/build/fonts.manifest.json');
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const destination = join(root, 'web/public/fonts');
const cache = join(root, 'target/font-cache');
const local = process.env.PERO_FONT_DIR ? resolve(process.env.PERO_FONT_DIR) : null;
const kit = resolve(process.env.PERO_GPUI_KIT_PATH || join(root, '../../test/gpui-kit'));
const providers = [local, join(kit, 'crates/story-web/fonts')].filter(Boolean);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const characters = new Set(Array.from({ length: 95 }, (_, i) => String.fromCodePoint(i + 32)));
for (const locale of ['en', 'zh-CN']) {
  const catalog = JSON.parse(await readFile(join(root, `locales/${locale}.json`), 'utf8'));
  for (const value of Object.values(catalog)) for (const character of value) {
    if (character.codePointAt(0) >= 32) characters.add(character);
  }
}
const repertoire = [...characters].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('');
const key = hash(Buffer.concat([manifestBytes, await readFile(join(root, 'scripts/build/fonts.py')), Buffer.from(repertoire)]));
const generated = join(cache, 'generated', key);
const stampName = '.fonts-stamp.json';

async function bytesAt(path) { try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function atomic(path, data) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const old = await bytesAt(path);
  if (old && old.equals(Buffer.isBuffer(data) ? data : Buffer.from(data))) return;
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, data, { flag: 'wx' }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}

// Validate complete local output sets without requiring Python or fontTools.
function validFont(bytes, family, filename) {
  if (!bytes || bytes.length < 100 || bytes.length > 30_000_000) return false;
  try {
    if (![0x00010000, 0x4f54544f, 0x74727565].includes(bytes.readUInt32BE(0))) return false;
    const count = bytes.readUInt16BE(4);
    if (!count || count > 256 || 12 + count * 16 > bytes.length) return false;
    const tables = new Map();
    for (let i = 0; i < count; i++) {
      const entry = 12 + i * 16;
      const offset = bytes.readUInt32BE(entry + 8), length = bytes.readUInt32BE(entry + 12);
      if (offset + length > bytes.length) return false;
      tables.set(bytes.toString('ascii', entry, entry + 4), bytes.subarray(offset, offset + length));
    }
    if ((tables.has('fvar') && filename !== 'Inter-Regular.ttf') || !['cmap', 'head', 'maxp', 'name', 'OS/2'].every(name => tables.has(name))) return false;
    if (tables.get('maxp').readUInt16BE(4) === 0 || tables.get('OS/2').readUInt16BE(4) !== (/bold/i.test(filename) ? 700 : 400)) return false;
    const table = tables.get('name');
    const offset = table.readUInt16BE(4);
    for (let i = 0; i < table.readUInt16BE(2); i++) {
      const entry = 6 + i * 12, platform = table.readUInt16BE(entry), name = table.readUInt16BE(entry + 6);
      if (![1, 16].includes(name)) continue;
      const text = Buffer.from(table.subarray(offset + table.readUInt16BE(entry + 10), offset + table.readUInt16BE(entry + 10) + table.readUInt16BE(entry + 8)));
      const decoded = [0, 3].includes(platform) ? text.swap16().toString('utf16le') : text.toString('latin1');
      if (decoded === family) return true;
    }
  } catch { return false; }
  return false;
}
async function complete(directory, requireStamp = false) {
  let stamp;
  if (requireStamp) {
    try { stamp = JSON.parse(await readFile(join(directory, stampName), 'utf8')); } catch { return null; }
    if (stamp.key !== key) return null;
  }
  const files = {};
  for (const [name, family] of Object.entries(manifest.outputs)) {
    const data = await bytesAt(join(directory, name));
    if (!validFont(data, family, name) || (stamp && stamp.files[name] !== hash(data))) return null;
    files[name] = data;
  }
  return files;
}
async function publish(files, provenance) {
  const stamp = { key, provenance, files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, hash(data)])) };
  for (const [name, data] of Object.entries(files)) await atomic(join(destination, name), data);
  await atomic(join(destination, stampName), JSON.stringify(stamp, null, 2) + '\n');
}
async function source(spec) {
  const cached = join(cache, 'sources', `${spec.sha256}-${spec.filename}`);
  for (const directory of providers) for (const name of [spec.filename, ...(spec.aliases || [])]) {
    const data = await bytesAt(join(directory, name));
    if (data && hash(data) === spec.sha256) { await atomic(cached, data); return cached; }
  }
  const existing = await bytesAt(cached);
  if (existing && hash(existing) === spec.sha256) return cached;
  if (!spec.url.startsWith('https://')) throw new Error('Font sources require pinned HTTPS URLs');
  process.stdout.write(`Downloading pinned font source: ${spec.filename}\n`);
  const response = await fetch(spec.url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Font download failed: ${spec.filename} (${response.status})`);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.length;
    if (size > 30_000_000) { await reader.cancel(); throw new Error('Font source exceeds size limit'); }
    chunks.push(next.value);
  }
  const data = Buffer.concat(chunks);
  if (hash(data) !== spec.sha256) throw new Error(`Font checksum mismatch: ${spec.filename}`);
  await atomic(cached, data);
  return cached;
}
function hasTool(python, env = process.env) {
  return spawnSync(python, ['-c', `import fontTools; assert fontTools.__version__ == '${manifest.fonttools}'`], { env, stdio: 'ignore' }).status === 0;
}
async function pythonTool() {
  const python = process.env.PERO_PYTHON || 'python3';
  if (hasTool(python)) return { python, env: process.env };
  const tool = join(root, 'target/tools', `fonttools-${manifest.fonttools}`);
  const executable = join(tool, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const env = { ...process.env }; delete env.PYTHONPATH;
  if (!hasTool(executable, env)) {
    if (!existsSync(executable)) await run(python, ['-m', 'venv', tool], { env });
    await run(executable, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-deps', '--break-system-packages', `fonttools==${manifest.fonttools}`], { env });
    if (!hasTool(executable, env)) throw new Error('Pinned fontTools setup failed');
  }
  return { python: executable, env };
}
async function acquire() {
  await mkdir(cache, { recursive: true });
  const lockPath = join(cache, 'build.lock');
  const started = Date.now();
  for (;;) {
    try {
      const file = await open(lockPath, 'wx');
      await file.writeFile(JSON.stringify({ pid: process.pid })); await file.close();
      return () => rm(lockPath, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const { pid } = JSON.parse(await readFile(lockPath, 'utf8'));
        try { process.kill(pid, 0); } catch (err) { if (err.code === 'ESRCH') { await rm(lockPath, { force: true }); continue; } }
      } catch { /* Another writer may still be creating the lock. */ }
      if (Date.now() - started > 180_000) throw new Error('Timed out waiting for font build; inspect target/font-cache/build.lock');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

const unlock = await acquire();
let stage;
try {
  for (const directory of providers) {
    const files = await complete(directory);
    if (files) { await publish(files, 'local-output'); process.stdout.write('Fonts ready from local output set.\n'); break; }
  }
  if (!await complete(destination, true)) {
    const cached = await complete(generated, true);
    if (cached) { await publish(cached, 'generated-cache'); }
    else {
      const inputs = Object.fromEntries(await Promise.all(manifest.sources.map(async spec => [spec.id, await source(spec)])));
      const tool = await pythonTool();
      stage = join(cache, `stage-${randomUUID()}`); await mkdir(stage, { recursive: true });
      const config = join(stage, 'config.json');
      await atomic(config, JSON.stringify({ output: stage, noto: inputs.noto, characters: repertoire, fonttools: manifest.fonttools }));
      await run(tool.python, [join(root, 'scripts/build/fonts.py'), config], { env: tool.env });
      for (const spec of manifest.sources.filter(spec => spec.id !== 'noto')) await atomic(join(stage, spec.filename), await readFile(inputs[spec.id]));
      const files = await complete(stage);
      if (!files) throw new Error('Generated font output validation failed');
      const stamp = { key, files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, hash(data)])) };
      await atomic(join(stage, stampName), JSON.stringify(stamp));
      await rm(config); await mkdir(resolve(generated, '..'), { recursive: true });
      await rm(generated, { recursive: true, force: true }); await rename(stage, generated); stage = null;
      await publish(files, 'pinned-source');
    }
  }
  process.stdout.write('Fonts ready (7 fonts; generated files are ignored by Git).\n');
} finally {
  if (stage) await rm(stage, { recursive: true, force: true });
  await unlock();
}
