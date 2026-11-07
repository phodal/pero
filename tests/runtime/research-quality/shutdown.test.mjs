import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { shutdownResearchRun } from './shutdown.mjs';

test('shutdown reclaims real child and listeners after each owner failure', async () => {
  for (const failing of ['none', 'app', 'host', 'desktop']) {
    const provider = createServer(), bridge = createServer();
    provider.listen(0, '127.0.0.1'); bridge.listen(0, '127.0.0.1');
    await Promise.all([once(provider, 'listening'), once(bridge, 'listening')]);
    const host = spawn(process.execPath, ['-e',
      'process.stdin.resume();process.stdin.on("end",()=>process.exit(Number(process.argv[1])))',
      failing === 'host' ? '1' : '0'], { stdio: ['pipe', 'ignore', 'ignore'] });
    const hostExit = once(host, 'exit');
    const result = shutdownResearchRun({ host, hostExit, provider,
      disableApp: async () => { if (failing === 'app') throw Error('App disable rejected'); },
      desktop: { async close() {
        await new Promise(resolve => bridge.close(resolve));
        if (failing === 'desktop') throw Error('Desktop cleanup failed');
      } },
    });
    if (failing === 'none') await result;
    else await assert.rejects(result, error => error instanceof AggregateError && error.errors.length === 1);
    assert.equal(host.exitCode, failing === 'host' ? 1 : 0);
    assert.equal(provider.listening, false);
    assert.equal(bridge.listening, false);
  }
});
