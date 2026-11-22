import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ComputerClient } from './computer-client.ts';

export const sshDestination = z.string().trim().regex(/^(?:[a-zA-Z0-9_.-]+@)?[a-zA-Z0-9][a-zA-Z0-9_.-]{0,252}$/, 'Enter a host or an alias from your SSH config.');
export const sshVncProfile = z.object({ host: sshDestination, port: z.number().int().min(1).max(65535) }).strict();
export type SshVncProfile = z.infer<typeof sshVncProfile>;

export const trustedSsh = [
  ...(process.env.PERO_SSH_CONFIG ? ['-F', process.env.PERO_SSH_CONFIG] : []),
  '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-o', 'NoHostAuthenticationForLocalhost=no',
  '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-o', 'ControlPath=none',
  '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2',
];

export const sshPath = z.string().min(2).max(1024).regex(/^\/[^\u0000-\u001f\u007f]+$/);
export const quoteSshArgument = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** An existing VNC server reached through a verified SSH host. */
export class SshDesktop {
  constructor(readonly profile: SshVncProfile) {}

  vnc() {
    return spawn('/usr/bin/ssh', [...trustedSsh, '-o', 'ClearAllForwardings=yes', '-W', `127.0.0.1:${this.profile.port}`,
      '--', this.profile.host], { stdio: 'pipe' });
  }

  async probe() {
    const child = this.vnc();
    let detail = '';
    child.stderr.on('data', data => { detail = (detail + data).slice(-512); });
    const closed = once(child, 'close');
    try {
      const greeting = await Promise.race([
        new Promise<string>((resolve, reject) => {
          let greeting = '';
          const deadline = AbortSignal.timeout(12_000);
          deadline.addEventListener('abort', () => reject(new Error('The SSH VNC server did not respond in time.')), { once: true });
          child.stdout.on('data', bytes => {
            greeting = (greeting + bytes).slice(0, 12);
            if (greeting.length === 12) resolve(greeting);
          });
        }),
        closed.then(() => { throw new Error(detail.trim() || 'SSH closed before the VNC server responded.'); }),
      ]);
      if (!/^RFB \d{3}\.\d{3}\n$/.test(greeting)) throw new Error('The forwarded port did not respond with a VNC greeting.');
    } finally {
      child.kill();
      await closed;
    }
  }
}

const exec = promisify(execFile);

/** A Pero desktop explicitly installed by the user on an SSH Host. */
export class SshManagedDesktop {
  readonly computer: ComputerClient;
  private readonly args: string[];

  constructor(host: string, launcher: string) {
    this.args = [...trustedSsh, '-o', 'ClearAllForwardings=yes', '--', host, quoteSshArgument(launcher)];
    this.computer = new ComputerClient('/usr/bin/ssh', [...this.args, 'computer']);
  }

  start() {
    return exec('/usr/bin/ssh', [...this.args, 'probe'], { timeout: 12_000, maxBuffer: 4096 });
  }

  idleInput() {
    return exec('/usr/bin/ssh', [...this.args, 'input-idle'], { timeout: 12_000, maxBuffer: 4096 });
  }

  vnc(control: boolean) {
    return spawn('/usr/bin/ssh', [...this.args, control ? 'control' : 'observe'], { stdio: 'pipe' });
  }
}
