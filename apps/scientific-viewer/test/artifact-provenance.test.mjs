import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { admitArtifactProvenance, artifactEvidence, exportArtifactReproduction, provenanceGaps, readArtifactProvenance } from '../ui-src/artifact-provenance.ts';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = text => new TextEncoder().encode(text);
const output = '{"sum":6}\n';
const receipt = (outcome = 'succeeded') => ({ schema_version: 2, system: 'local', run_id: 'sum', outcome,
  output_path: 'out/result.json', output_sha256: hash(output), invocation: { command: process.execPath, args: ['analysis.mjs', 'input.json', 'out/result.json'], cwd: '.' },
  execution: { started_at: '2026-11-13T00:00:00Z', finished_at: '2026-11-13T00:00:01Z', exit_code: outcome === 'succeeded' ? 0 : outcome === 'failed' ? 3 : null, signal: outcome === 'cancelled' ? 'SIGTERM' : null }, evidence: [] });

test('execution observation admits old receipts and preserves failure, cancellation and missing facts', () => {
  for (const outcome of ['succeeded', 'failed', 'cancelled']) assert.equal(admitArtifactProvenance(receipt(outcome), hash(output)).outcome, outcome);
  const cancelled = receipt('cancelled'); cancelled.execution = { ...cancelled.execution, signal: null, exit_code: 0, cancellation_requested: true };
  assert.equal(admitArtifactProvenance(cancelled, hash(output)).outcome, 'cancelled');
  const old = { schema_version: 1, system: 'old', run_id: 'unobserved', outcome: 'failed', output_sha256: hash(output), evidence: [] };
  assert.deepEqual(provenanceGaps(admitArtifactProvenance(old, hash(output)), []), ['command and arguments', 'code', 'input files', 'environment observation', 'execution log']);
  assert.equal(provenanceGaps(null, [ { role: 'code' } ]).includes('execution receipt'), true);
  assert.equal(provenanceGaps(null, [ { role: 'code' } ]).includes('code'), false);
  for (const mutate of [
    value => { value.output_sha256 = '0'.repeat(64); },
    value => { value.execution.exit_code = 9; },
    value => { value.execution.signal = 'SIGTERM'; },
    value => { value.invocation.args = [null]; },
    value => { value.output_path = '../result.json'; },
    value => { value.execution.finished_at = '2026-11-12T00:00:00Z'; },
  ]) { const value = receipt(); mutate(value); assert.throws(() => admitArtifactProvenance(value, hash(output))); }
});

function catalog() {
  const sourceCode = "import { readFileSync, writeFileSync } from 'node:fs';\nconst data = JSON.parse(readFileSync(process.argv[2], 'utf8'));\nwriteFileSync(process.argv[3], JSON.stringify({sum:data.reduce((a,b)=>a+b,0)})+'\\n');\n";
  const files = [
    { id: 'code', name: 'analysis.mjs', role: 'code', text: sourceCode, path: '.pero/runs/sum/files/analysis.mjs', source_path: 'analysis.mjs' },
    { id: 'input', name: 'input.json', role: 'input', text: '[1,2,3]', path: '.pero/runs/sum/files/input.json', source_path: 'input.json' },
    { id: 'env', name: 'environment.json', role: 'environment', text: JSON.stringify({ node: process.version }), path: '.pero/runs/sum/environment.json' },
    { id: 'log', name: 'stdout.log', role: 'execution_log', text: 'summed 3 values\n', path: '.pero/runs/sum/stdout.log' },
  ];
  const observed = receipt();
  observed.evidence = files.map(file => ({ path: file.path, role: file.role, sha256: hash(file.text), ...(file.source_path ? { source_path: file.source_path } : {}) }));
  files.push({ id: 'run', name: 'result.json.pero-run.json', role: 'run_record', text: JSON.stringify(observed), path: 'out/result.json.pero-run.json' });
  const version = file => ({ version: 1, sha256: hash(file.text), bytes: Buffer.byteLength(file.text), filename: file.name,
    format: { kind: 'text' }, created_at: 1, source: { kind: 'file', path: '/original/' + file.path } });
  const artifacts = files.map(file => ({ id: file.id, thread_id: 'thread', title: file.name, versions: [version(file)] }));
  const selectedVersion = { ...version({ text: output, name: 'result.json', path: 'out/result.json' }), related: artifacts.map((item, index) => ({ artifact_id: item.id, version: 1, role: files[index].role })) };
  const selected = { artifact: { id: 'output', thread_id: 'thread', title: 'Sum result', versions: [selectedVersion, { ...selectedVersion, version: 2, sha256: hash('new version') }] }, version: selectedVersion };
  const content = new Map(files.map(file => [`/host/artifacts/thread/${file.id}/1`, file]));
  content.set('/host/artifacts/thread/output/1', { text: output, name: 'result.json' });
  const requested = [];
  const fetcher = async url => {
    requested.push(url);
    const file = content.get(url);
    if (!file) return new Response('not found', { status: 404 });
    return new Response(file.text, { headers: { 'Content-Type': 'text/plain', 'X-Pero-Artifact-Name': file.name,
      'X-Pero-Artifact-Sha256': hash(file.text), 'X-Pero-Artifact-Kind': 'document' } });
  };
  return { artifacts, selected, fetcher, requested, content, observed };
}

