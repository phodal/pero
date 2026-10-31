// Only a ChildProcess returned by this test's Electron launch may be passed here.
import { readFile } from 'node:fs/promises';

function deadline(promise, milliseconds, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

async function terminateOwnedProcess(child, milliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let exited;
  const exit = new Promise(resolve => { exited = resolve; child.once('exit', exited); });
  try {
    if (process.platform === 'linux') {
      // Playwright launches Electron detached. Verify its group is private before
      // terminating the test-owned browser/renderer tree, never a shared group.
      const stat = await readFile(`/proc/${child.pid}/stat`, 'utf8');
      const group = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
      if (group !== child.pid) throw new Error('Refusing to terminate a shared process group');
      process.kill(-child.pid, 'SIGKILL');
    } else {
      child.kill('SIGKILL');
    }
    await deadline(exit, milliseconds, 'Test-owned Electron did not exit after termination');
  } finally {
    child.off('exit', exited);
  }
}

export async function closeOwnedElectron(app, { crashed = false, timeoutMs = 30000 } = {}) {
  if (crashed) {
    // A killed Host cannot acknowledge workspace checkpoints. Do not enter the
    // normal quit/save dialog; complete this deliberately crashed test session.
    await terminateOwnedProcess(app.process(), timeoutMs);
    return;
  }
  try {
    await deadline(app.close(), timeoutMs, 'Normal Electron close exceeded its cleanup deadline');
  } catch (error) {
    await terminateOwnedProcess(app.process(), timeoutMs);
    throw error; // Cleanup must not convert a failed close into a passing test.
  }
}
