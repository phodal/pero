import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorSecretStore } from './connector-secrets.ts';

test('encrypted Host store survives reopening, deletes locally and fails closed without OS protection', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pero-connector-secrets-')), key = randomBytes(32);
  t.after(() => rm(root, { recursive: true, force: true }));
  const protection = { available: async () => true,
    encrypt: async (value: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decrypt: async (bytes: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(); } };
  const store = new ConnectorSecretStore(root, protection);
  await store.write('api-key', 'private-token');
  for (const file of await readdir(root)) assert.equal((await readFile(join(root, file))).includes('private-token'), false);
  const reopened = new ConnectorSecretStore(root, protection);
  assert.equal(await reopened.read('api-key'), 'private-token');
  await reopened.remove('api-key'); assert.equal(await store.read('api-key'), null);
  const unavailable = new ConnectorSecretStore(root, { ...protection, available: async () => false });
  await assert.rejects(unavailable.write('api-key', 'private-token'), { code: 'MCP_CREDENTIAL_STORE_UNAVAILABLE' });
  assert.equal((await readdir(root)).length, 0);
});
