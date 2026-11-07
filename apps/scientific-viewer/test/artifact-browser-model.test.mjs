import test from 'node:test';
import assert from 'node:assert/strict';
import { admitArtifactBrowser, artifactTarget, selectedArtifact } from '../ui-src/artifact-browser-model.ts';

const version = (number, media) => ({
  version: number, sha256: 'a'.repeat(64), bytes: 12, created_at: 100,
  format: { kind: 'markdown' }, source: { kind: 'file', path: '/workspace/report.md' },
  ...(media ? { media } : {}),
});
const state = () => ({ thread_id: 'thread-one', view: 'icons', selected: null, artifacts: [
  { id: 'report', thread_id: 'thread-one', title: '报告', versions: [version(1), version(2)] },
  { id: 'notes', thread_id: 'thread-one', title: '笔记', versions: [version(1)] },
] });
const target = (artifact_id = 'report', number = 1) => ({ thread_id: 'thread-one', artifact_id, version: number });

test('admission retains supported formats, media and shared presentation modes', () => {
  const cases = [
    [{ kind: 'text' }, undefined], [{ kind: 'markdown' }, { kind: 'document', format: { kind: 'markdown' } }],
    [{ kind: 'json' }, { kind: 'csv' }], [{ kind: 'json_lines' }, { kind: 'tsv' }],
    [{ kind: 'code', language: 'python' }, { kind: 'notebook' }],
    [{ kind: 'text' }, { kind: 'pdf' }], [{ kind: 'text' }, { kind: 'html' }],
    ...['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'].map(mime_type => [{ kind: 'text' }, { kind: 'image', mime_type }]),
  ];
  for (const [format, media] of cases) for (const view of ['icons', 'list', 'gallery']) {
    const input = state(); input.view = view;
    input.artifacts[0].versions[1] = { ...version(2, media), format, filename: 'report.md', source_message_id: 'message:0', source_tool_call_id: 'write' };
    assert.equal(admitArtifactBrowser(input, 'thread-one'), input);
  }
  const empty = { ...state(), artifacts: [] };
  assert.equal(admitArtifactBrowser(empty, 'thread-one'), empty);
  const research = state();
  research.artifacts[0].versions[0].source = { kind: 'research', provenance: {
    program_id: 'b'.repeat(64), checkpoint_id: 'c'.repeat(64), slot: 'report', export_digest: 'a'.repeat(64),
  } };
  assert.equal(admitArtifactBrowser(research, 'thread-one'), research);
  for (const key of ['program_id', 'checkpoint_id', 'slot', 'export_digest']) {
    const invalid = structuredClone(research); delete invalid.artifacts[0].versions[0].source.provenance[key];
    assert.throws(() => admitArtifactBrowser(invalid, 'thread-one'), /Invalid artifact browser/);
  }
});

test('catalog admission rejects malformed transport values before rendering', () => {
  const cases = [
    ['foreign state', value => { value.thread_id = 'other'; }],
    ['unknown mode', value => { value.view = 'columns'; }],
    ['mode is not a string', value => { value.view = ['icons']; }],
    ['missing selection', value => { delete value.selected; }],
    ['missing catalog', value => { value.artifacts = null; }],
    ['foreign item', value => { value.artifacts[0].thread_id = 'other'; }],
    ['duplicate item', value => { value.artifacts.push(value.artifacts[0]); }],
    ['empty versions', value => { value.artifacts[0].versions = []; }],
    ['invalid version', value => { value.artifacts[0].versions[0].version = 1.5; }],
    ['invalid size', value => { value.artifacts[0].versions[0].bytes = -1; }],
    ['invalid timestamp', value => { value.artifacts[0].versions[0].created_at = NaN; }],
    ['invalid digest', value => { value.artifacts[0].versions[0].sha256 = 'wrong'; }],
    ['invalid format', value => { value.artifacts[0].versions[0].format = { kind: 'other' }; }],
    ['format kind is not a string', value => { value.artifacts[0].versions[0].format = { kind: ['markdown'] }; }],
    ['missing language', value => { value.artifacts[0].versions[0].format = { kind: 'code' }; }],
    ['invalid media', value => { value.artifacts[0].versions[0].media = { kind: 'video' }; }],
    ['invalid image', value => { value.artifacts[0].versions[0].media = { kind: 'image', mime_type: 'image/bmp' }; }],
    ['image type is not a string', value => { value.artifacts[0].versions[0].media = { kind: 'image', mime_type: ['image/png'] }; }],
    ['invalid document media', value => { value.artifacts[0].versions[0].media = { kind: 'document', format: {} }; }],
    ['missing source path', value => { value.artifacts[0].versions[0].source = { kind: 'file' }; }],
    ['invalid source attribution', value => { value.artifacts[0].versions[0].source_tool_call_id = 42; }],
  ];
  for (const [label, mutate] of cases) {
    const input = state(); mutate(input);
    assert.throws(() => admitArtifactBrowser(input, 'thread-one'), /Invalid artifact browser/, label);
  }
  for (const input of [null, [], 'catalog']) assert.throws(() => admitArtifactBrowser(input, 'thread-one'), /Invalid artifact browser/);
});

test('selection admission and mode changes preserve an exact existing historical version', () => {
  const input = state(); input.selected = target();
  for (const view of ['icons', 'list', 'gallery']) {
    const admitted = admitArtifactBrowser({ ...input, view }, 'thread-one');
    const selected = selectedArtifact(admitted);
    assert.equal(selected.artifact.id, 'report'); assert.equal(selected.version.version, 1);
    assert.deepEqual(artifactTarget(selected.artifact, admitted.selected), target());
    assert.deepEqual(artifactTarget(admitted.artifacts[1], admitted.selected), target('notes', 1));
  }
  assert.equal(selectedArtifact(admitArtifactBrowser(state(), 'thread-one')), undefined);
  assert.deepEqual(artifactTarget(input.artifacts[0]), target('report', 2));
  for (const selected of [target('absent'), target('report', 3), { ...target(), thread_id: 'other' }, { ...target(), version: 0 }]) {
    assert.throws(() => admitArtifactBrowser({ ...input, selected }, 'thread-one'), /Invalid artifact browser selection/);
  }
});
