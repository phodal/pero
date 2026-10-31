// The `installs` section of Point's global connector state (~/.point/connector.json):
// managed installs that finished, so the catalog can show what Point already
// installed without re-running discovery for every card. A record is a hint,
// not proof: `verify` re-checks the one recorded file and drops the record
// when it is gone. Only the Host writes this file; other sections are kept.

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const isMap = value => !!value && typeof value === 'object' && !Array.isArray(value);

export class InstallRecords {
  #file;
  #queue = Promise.resolve();
  constructor(file) { this.#file = file; }

  async #document() {
    try {
      const parsed = JSON.parse(await readFile(this.#file, 'utf8'));
      return isMap(parsed) && parsed.version === 1 ? parsed : { version: 1 };
    } catch { return { version: 1 }; }
  }

  async #read() { const { installs } = await this.#document(); return isMap(installs) ? installs : {}; }

  // Writes are serialized and atomic, so a crash leaves the old file intact.
  #update(change) {
    const next = this.#queue.then(async () => {
      const document = await this.#document();
      const records = isMap(document.installs) ? document.installs : {};
      if (!change(records)) return;
      await mkdir(dirname(this.#file), { recursive: true });
      const partial = `${this.#file}.partial`;
      await writeFile(partial, `${JSON.stringify({ ...document, version: 1, installs: records }, null, 2)}\n`, { mode: 0o600 });
      await rename(partial, this.#file);
    });
    this.#queue = next.catch(() => undefined);
    return next;
  }

  /** Recorded installs, read from disk only; nothing on the machine is checked. */
  async list() {
    return Object.entries(await this.#read())
      .filter(([providerId, record]) => PROVIDER_ID.test(providerId) && typeof record?.path === 'string')
      .map(([providerId, record]) => ({ providerId, path: record.path, installedAt: record.installedAt ?? null }));
  }

  record(providerId, path, now = new Date()) {
    if (!PROVIDER_ID.test(providerId) || typeof path !== 'string' || !path.startsWith('/')) return Promise.resolve();
    return this.#update(records => { records[providerId] = { path, installedAt: now.toISOString() }; return true; });
  }

  /** `ready` while the recorded file is still an executable file; otherwise the record is dropped. */
  async verify(providerId) {
    const record = (await this.#read())[providerId];
    if (typeof record?.path !== 'string') return 'missing';
    const info = await stat(record.path).catch(() => null);
    if (info?.isFile() && (info.mode & 0o111) !== 0) return 'ready';
    await this.#update(records => { if (!(providerId in records)) return false; delete records[providerId]; return true; });
    return 'missing';
  }
}
