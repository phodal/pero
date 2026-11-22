import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { ComputerClient } from './computer-client.ts';

const exec = promisify(execFile);
const guestEntry = '/usr/local/bin/pero-desktop';

/** A disposable Linux desktop attached to one explicitly chosen Docker engine. */
export class LinuxDesktopGuest {
  private readonly name = `pero-linux-desktop-${randomUUID()}`;
  private readonly binary: string;
  private readonly engine: string;
  private readonly image = process.env.PERO_REMOTE_DESKTOP_IMAGE || 'pero/linux-desktop:dev';
  readonly computer: ComputerClient;

  constructor() {
    const socket = process.env.PERO_REMOTE_DESKTOP_DOCKER_SOCKET || join(homedir(), '.colima/pero-remote-desktop/docker.sock');
    if (!isAbsolute(socket) || !existsSync(socket)) throw new Error('The Linux desktop Docker socket is unavailable. Start the pero-remote-desktop Colima profile or configure PERO_REMOTE_DESKTOP_DOCKER_SOCKET.');
    this.engine = `unix://${socket}`;
    this.binary = process.env.PERO_REMOTE_DESKTOP_DOCKER || ['/opt/homebrew/bin/docker', '/usr/local/bin/docker', '/usr/bin/docker'].find(existsSync) || 'docker';
    this.computer = new ComputerClient(this.binary, ['--host', this.engine, 'exec', '-i', this.name, guestEntry, 'computer']);
  }

  private run(args: string[], signal?: AbortSignal) {
    return exec(this.binary, ['--host', this.engine, ...args], { signal, timeout: 10_000, maxBuffer: 64 * 1024 });
  }

  async start() {
    const { stdout } = await this.run(['image', 'inspect', '--format', '{{.Id}}', this.image]).catch(() => {
      throw new Error(`Docker cannot open ${this.image}. Build the Linux desktop image in this Docker engine and retry.`);
    });
    await this.run(['run', '--detach', '--rm', '--init', '--pull', 'never', '--name', this.name,
      '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', stdout.trim()]);
    const deadline = AbortSignal.timeout(12_000);
    while (!deadline.aborted) {
      try { await this.run(['exec', this.name, guestEntry, 'probe'], deadline); return; }
      catch { await delay(150); }
    }
    const logs = await this.run(['logs', '--tail', '8', this.name]).catch(() => undefined);
    throw new Error(`The Linux desktop did not become ready.${logs?.stderr ? ` ${logs.stderr.trim().slice(-800)}` : ''}`);
  }

  wait(signal: AbortSignal) {
    // No CLI deadline here. The process reports the container's actual exit.
    return exec(this.binary, ['--host', this.engine, 'wait', this.name], { signal, maxBuffer: 4096 });
  }

  idleInput() { return this.run(['exec', this.name, guestEntry, 'input-idle']); }

  vnc(control: boolean) {
    return spawn(this.binary, ['--host', this.engine, 'exec', '-i', this.name, guestEntry, control ? 'control' : 'observe'],
      { stdio: 'pipe' });
  }

  async stop() {
    try { await this.run(['rm', '--force', this.name]); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes(`No such container: ${this.name}`)) throw error;
    }
  }
}
