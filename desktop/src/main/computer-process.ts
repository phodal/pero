import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

export interface ComputerProcess {
  input: Writable;
  output: Readable;
  exited: Promise<void>;
  kill(): void;
}

export async function startComputerProcess(binary: string, args: string[], signal: AbortSignal): Promise<ComputerProcess> {
  signal.throwIfAborted();
  if (process.platform === 'darwin' && binary.endsWith('.app')) return startMacBundle(binary, signal);
  const child = spawn(binary, args, { stdio: 'pipe', env: { ...process.env, PERO_COMPUTER_HOST_PID: String(process.pid) } });
  child.stderr.on('data', data => console.error(String(data)));
  child.stdin.on('error', () => {}); // Failed writes surface through their callback.
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
  try {
    await once(child, 'spawn', { signal });
  } catch (error) {
    child.kill();
    await exited;
    throw error;
  }
  child.on('error', error => console.error(error.message));
  return { input: child.stdin, output: child.stdout, exited, kill: () => { child.kill('SIGKILL'); } };
}

async function startMacBundle(bundle: string, signal: AbortSignal): Promise<ComputerProcess> {
  // Darwin socket paths have a short byte limit. mkdtemp gives the listener a
  // unique, owner-only directory and the launched helper dials that exact path.
  const directory = await mkdtemp('/tmp/pero-computer-');
  const path = join(directory, 'worker.sock');
  const startup = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
  const server = createServer({ allowHalfOpen: true });
  let socket: Socket | undefined;
  try {
    server.listen(path);
    await once(server, 'listening', { signal: startup });
    const connected = once(server, 'connection', { signal: startup });
    const launcher = spawn('/usr/bin/open', ['-n', '-W', '-j', '-g', '-a', bundle, '--args', '--socket', path, String(process.pid)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    launcher.stderr.on('data', data => console.error(String(data)));
    launcher.on('error', error => console.error(error.message));
    const exited = new Promise<void>(resolve => launcher.once('close', () => resolve()));
    const closedEarly = exited.then(() => { throw new Error('The macOS Computer Use app exited during startup'); });
    try {
      [socket] = await Promise.race([connected, closedEarly]);
      server.close();
      const peer = socket!;
      peer.on('error', () => {});
      let greeting = '';
      for (;;) {
        const [chunk] = await Promise.race([once(peer, 'data', { signal: startup }), closedEarly]);
        greeting += String(chunk);
        if (greeting.length > 16) throw new Error('Invalid Computer Use app greeting');
        if (greeting.endsWith('\n')) break;
      }
      const pid = Number(greeting.trim());
      if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid Computer Use app process ID');
      return {
        input: peer, output: peer, exited,
        kill: () => {
          try { process.kill(pid, 'SIGKILL'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error(error); }
        },
      };
    } catch (error) {
      socket?.destroy();
      launcher.kill();
      throw error;
    }
  } finally {
    server.close();
    await rm(directory, { force: true, recursive: true });
  }
}
