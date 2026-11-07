import assert from 'node:assert/strict';

// Finish each owner even if an earlier shutdown step fails. A failed cleanup
// must never turn a partial attempt into a successful qualification receipt.
export async function shutdownResearchRun({ host, hostExit, disableApp, desktop, provider }) {
  const failures = [];
  const attempt = async action => {
    try { await action(); } catch (error) { failures.push(error); }
  };
  if (disableApp && host?.exitCode === null) await attempt(disableApp);
  if (host) await attempt(async () => {
    let exited = [host.exitCode, host.signalCode];
    if (host.exitCode === null) {
      host.stdin.end();
      const timer = setTimeout(() => host.kill('SIGKILL'), 5000);
      try { exited = await hostExit; } finally { clearTimeout(timer); }
    }
    assert.deepEqual(exited, [0, null], 'Host must exit normally, not by forced cleanup');
  });
  await attempt(() => desktop?.close());
  if (provider) await attempt(async () => {
    provider.closeAllConnections();
    await new Promise((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
  });
  if (failures.length) throw new AggregateError(failures, 'Research run cleanup failed');
}
