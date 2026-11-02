import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import YAML from 'yaml';
import { failures } from './gate.mjs';
import { suites } from './desktop-suite.mjs';
import { pack, unpack, runtimePaths } from './desktop-artifact.mjs';

test('daily keeps all Desktop acceptance; ordinary tier runs independent core contracts', () => {
  assert.deepEqual(Object.values(suites).map(([name]) => name).sort(), [
    'workbench', 'automation', 'toolcalls', 'data', 'data-product', 'control-lab', 'control-lab-app-use', 'control-lab-live', 'lab',
    'virtual-cell-comparison', 'virtual-cell-dataset-download', 'app-use', 'app-use-workbench',
    'mcp-settings', 'mcp-settings', 'mcp-settings', 'scientific-viewer', 'apps/automations/test/ui-smoke.mjs', 'paper-research-import-all', 'paper-reading',
  ].sort());
  const workflow = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const acceptance = workflow.jobs['desktop-acceptance'];
  assert.deepEqual(acceptance.strategy.matrix.suite, Object.keys(suites));
  assert.match(acceptance.if, /schedule.*workflow_dispatch/);
  assert.equal(acceptance.strategy['fail-fast'], false);
  assert.equal(acceptance.needs, 'desktop-linux');
  const metadata = acceptance.steps.find(step => step.name === 'Observe public TimesFM and HF metadata separately');
  assert.equal(metadata.if, "${{ !cancelled() && matrix.suite == 'paper-research-import' }}");
  assert.equal(metadata['timeout-minutes'], 3);
  assert.equal(workflow.on.workflow_dispatch.inputs.paper_pdf_live.default, false);
  const livePdf = acceptance.steps.find(step => step.name === 'Explicit public PDF study journey');
  assert.match(livePdf.if, /workflow_dispatch.*inputs.paper_pdf_live/);
  assert.match(livePdf.if, /contains\(github.event.pull_request.labels.\*.name, 'ci:paper-pdf-live'\)/);
  assert.equal(livePdf.env.PERO_PDF_STUDY_LIVE, '1');
  const liveSource = acceptance.steps.find(step => step.name === 'Explicit public source study journey');
  assert.equal(liveSource.if, livePdf.if);
  assert.match(liveSource.if, /!cancelled\(\)/);
  assert.equal(liveSource.env.PERO_SOURCE_STUDY_LIVE, '1');
  assert.match(liveSource.run, /run-acceptance.*paper-source-study\.mjs/);
  assert.equal(liveSource['continue-on-error'], undefined);
  assert.equal(livePdf['continue-on-error'], undefined);
  assert.match(livePdf.run, /run-acceptance.*paper-pdf-study\.mjs/);
  assert.match(metadata.run, /research_metadata\.py --allow-public-metadata --output test-results\/research-import\/live-metadata\.json/);
  assert.match(workflow.jobs.complete.if, /always\(\)/);
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']);
  assert.match(acceptance.if, /contains\(github.event.pull_request.labels.\*.name, 'ci:full'\)/);
  assert.deepEqual([...workflow.jobs.complete.needs].sort(), Object.keys(workflow.jobs).filter(name => name !== 'complete').sort());
  assert.equal(workflow.jobs.complete.steps.at(-1).run, 'node scripts/ci/gate.mjs');
  for (const name of ['bazel', 'go', 'harness']) {
    const matrix = workflow.jobs[name].strategy.matrix.os;
    assert.match(matrix, /schedule/); assert.match(matrix, /workflow_dispatch/);
    assert.match(matrix, /windows-latest/); assert.match(matrix, /macos-latest/);
    assert.match(matrix, /\|\| fromJSON\('\["ubuntu-latest"\]'\)/);
  }
  for (const name of ['desktop-linux', 'desktop', 'desktop-acceptance', 'windows-acl-sandbox']) assert.match(workflow.jobs[name].if, /schedule.*workflow_dispatch/);
  assert.equal(workflow.on.schedule[0].cron, '0 20 * * *');
  const platform = YAML.parse(readFileSync('.github/workflows/desktop-check.yml', 'utf8')).jobs.desktop;
  const commands = platform.steps.map(step => step.run || '').join('\n');
  for (const command of ['npm run build', 'npm run check', 'npm test', 'npm run test:contracts',
    'node tests/contracts/mcp-settings.mjs', 'node tests/contracts/mcp-ownership.mjs',
    'node --test tests/runtime/control-lab/*.test.mjs', 'npm run test:app-use:unit',
    'node tests/e2e/computer-transport.mjs', 'scripts/build/fonttools.test.mjs',
    'scripts/build/patch-checkout.test.mjs', 'scripts/build/gpui-kit.test.mjs',
    'node --test tests/runtime/control-lab/host-goal.test.ts',
    'desktop/src/main/app-use.test.ts', 'desktop/src/main/app-context.test.ts',
    'tests/fixtures/app-use-content.test.mjs', 'tests/fixtures/app-use-progress.test.mjs',
    'tests/fixtures/app-chat-launch.test.mjs', 'npm --prefix apps/virtual-cell run typecheck',
    'npm --prefix apps/virtual-cell run test:ui', 'npm --prefix apps/control-lab run typecheck',
    'npm --prefix apps/control-lab run test:ui', 'npm --prefix apps/data run typecheck',
    'npm --prefix apps/data run test:ui', 'node --test web/src/automation-model.test.ts tests/contracts/automation.test.mjs',
    'tests/fixtures/owned-electron-close.test.mjs', 'node tests/runtime/automation.mjs']) assert.ok(commands.includes(command), command);
  const core = workflow.jobs.core.steps.map(step => step.run || '').join('\n');
  for (const command of ['node --test tests/runtime/lab/*.test.mjs', 'npx tsc -p scripts/ci/tsconfig.core.json',
    'node scripts/cargo.mjs test --locked -p pero-contracts -p pero-runtime -p pero-host -p pero-worker',
    'node scripts/cargo.mjs build --locked -p pero-host -p pero-worker',
    'node scripts/build/mcp.mjs', 'node tests/contracts/host.mjs', 'node tests/runtime/automation.mjs',
    'node tests/contracts/mcp-settings.mjs', 'node tests/contracts/mcp-ownership.mjs',
    'tests/fixtures/owned-electron-close.test.mjs', 'npm run test:app-use:unit']) assert.ok(core.includes(command), command);
  assert.ok(core.includes("python -m unittest discover -s apps/paper-agent/test -p 'test_*.py' -v"));
  assert.ok(core.includes('python tests/e2e/paper-pdf-http.py --output'));
  assert.ok(core.includes('npm run typecheck --prefix apps/paper-agent'));
  assert.ok(core.includes('node --test tests/e2e/paper-library-availability.test.mjs'));
  assert.ok(core.indexOf('npm ci --prefix apps/paper-agent --ignore-scripts') < core.indexOf('node --test tests/e2e/paper-library-availability.test.mjs'));
  assert.ok(core.indexOf('npm ci --prefix apps/paper-agent --ignore-scripts') < core.indexOf('node --experimental-transform-types --test tests/e2e/paper-manual-evidence.test.ts'));
  assert.doesNotMatch(core, /npm run build|xvfb-run|build:wasm|scripts\/build\/(?:apps|wasm|reader|automation-app|scientific-viewer)\.mjs/);
  for (const command of ['ec89cfc36404667b7947aeb3d40b1c2859d729dd', 'https://github.com/longbridge/gpui-kit.git',
    'npm ci --prefix apps/automations --ignore-scripts', 'npm ci --prefix apps/scientific-viewer --ignore-scripts',
    'npm test --prefix apps/automations', 'npm test --prefix apps/scientific-viewer',
    'node tests/runtime/automation-app.mjs', 'node tests/contracts/point-agent.mjs',
    'python -m pip install --only-binary=:all: -r apps/scientific-viewer/requirements.txt',
    "python -m unittest discover -s apps/scientific-viewer/test -p 'test_*.py'"]) assert.ok(core.includes(command), command);
  assert.ok(commands.includes("python -m unittest discover -s apps/scientific-viewer/test -p 'test_*.py'"));
  assert.equal(Object.keys(suites).length, 20);
  const native = YAML.parse(readFileSync('.github/workflows/computer-use.yml', 'utf8'));
  assert.match(native.jobs.native.strategy.matrix.os, /schedule.*workflow_dispatch/);
  assert.equal(native.on.schedule[0].cron, '0 20 * * *');
  assert.equal(native.on.pull_request.paths, undefined);
});

