import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';

const job = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs['strict-sandbox'];
const install = job.steps.find(step => step.name === 'Install supported sandbox backend');
test('strict sandbox dependency installation is bounded without weakening positive isolation', () => {
  assert.equal(install['timeout-minutes'], 4);
  assert.equal(job.env.PERO_REQUIRE_STRICT_SANDBOX, '1');
  assert.match(job.steps.at(-1).run, /go test.*TestNativeRuntime/);
  const dir = mkdtempSync(join(tmpdir(), 'sandbox-install-'));
  const env = { ...process.env, PATH: dir, RUNNER_TEMP: dir };
  const put = (name, text) => writeFileSync(join(dir, name), `#!/bin/bash\n${text}\n`, { mode: 0o755 });
  const run = () => execFileSync('/bin/bash', ['-e', '-c', install.run], { env, encoding: 'utf8', stdio: 'pipe' });
  try {
    put('bwrap', 'echo installed-bwrap');
    put('sudo', 'echo unexpected-apt >&2; exit 99');
    assert.match(run(), /installed-bwrap/); // Existing dependency never contacts apt.
    rmSync(join(dir, 'bwrap'));
    put('lsb_release', 'echo unsupported');
    assert.throws(run, error => error.status === 1);
    put('lsb_release', 'echo noble');
    put('sudo', 'echo "$*" >> "$RUNNER_TEMP/commands"; exit 42');
    assert.throws(run, error => error.status === 42); // No ignored apt failure / skipped test.
    assert.match(readFileSync(join(dir, 'commands'), 'utf8'), /timeout --kill-after=5s 90s apt-get.* update/);
    rmSync(join(dir, 'commands'));
    put('sudo', `echo "$*" >> "$RUNNER_TEMP/commands"
if [[ "$*" == *'install --yes'* ]]; then
  printf '#!/bin/bash\\necho installed-bwrap\\n' > "$RUNNER_TEMP/bwrap"
  /bin/chmod +x "$RUNNER_TEMP/bwrap"
fi`);
    assert.match(run(), /installed-bwrap/);
    const calls = readFileSync(join(dir, 'commands'), 'utf8').trim().split('\n');
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.match(call, /Acquire::Retries=2/);
      assert.match(call, /Acquire::https::Timeout=15/);
      assert.match(call, /APT::Update::Error-Mode=any/);
      assert.match(call, /Dir::Etc::sourceparts=-/);
    }
    assert.match(calls[1], /timeout --kill-after=5s 120s apt-get.* install --yes --no-install-recommends bubblewrap/);
    const sources = readFileSync(join(dir, 'strict-sandbox.sources.list'), 'utf8');
    assert.match(sources, /https:\/\/archive.ubuntu.com\/ubuntu noble main universe/);
    assert.match(sources, /https:\/\/security.ubuntu.com\/ubuntu noble-security/);
    assert.doesNotMatch(sources, /azure/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