test('fixed-version export retains receipt and bytes and reruns actual code in the declared available environment', async t => {
  const data = catalog(), evidence = artifactEvidence(data.artifacts, data.selected);
  assert.equal((await readArtifactProvenance('thread', data.selected, evidence, data.fetcher)).run_id, 'sum');
  const archive = unzipSync(await exportArtifactReproduction('thread', data.selected, evidence, data.fetcher));
  const manifest = JSON.parse(new TextDecoder().decode(archive['reproduction.json']));
  assert.equal(manifest.version, 1); assert.equal(manifest.output.sha256, hash(output));
  assert.equal(manifest.provenance.execution.exit_code, 0); assert.deepEqual(manifest.unavailable, ['interpreter observation', 'dependency inventory']);
  assert.equal(data.requested.some(url => url.endsWith('/2')), false);
  const directory = await mkdtemp(join(tmpdir(), 'pero-provenance-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(archive)) {
    const target = join(directory, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content);
  }
  const rerun = spawnSync(process.execPath, [join(directory, 'replay.mjs')], { encoding: 'utf8' });
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stdout, /Output SHA-256 matches retained version/);
  assert.equal(await readFile(join(directory, 'replay-workspace/out/result.json'), 'utf8'), output);
  const repeated = spawnSync(process.execPath, [join(directory, 'replay.mjs')], { encoding: 'utf8' });
  assert.notEqual(repeated.status, 0); // Replaying cannot overwrite the previous run.
});

test('export distinguishes unavailable provenance and rejects missing or changed retained evidence', async () => {
  const data = catalog();
  const withoutReceipt = { ...data.selected, version: { ...data.selected.version, related: [] } };
  assert.equal(await readArtifactProvenance('thread', withoutReceipt, [], data.fetcher), null);
  const archive = unzipSync(await exportArtifactReproduction('thread', withoutReceipt, [], data.fetcher));
  assert.equal(archive['replay.mjs'], undefined);
  assert.match(new TextDecoder().decode(archive['README.txt']), /Observed execution: not observed/);
  assert.throws(() => artifactEvidence([], data.selected), /linked artifact version/);
  const evidence = artifactEvidence(data.artifacts, data.selected);
  data.content.get('/host/artifacts/thread/code/1').text = 'changed';
  await assert.rejects(exportArtifactReproduction('thread', data.selected, evidence, data.fetcher), /selected catalog version/);
});

test('cancelled runs and wrapper reports export evidence without pretending their outputs are replayable', async () => {
  for (const kind of ['cancelled', 'run_report']) {
    const data = catalog(), observed = data.observed;
    if (kind === 'cancelled') {
      observed.outcome = 'cancelled'; observed.execution.exit_code = null; observed.execution.signal = 'SIGINT';
    } else observed.output_kind = 'run_report';
    const runFile = data.content.get('/host/artifacts/thread/run/1'); runFile.text = JSON.stringify(observed);
    const version = data.artifacts.find(item => item.id === 'run').versions[0];
    version.sha256 = hash(runFile.text); version.bytes = Buffer.byteLength(runFile.text);
    const archive = unzipSync(await exportArtifactReproduction('thread', data.selected, artifactEvidence(data.artifacts, data.selected), data.fetcher));
    assert.equal(archive['replay.mjs'], undefined);
    assert.match(new TextDecoder().decode(archive['README.txt']), kind === 'cancelled' ? /external cancellation timing/ : /wrapper-generated run report/);
  }
});
