import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactContext, artifactLocator, artifactSourceUrl, readArtifactSnapshot } from '../ui-src/artifact-source.ts';
import { previewKind } from '../ui-src/preview-source.ts';

test('snapshot preview kinds retain binary, notebook and source distinctions', () => {
  const cases = [
    ['plot.png', 'image/png', 'image'], ['report.pdf', 'application/pdf', 'pdf'],
    ['results.csv', 'text/csv', 'table'], ['results.tsv', '', 'table'],
    ['analysis.ipynb', 'application/x-ipynb+json', 'notebook'], ['report.html', 'text/html', 'html'],
    ['report.md', '', 'markdown'], ['analysis.py', 'text/plain', 'code'],
    ['out.json', 'application/json', 'code'], ['notes.txt', 'text/plain', 'text'],
    ['weights.pkl', 'application/octet-stream', 'opaque'],
  ];
  for (const [name, mediaType, kind] of cases) assert.equal(previewKind({ name, mediaType }), kind, name);
});

test('only exact frozen versions can locate Host snapshots', () => {
  const locator = artifactLocator(new URLSearchParams({ thread_id: 'thread/a', artifact_id: 'report 1', version: '2' }));
  assert.equal(artifactSourceUrl(locator), '/host/artifacts/thread%2Fa/report%201/2');
  for (const values of [{}, { thread_id: 't', artifact_id: 'a' }, { thread_id: 't', artifact_id: 'a', version: '0' }, { thread_id: 't', artifact_id: 'a', version: '1.5' }])
    assert.throws(() => artifactLocator(new URLSearchParams(values)), /Invalid artifact version/);
});

test('snapshot admission checks Host metadata, complete bytes and content digest once', async () => {
  const locator = { threadId: 'thread-one', artifactId: 'report', version: 2 };
  const text = '# 结果\nObserved value: 42';
  const bytes = new TextEncoder().encode(text);
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  const headers = { 'Content-Type': 'text/markdown', 'Content-Length': String(bytes.length), 'X-Pero-Artifact-Name': encodeURIComponent('研究结果.md'), 'X-Pero-Artifact-Sha256': digest, 'X-Pero-Artifact-Kind': 'document' };
  const snapshot = await readArtifactSnapshot(locator, new Response(bytes, { headers }));
  assert.equal(snapshot.name, '研究结果.md'); assert.deepEqual(snapshot.bytes, bytes);
  assert.equal(snapshot.id, 'session-artifact:report:v2');
  assert.match(artifactContext(snapshot, 'Observed value: 42'), /About 研究结果\.md \(version 2\)/);
  assert.match(artifactContext(snapshot, '', 'zh-CN'), /^关于 研究结果\.md（第 2 版）$/);
  assert.equal(artifactContext(snapshot, 'Observed value: 42').includes(snapshot.sha256), false);
  assert.match(artifactContext(snapshot, 'Observed value: 42'), /Selected text \(data\):\nObserved value: 42/);
  for (const [change, reason] of [
    [{ 'X-Pero-Artifact-Kind': 'executable' }, /metadata/],
    [{ 'X-Pero-Artifact-Sha256': '0'.repeat(64) }, /digest/],
    [{ 'Content-Length': String(bytes.length + 1) }, /incomplete/],
  ]) await assert.rejects(readArtifactSnapshot(locator, new Response(bytes, { headers: { ...headers, ...change } })), reason);
  await assert.rejects(readArtifactSnapshot(locator, new Response('unavailable', { status: 404 })), /404/);
});
