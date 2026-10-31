import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

/** OS adapter for the shared stream endpoint. Never kill by executable name,
 * reused PID or a process discovered outside this launch. Rust owns its MCP
 * server group and must get time to reap it before escalation. */
export function launchPortableWorker({ executable, registry, channel = false, platform = process.platform }) {
  if (!['linux', 'darwin'].includes(platform)) throw Object.assign(new Error('MCP_PLATFORM_UNSUPPORTED'), { code: 'MCP_PLATFORM_UNSUPPORTED' });
  const env = channel && typeof process.env.HOME === 'string' ? { HOME: process.env.HOME } : {};
  if (channel && process.env.XDG_CONFIG_HOME) {
    const root = process.env.XDG_CONFIG_HOME;
    if (!isAbsolute(root) || /[\0\r\n]/.test(root) || Buffer.byteLength(root) > 4096) throw Object.assign(new Error('MCP_CONFIG'), { code: 'MCP_CONFIG' });
    // Go's os.UserConfigDir and `channel pending` use this same host setting.
    // Do not silently move channel state/model paths to HOME/.config instead.
    env.XDG_CONFIG_HOME = root;
  }
  const child = spawn(executable, channel ? ['channel-session'] : ['--session', registry], { stdio: ['pipe', 'pipe', 'pipe'], env, cwd: '/' });
  let exited = false, stopping = false, failure, escalation;
  child.on('error', error => { failure ??= error; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => {
    exited = true; clearTimeout(escalation); resolve({ pid: child.pid, code, signal, error: failure });
  }));
  return { child, closed, get error() { return failure; }, terminate() {
    if (exited || stopping) return;
    stopping = true;
    child.stdin.end();
    child.kill('SIGTERM');
    escalation = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 1500);
    escalation.unref();
  } };
}
