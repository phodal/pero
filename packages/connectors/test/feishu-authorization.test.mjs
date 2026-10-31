import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeishuAuthorization } from '../src/connectors/feishu-workspace/authorization.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'point-feishu-auth-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, 'cli');
  const scopes = 'search:docs:read docx:document:readonly docx:document:create vc:meeting.meetingevent:read vc:note:read';
  const source = `#!${process.execPath}
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[1] === 'qrcode') {
  writeFileSync('authorization.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=', 'base64'));
} else if (args[1] === 'status') {
  console.log(JSON.stringify({ brand: 'feishu', appId: 'cli_fixture', verified: true, identities: { user: { status: 'ready', verified: true, tokenStatus: 'valid', openId: 'ou_fixture', scope: ${JSON.stringify(scopes)} } } }));
} else if (args[0] === 'api') {
  console.log(JSON.stringify({ ok: true, identity: 'user', data: { open_id: 'ou_fixture', tenant_key: 'tenantA' } }));
} else {
  console.log(JSON.stringify({ data: { verification_url: 'https://open.feishu.cn/page/cli?user_code=TEST', device_code: 'HOST-ONLY-SECRET', expires_in: 600 } }));
}
`;
  await writeFile(binary, source, { mode: 0o700 });
  const env = {
    POINT_FEISHU_CLI: binary,
    POINT_FEISHU_CLI_SHA256: createHash('sha256').update(source).digest('hex'),
    HOME: root,
    POINT_FEISHU_PROFILE: 'point-readonly',
    POINT_FEISHU_APP_ID: 'cli_fixture',
  };
  return { root, definition: { env, tools: ['feishu_account_get'], files: [{ path: binary, sha256: env.POINT_FEISHU_CLI_SHA256 }] } };
}

test('the device code stays in the host and completion is bound to that attempt', async t => {
  const env = await fixture(t);
  let opened = '';
  const auth = new FeishuAuthorization({
    root: join(env.root, 'auth'),
    definition: async () => env.definition,
    openExternal: async url => { opened = url; },
  });
  const attempt = await auth.begin('feishu-workspace', ['documents', 'deliverables']);
  assert.match(opened, /^https:\/\/open\.feishu\.cn\//);
  assert.match(attempt.qr, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(attempt).includes('HOST-ONLY-SECRET'), false);
  assert.deepEqual(auth.status('feishu-workspace').attempt, attempt);
  assert.equal(JSON.stringify(auth.status('feishu-workspace')).includes('HOST-ONLY-SECRET'), false);
  assert.ok(auth.attempts.get('feishu-workspace').scopes.includes('vc:note:read'));
  assert.deepEqual(await readdir(join(env.root, 'auth')), []);
  await assert.rejects(auth.finish('feishu-workspace', 'another-attempt'), { code: 'FEISHU_AUTH_EXPIRED' });
  assert.equal((await auth.finish('feishu-workspace', attempt.attemptId)).appId, 'cli_fixture');
  await assert.rejects(auth.finish('feishu-workspace', attempt.attemptId), { code: 'FEISHU_AUTH_EXPIRED' });
  await assert.rejects(auth.begin('feishu-workspace', ['arbitrary-api']), { code: 'FEISHU_ARGUMENT' });
  auth.dispose();
});

test('authorization cannot complete after configuration rebinding or Host disposal', async t => {
  const env = await fixture(t);
  let definition = env.definition;
  const auth = new FeishuAuthorization({ root: join(env.root, 'auth'), definition: async () => definition, openExternal: async () => {} });
  const attempt = await auth.begin('feishu-workspace', ['documents']);
  definition = { ...definition, env: { ...definition.env, POINT_FEISHU_PROFILE: 'another-profile' } };
  await assert.rejects(auth.finish('feishu-workspace', attempt.attemptId), { code: 'FEISHU_ACCOUNT_CHANGED' });
  auth.dispose();
  await assert.rejects(auth.begin('feishu-workspace', ['documents']), { code: 'FEISHU_CANCELLED' });
});
