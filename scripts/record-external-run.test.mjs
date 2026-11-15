import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const wrapper = resolve(import.meta.dirname, 'record-external-run.mjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const start = (workspace, run, outputs, command) => {
  const child = spawn(process.execPath, [wrapper, 'test', run, ...outputs, '--', ...command], {
    cwd: workspace, env: { ...process.env, PERO_TEST_SECRET: 'not-an-environment-snapshot' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const done = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
  return { child, done };
};

test('Python command retains pre-run sources, real environment, hashes and a replayable receipt', { timeout: 20000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'pero-run-success-'));
  try {
    await writeFile(join(workspace, 'input.json'), '[1,2,3,4]');
    await writeFile(join(workspace, 'calculate.py'), 'import json,sys\nfrom pathlib import Path\nvalues=json.loads(Path(sys.argv[1]).read_text())\nPath(sys.argv[2]).write_text(json.dumps({"sum":sum(values),"n":len(values)}))\nprint("computed",sum(values))\n');
    const result = await start(workspace, 'calculation', ['result.json', '--input', 'input.json'], ['python3', 'calculate.py', 'input.json', 'result.json']).done;
    assert.equal(result.code, 0, result.stderr);
    const receipt = await json(join(workspace, 'result.json.pero-run.json'));
    assert.equal(receipt.schema_version, 2);
    assert.deepEqual(receipt.invocation, { command: 'python3', args: ['calculate.py', 'input.json', 'result.json'], cwd: '.' });
    assert.equal(receipt.outcome, 'succeeded');
    assert.equal(receipt.execution.exit_code, 0);
    assert.equal(receipt.execution.signal, null);
    assert.equal(receipt.output_path, 'result.json');
    assert.equal(receipt.output_sha256, hash(await readFile(join(workspace, 'result.json'))));
    assert.ok(Date.parse(receipt.execution.finished_at) >= Date.parse(receipt.execution.started_at));
    const environment = await json(join(workspace, receipt.evidence.find(file => file.role === 'environment').path));
    assert.equal(environment.python.status, 'observed');
    assert.equal(environment.python.selection, 'command_interpreter');
    assert.ok(environment.python.version);
    assert.ok(environment.python.executable);
    assert.ok(Array.isArray(environment.python.packages));
    assert.ok(!JSON.stringify(environment).includes('not-an-environment-snapshot'));
    assert.deepEqual(receipt.evidence.filter(file => file.source_path).map(file => [file.role, file.source_path]), [['input', 'input.json'], ['code', 'calculate.py']]);
    for (const file of receipt.evidence) assert.equal(hash(await readFile(join(workspace, file.path))), file.sha256);
    // Reconstruct only the retained sources into a fresh workspace; no current source files are used.
    const replay = join(workspace, 'replay');
    await mkdir(replay);
    await writeFile(join(workspace, 'input.json'), '[999]');
    await rm(join(workspace, 'calculate.py'));
    for (const file of receipt.evidence.filter(file => file.source_path)) {
      const path = join(replay, file.source_path);
      await mkdir(dirname(path), { recursive: true });
      await copyFile(join(workspace, file.path), path);
    }
    const rerun = spawn(receipt.invocation.command, receipt.invocation.args, { cwd: replay, stdio: 'ignore' });
    assert.deepEqual(await once(rerun, 'close'), [0, null]);
    assert.equal(hash(await readFile(join(replay, receipt.output_path))), receipt.output_sha256);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('failed and cancelled commands keep their actual outcome, partial output and logs', { timeout: 20000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'pero-run-terminal-'));
  try {
    await writeFile(join(workspace, 'fail.py'), 'import sys\nfrom pathlib import Path\nPath("partial.json").write_text("{\\"partial\\":true}")\nprint("partial output")\nprint("computation failed",file=sys.stderr)\nsys.exit(7)\n');
    const failed = await start(workspace, 'failure', ['partial.json'], ['python3', 'fail.py']).done;
    assert.equal(failed.code, 7, failed.stderr);
    const failure = await json(join(workspace, 'partial.json.pero-run.json'));
    assert.equal(failure.outcome, 'failed');
    assert.equal(failure.execution.exit_code, 7);
    assert.equal(await readFile(join(workspace, failure.evidence[2].path), 'utf8'), 'computation failed\n');
    await writeFile(join(workspace, 'cancel.py'), 'import signal,sys\nfrom pathlib import Path\nsignal.signal(signal.SIGINT,lambda *_:sys.exit(0))\nPath("cancelled.json").write_text("{\\"partial\\":true}")\nprint("READY",flush=True)\nsignal.pause()\n');
    for (const [requestSignal, exitCode, exitSignal] of [['SIGINT', 0, null], ['SIGTERM', null, 'SIGTERM']]) {
      const run = start(workspace, `cancellation-${requestSignal}`, ['cancelled.json'], ['python3', 'cancel.py']);
      // Observe the child's readiness before asking its wrapper to interrupt it.
      await new Promise((ready, reject) => {
        run.child.stdout.on('data', data => { if (data.toString().includes('READY')) ready(); });
        run.child.once('close', () => reject(new Error('Command ended before READY')));
      });
      run.child.kill(requestSignal);
      const cancelled = await run.done;
      assert.equal(cancelled.code, 1, cancelled.stderr);
      const cancellation = await json(join(workspace, 'cancelled.json.pero-run.json'));
      assert.equal(cancellation.outcome, 'cancelled');
      assert.equal(cancellation.execution.cancellation_requested, true);
      assert.equal(cancellation.execution.exit_code, exitCode, 'Graceful signal handling must not turn cancellation into success');
      assert.equal(cancellation.execution.signal, exitSignal);
      assert.equal(await readFile(join(workspace, cancellation.evidence[1].path), 'utf8'), 'READY\n');
    }
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('spawn failure and successful command without changed output retain inspectable run records', { timeout: 20000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'pero-run-no-output-'));
  try {
    for (const [run, command, outcome] of [
      ['missing', ['pero-deliberately-absent-command'], 'failed'],
      ['no-output', [process.execPath, '-e', 'console.log("no output")'], 'succeeded'],
      ...(process.platform === 'win32' ? [] : [['absolute-command', ['/bin/sh', '-c', 'printf observed'], 'succeeded']]),
    ]) {
      const result = await start(workspace, run, ['missing.txt'], command).done;
      assert.equal(result.code, 1);
      const recordPath = join(workspace, '.pero/run-records/test', run, 'run.json');
      const record = await json(recordPath);
      const sidecar = await json(recordPath + '.pero-run.json');
      assert.equal(sidecar.output_sha256, hash(await readFile(recordPath)));
      assert.equal(sidecar.outcome, outcome);
      assert.equal(sidecar.output_kind, 'run_report');
      assert.equal(record.outcome, outcome);
      assert.deepEqual(record.outputs, []);
      if (outcome === 'failed') {
        assert.equal(record.execution.spawn_error, 'ENOENT');
        const log = record.evidence.find(file => file.path.endsWith('stderr.log'));
        assert.match(await readFile(join(workspace, log.path), 'utf8'), /Failed to start command: ENOENT/);
      }
      for (const file of record.evidence) assert.equal(hash(await readFile(join(workspace, file.path))), file.sha256);
    }
    assert.equal((await start(workspace, 'original', ['kept.txt'], [process.execPath, '-e', 'require("node:fs").writeFileSync("kept.txt","original")']).done).code, 0);
    assert.equal((await start(workspace, 'unchanged-failure', ['kept.txt'], [process.execPath, '-e', 'console.error("failed without output");process.exit(2)']).done).code, 2);
    assert.equal((await json(join(workspace, 'kept.txt.pero-run.json'))).run_id, 'original', 'Unchanged output retains its actual producing receipt');
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
