import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { DOMAIN_PROVENANCE, PAPER_DIGEST, PAPER_EVIDENCE, readPaperResource } from '../src/resource-read.mjs';

const other = 'other-host-evidence';
const otherDigest = createHash('sha256').update(other).digest('hex');

function resource(owner, revision = PAPER_DIGEST) {
  return {
    ownerHost: owner, sharedProject: 'lab', localProject: 'local-lab', app: 'paper-agent',
    appInstance: `paper-agent@${owner}`, appVersion: '1', kind: 'paper', id: 'paper-1',
    revision, class: 'immutable',
  };
}

function domainRead(records, request) {
  const record = records.find(item => item.owner === request.resource.ownerHost && item.id === request.resource.id);
  if (!record) {
    const error = new Error('missing');
    error.code = 'missing';
    throw error;
  }
  if (!record.available) {
    const error = new Error('owner_unavailable');
    error.code = 'owner_unavailable';
    throw error;
  }
  return {
    ownerHost: record.owner, revision: record.revision, digest: record.digest,
    mediaType: 'text/plain', body: Buffer.from(record.body).toString('base64'), provenance: DOMAIN_PROVENANCE,
  };
}

const records = [
  { owner: 'local', id: 'paper-1', revision: PAPER_DIGEST, digest: PAPER_DIGEST, body: PAPER_EVIDENCE, available: true },
  { owner: 'host-b', id: 'paper-1', revision: PAPER_DIGEST, digest: PAPER_DIGEST, body: PAPER_EVIDENCE, available: true },
  { owner: 'host-c', id: 'paper-1', revision: otherDigest, digest: otherDigest, body: other, available: true },
];

test('local and remote transports return the same paper evidence', async () => {
  const local = { read: request => Promise.resolve(domainRead(records, request)) };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        const value = domainRead(records, JSON.parse(raw));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      } catch (error) {
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error.code }));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const remote = {
    read: async request => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/client/v1/projects/lab/app-resources/paper`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      });
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload.error);
        error.code = payload.error;
        throw error;
      }
      return payload;
    },
  };
  try {
    const fromLocal = await readPaperResource(local, { resource: resource('local') });
    const fromRemote = await readPaperResource(remote, { resource: resource('host-b') });
    assert.equal(Buffer.from(fromLocal.body).toString(), PAPER_EVIDENCE);
    assert.equal(Buffer.from(fromRemote.body).toString(), PAPER_EVIDENCE);
    assert.equal(fromLocal.digest, fromRemote.digest);
    assert.equal(fromRemote.ownerHost, 'host-b');
    const separate = await readPaperResource(remote, { resource: resource('host-c', otherDigest) });
    assert.equal(Buffer.from(separate.body).toString(), other);
    assert.notEqual(separate.ownerHost, fromRemote.ownerHost);
    let calls = 0;
    const down = { read: () => { calls += 1; const error = new Error('owner_unavailable'); error.code = 'owner_unavailable'; return Promise.reject(error); } };
    await assert.rejects(readPaperResource(down, { resource: resource('host-b') }), error => error.code === 'owner_unavailable');
    assert.equal(calls, 1);
    await assert.rejects(readPaperResource({ read: async () => ({ ownerHost: 'host-c', revision: PAPER_DIGEST, digest: PAPER_DIGEST, mediaType: 'text/plain', body: Buffer.from(PAPER_EVIDENCE).toString('base64'), provenance: DOMAIN_PROVENANCE }) }, { resource: resource('host-b') }), error => error.code === 'owner_unavailable');
    await assert.rejects(readPaperResource(local, { resource: resource('host-b'), path: '/var/pero/papers' }), error => error.code === 'spoofed');
    await assert.rejects(readPaperResource({ read: async () => ({ ownerHost: 'host-b', revision: 'wrong-revision', digest: PAPER_DIGEST, mediaType: 'text/plain', body: Buffer.from(PAPER_EVIDENCE).toString('base64'), provenance: DOMAIN_PROVENANCE }) }, { resource: resource('host-b') }), error => error.code === 'stale');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
