import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConnectorSecrets } from '../../../packages/connectors/src/host.mjs';

type Protection = {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
};

/** Only ciphertext reaches disk. The protection implementation belongs to Main. */
export class ConnectorSecretStore implements ConnectorSecrets {
  private directory: string;
  private protection: Protection;
  constructor(directory: string, protection: Protection) { this.directory = directory; this.protection = protection; }
  private path(key: string) { return join(this.directory, createHash('sha256').update(key).digest('hex') + '.json'); }
  private async available() {
    if (!await this.protection.available()) throw Object.assign(new Error('MCP_CREDENTIAL_STORE_UNAVAILABLE'), { code: 'MCP_CREDENTIAL_STORE_UNAVAILABLE' });
  }
  async read(key: string): Promise<string | null> {
    await this.available();
    let bytes: Buffer;
    try { bytes = await readFile(this.path(key)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (bytes.length > 512 * 1024) throw new Error('MCP_CREDENTIAL_STORE_CORRUPT');
    const value = JSON.parse(await this.protection.decrypt(bytes));
    if (value.version !== 1 || value.key !== key || value.namespace !== this.directory || typeof value.value !== 'string') throw new Error('MCP_CREDENTIAL_STORE_CORRUPT');
    return value.value;
  }
  async write(key: string, value: string): Promise<void> {
    await this.available();
    const ciphertext = await this.protection.encrypt(JSON.stringify({ version: 1, namespace: this.directory, key, value }));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.path(key), temporary = target + '.' + randomUUID() + '.tmp';
    const file = await open(temporary, 'wx', 0o600);
    try {
      try { await file.writeFile(ciphertext); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, target);
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async remove(key: string): Promise<void> {
    await this.available();
    await unlink(this.path(key)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