test('independent Paper aggregates cover every offline journey once and restore scoped PDF mode', () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'pero-paper-wiring-'));
  const groups = {
    'paper-research-import': ['paper-research-import', 'paper-research-import-host', 'paper-pdf-study', 'paper-source-study', 'paper-library-save', 'paper-manual-records', 'paper-reproduction-component', 'paper-reproduction-native'],
    'paper-reading': ['paper-structured-reading', 'paper-agent'],
  };
  const entries = Object.values(groups).flat();
  try {
    for (const name of Object.keys(groups)) {
      const [aggregate, ...args] = suites[name];
      assert.deepEqual(args, []);
      writeFileSync(resolve(temp, `${aggregate}.mjs`), readFileSync(`tests/e2e/${aggregate}.mjs`));
    }
    // Execute both actual registry-selected aggregates. Only the costly Desktop
    // boundaries are replaced, never the ordering or environment scoping logic.
    for (const entry of entries) writeFileSync(resolve(temp, `${entry}.mjs`),
      `globalThis.visited.push([${JSON.stringify(entry)}, process.env.PERO_PAPER_PDF_ONLY]);
       if (process.env.PAPER_STUB_FAIL === ${JSON.stringify(entry)}) throw Error(${JSON.stringify(entry + ' failed')});`);
    function run(name, previous, failure = '') {
      const env = { ...process.env, PAPER_STUB_FAIL: failure };
      if (previous === undefined) delete env.PERO_PAPER_PDF_ONLY;
      else env.PERO_PAPER_PDF_ONLY = previous;
      return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
        `globalThis.visited = []; let error; try { await import('./${suites[name][0]}.mjs'); } catch (e) { error = e.message; } console.log(JSON.stringify({ visited, error, after: process.env.PERO_PAPER_PDF_ONLY }));`],
      { cwd: temp, env, encoding: 'utf8' }));
    }
    for (const previous of [undefined, 'prior-mode']) {
      const covered = [];
      for (const [name, expected] of Object.entries(groups)) {
        const result = run(name, previous);
        assert.deepEqual(result.visited, expected.map(entry => [entry, entry === 'paper-agent' ? '1' : previous ?? null]));
        assert.equal(result.error, undefined);
        assert.equal(result.after, previous);
        covered.push(...result.visited.map(([entry]) => entry));
        for (const failure of expected) {
          const failed = run(name, previous, failure);
          assert.equal(failed.error, `${failure} failed`);
          assert.equal(failed.after, previous);
          assert.deepEqual(failed.visited, result.visited.slice(0, expected.indexOf(failure) + 1));
        }
      }
      assert.deepEqual(covered.sort(), [...entries].sort());
      assert.equal(new Set(covered).size, entries.length, 'no duplicate acceptance across parallel groups');
    }
    const workflow = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
    const steps = workflow.jobs['desktop-acceptance'].steps;
    const python = steps.find(step => step.name === 'Paper research Python environment');
    assert.equal(python.if, "matrix.suite == 'paper-research-import' || matrix.suite == 'paper-reading'");
    const browser = steps.find(step => step.name === 'Browser for explicitly mocked App UI seams');
    assert.equal(browser.if, "matrix.suite == 'automations-ui' || matrix.suite == 'paper-research-import' || matrix.suite == 'paper-reading'");
    assert.equal(browser.run, 'npx playwright install --with-deps chromium');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('runtime archive is tied to exact revision, retains executable mode and verifies bytes', { skip: process.platform !== 'linux' }, () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'pero-ci-artifact-'));
  try {
    const source = resolve(temp, 'source'), destination = resolve(temp, 'destination'), archive = resolve(temp, 'runtime.tgz');
    mkdirSync(resolve(source, 'products'), { recursive: true }); mkdirSync(destination);
    writeFileSync(resolve(source, 'products/pero.json'), JSON.stringify({ apps: ['data'] }));
    for (const path of runtimePaths(source)) {
      const file = path.endsWith('/dist') || path.endsWith('/helpers') || path.startsWith('web/src/') ? `${path}/entry.js` : path;
      mkdirSync(dirname(resolve(source, file)), { recursive: true });
      writeFileSync(resolve(source, file), `fixture ${path}`, { mode: 0o755 });
    }
    assert.ok(!runtimePaths(source).some(path => path.includes('point-app')));
    const bindings = ['wasm/pero_ui', 'chat-wasm/pero_chat_web', 'reader-wasm/pero_reader_web', 'content-wasm/pero_content_worker'];
    // Artifact fixtures, not substitutes for the production-generated modules.
    // Exercise the actual producer/consumer boundary into an empty checkout.
    for (const binding of bindings) {
      writeFileSync(resolve(source, `web/src/${binding}.js`), `export const artifact = '${binding}';`);
      writeFileSync(resolve(source, `web/src/${binding}_bg.wasm`), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    }
    const sha = 'a'.repeat(40);
    pack(source, archive, sha);
    assert.throws(() => unpack(destination, archive, 'b'.repeat(40)), /revision or platform mismatch/);
    unpack(destination, archive, sha);
    assert.equal(readFileSync(resolve(destination, 'target/debug/pero-host'), 'utf8'), 'fixture target/debug/pero-host');
    for (const binding of bindings) {
      for (const suffix of ['.js', '_bg.wasm']) {
        const path = `web/src/${binding}${suffix}`;
        assert.deepEqual(readFileSync(resolve(destination, path)), readFileSync(resolve(source, path)));
      }
    }
    // Generated imports have the same integrity enforcement as executable outputs.
    writeFileSync(resolve(source, 'web/src/wasm/pero_ui.js'), 'different revision');
    execFileSync('tar', ['-czf', archive, ...runtimePaths(source), 'target/ci-runtime.json'], { cwd: source });
    assert.throws(() => unpack(destination, archive, sha), /checksum mismatch/);
    writeFileSync(resolve(source, 'web/src/wasm/pero_ui.js'), `export const artifact = 'wasm/pero_ui';`);
    // A changed payload cannot pass the manifest written by the producer.
    writeFileSync(resolve(source, 'target/debug/pero-host'), 'changed');
    assert.equal(statSync(resolve(destination, 'target/debug/pero-host')).mode & 0o777, 0o755);
    execFileSync('tar', ['-czf', archive, ...runtimePaths(source), 'target/ci-runtime.json'], { cwd: source });
    assert.throws(() => unpack(destination, archive, sha), /checksum mismatch/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('Linux gate permits only full Desktop/platform skips; full gate requires them', () => {
  const jobs = { core: { result: 'success' }, 'desktop-linux': { result: 'skipped' }, desktop: { result: 'skipped' }, 'desktop-acceptance': { result: 'skipped' }, 'windows-acl-sandbox': { result: 'skipped' } };
  assert.deepEqual(failures(jobs, false), []);
  assert.deepEqual(failures(jobs, true), ['desktop-linux', 'desktop', 'desktop-acceptance', 'windows-acl-sandbox']);
  for (const result of ['failure', 'cancelled', 'skipped'])
    assert.deepEqual(failures({ core: { result } }, false), ['core']);
  assert.deepEqual(failures({ desktop: { result: 'failure' } }, false), ['desktop']);
});

test('native reproduction fixture dispatches cancellation modes outside Electron evaluate arguments', async () => {
  const source = readFileSync('tests/e2e/paper-reproduction-native.mjs', 'utf8');
  const readiness = source.indexOf('globalThis.paperNative.state().disabled)');
  assert.ok(readiness >= 0);
  const start = source.indexOf('\n', readiness) + 1;
  const end = source.indexOf('      await expect.poll(() => application.evaluate(() => globalThis.paperNative.state().result)', start);
  assert.ok(end > start);
  // Execute the actual fixture dispatch, not a copy of its branching logic.
  // Electron evaluate supplies Electron's API as the callback's first argument.
  const dispatch = new Function('application', 'mode', `return (async () => { ${source.slice(start, end)} })()`);
  const previous = globalThis.paperNative;
  const calls = [];
  globalThis.paperNative = { abort: () => calls.push('abort'), closeOwner: () => calls.push('close') };
  try {
    const application = { async evaluate(callback, argument) { return callback({ electronAPI: true }, argument); } };
    await dispatch(application, 'abort');
    assert.deepEqual(calls, ['abort']);
    calls.length = 0;
    await dispatch(application, 'owner-close');
    assert.deepEqual(calls, ['close']);
  } finally {
    if (previous === undefined) delete globalThis.paperNative;
    else globalThis.paperNative = previous;
  }
});


test('ordinary core runs source campaign contracts after dependencies without provider or Host launch', () => {
  const { steps } = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs.core;
  const install = steps.findIndex(step => step.run === 'npm ci');
  const contracts = steps.findIndex(step => step.name === 'Permission, cancellation and fixture contracts');
  assert(install >= 0 && contracts > install);
  const command = 'node --experimental-transform-types --test tests/runtime/paper-study/*.test.mjs tests/runtime/research-import/cleanup.test.mjs';
  assert(steps[contracts].run.split('\n').includes(command));
  assert.equal(steps[contracts].if, undefined);
  assert.equal(steps[contracts]['continue-on-error'], undefined);
  assert(!steps[contracts].run.includes('paper-study/run.mjs'));
});

test('public HTML corpus requires its own opt-in and exports only per-case summaries', () => {
  const workflow = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  assert.equal(workflow.on.workflow_dispatch.inputs.paper_html_live.default, false);
  const job = workflow.jobs['paper-html-live'];
  const condition = "${{ (github.event_name == 'workflow_dispatch' && inputs.paper_html_live) || (github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'ci:paper-html-live')) }}";
  assert.equal(job.if, condition);
  assert.equal(workflow.jobs.complete.steps.at(-1).env.PAPER_HTML_LIVE, condition);
  assert.deepEqual(job.permissions, { contents: 'read' });
  assert.deepEqual(job.strategy.matrix.corpus, ['d5', 'pc-gym', 'controlgym']);
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job['timeout-minutes'], 5);
  assert.equal(job['continue-on-error'], undefined);
  const run = job.steps.find(step => step.run);
  assert.equal(run.run, 'python apps/paper-agent/test/manual/scientific_html.py --allow-official-html --case ${{ matrix.corpus }} --output test-results/paper-html-live/${{ matrix.corpus }}.json');
  const upload = job.steps.at(-1);
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.path, 'test-results/paper-html-live/${{ matrix.corpus }}.json');
  assert.equal(upload.with['if-no-files-found'], 'error');
  for (const full of [false, true]) {
    assert.deepEqual(failures({ 'paper-html-live': { result: 'skipped' } }, full, false), []);
    for (const result of ['skipped', 'failure', 'cancelled']) {
      assert.deepEqual(failures({ 'paper-html-live': { result } }, full, true), ['paper-html-live']);
    }
    assert.deepEqual(failures({ 'paper-html-live': { result: 'failure' } }, full, false), ['paper-html-live']);
    assert.deepEqual(failures({ 'paper-html-live': { result: 'success' } }, full, true), []);
  }
});
