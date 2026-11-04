// Run the actual contract entry with an owned Node Host fixture, not Electron.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const entry = resolve('tests/contracts/host.mjs');
const source = fs.readFileSync(entry, 'utf8');
const imports = source.match(/^import .*;$/gm).join('\n');
const body = source.replace(/^import .*;$/gm, '');
const bundled = await build({ stdin: { contents: `${imports}\nports.run = (async () => {${body}\n})();`,
  resolveDir: dirname(entry), sourcefile: entry }, format: 'cjs', platform: 'node', write: false,
  define: { 'import.meta.dirname': JSON.stringify(dirname(entry)) },
});

for (const scenario of ['event-timeout', 'cleanup-error', 'stdin-error']) {
  const cleanupFailure = scenario === 'cleanup-error';
  const stdinFailure = scenario === 'stdin-error';
  test(`early Host contract failure drains owned cwd and preserves diagnostics (${scenario})`, async () => {
    const logs = [], ports = {};
    let child, closed, temp, removed = false, closeObserved = false, exitCode;
    const require = createRequire(entry);
    const spawnFixture = (_command, _args, options) => {
      temp = options.cwd;
      // Remains alive until the contract owner ends stdin, with cwd in its temp.
      child = spawn(process.execPath, ['-e', stdinFailure ? `
        for (const event of [{kind:'settings',text:'en'}, {kind:'ready'}, {kind:'computer_settings',data:{enabled:false}}])
          console.log(JSON.stringify({version:1,request_id:null,text:'',...event}));
        // Close after the readiness lines. Closing fd 0 before Node polls stdin
        // aborts on macOS Node 22 (libuv refuses to close a stdio descriptor).
        require('node:fs').closeSync(0);
        process.on('message', () => process.disconnect());
      ` : 'process.stdin.resume();'], stdinFailure ? { ...options, stdio: ['pipe', 'pipe', 'inherit', 'ipc'] } : options);
      if (stdinFailure) child.stdin.once('error', () => child.send('release'));
      closed = once(child, 'close').then(() => { closeObserved = true; });
      return child;
    };
    try {
      runInNewContext(bundled.outputFiles[0].text, {
        ports, process: { ...process, exit: code => { exitCode = code; } },
        console: { log: text => logs.push(text), error: text => logs.push(text) },
        // Trigger the real next() failure path without spending its five-second budget.
        setTimeout: (callback, milliseconds) => setTimeout(callback, stdinFailure ? milliseconds : 0), clearTimeout,
        require: name => name === 'node:child_process' ? { spawn: spawnFixture }
          : name === 'node:fs' ? { ...fs, rmSync(path, options) {
            assert.equal(closeObserved, true, 'owned Host must close before removing its cwd');
            if (cleanupFailure) throw new Error('injected cleanup failure');
            fs.rmSync(path, options); removed = true;
          } } : require(name),
      });
      await ports.run;
      assert.equal(closeObserved, true);
      assert.equal(exitCode, 1, 'cleanup cannot turn a contract failure into success');
      assert(logs.some(line => line.includes(stdinFailure ? 'Host stdin: Error: write EPIPE' : 'timed out waiting for settings')), 'original contract failure must be reported');
      if (cleanupFailure) assert(logs.some(line => line.includes('Host cleanup: Error: injected cleanup failure')));
      else { assert.equal(removed, true); assert.equal(fs.existsSync(temp), false); }
    } finally {
      if (child && !closeObserved) { child.kill(); await closed; }
      if (temp) fs.rmSync(temp, { recursive: true, force: true });
    }
  });
}
