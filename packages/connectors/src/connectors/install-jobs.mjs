// Background runner for managed installs. The page names a provider; the
// command is the Host-generated installer line, never page input. One job per
// provider, with a bounded log the page polls and can cancel.

import { spawn as nodeSpawn } from 'node:child_process';

const LOG_LIMIT = 16 * 1024;

export class InstallJobs {
  #jobs = new Map();
  #spawn;
  #onDone;
  #kill;
  #setTimer;
  #clearTimer;
  /** `onDone(providerId)` runs once per job that exits 0, after its state is final. */
  constructor({ spawn = nodeSpawn, env = process.env, onDone = () => {}, kill = process.kill.bind(process), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.#spawn = spawn; this.env = env; this.#onDone = onDone;
    this.#kill = kill; this.#setTimer = setTimer; this.#clearTimer = clearTimer;
  }

  /** Starts the job unless one is already running; returns the current snapshot either way. */
  start(providerId, command) {
    const running = this.#jobs.get(providerId);
    if (running?.state === 'running') return this.snapshot(providerId);
    const job = { state: 'running', log: '', exitCode: null, child: null, cancelling: false, timer: null };
    job.closed = new Promise(resolve => { job.resolveClosed = resolve; });
    this.#jobs.set(providerId, job);
    const append = chunk => { job.log = (job.log + chunk).slice(-LOG_LIMIT); };
    const finish = (state, exitCode) => {
      if (job.state !== 'running') return;
      if (job.cancelling) { this.#signal(job, 'SIGKILL'); state = 'cancelled'; }
      if (job.timer) this.#clearTimer(job.timer);
      job.state = state; job.exitCode = exitCode; job.child = null;
      Promise.resolve().then(() => state === 'done' ? this.#onDone(providerId) : undefined).catch(() => undefined).finally(job.resolveClosed);
    };
    try {
      job.child = this.#spawn('/bin/sh', ['-c', command], { detached: true, env: this.env, stdio: ['ignore', 'pipe', 'pipe'] });
      job.child.stdout?.on('data', append);
      job.child.stderr?.on('data', append);
      job.child.on('error', error => { append(`${error.message}\n`); finish('failed', null); });
      job.child.on('close', (code, signal) => finish(signal === 'SIGTERM' ? 'cancelled' : code === 0 ? 'done' : 'failed', code));
    } catch (error) { append(`${error.message}\n`); finish('failed', null); }
    return this.snapshot(providerId);
  }

  cancel(providerId) {
    const job = this.#jobs.get(providerId);
    if (job?.state === 'running' && !job.cancelling) {
      job.cancelling = true;
      this.#signal(job, 'SIGTERM');
      // Descendants may ignore TERM or keep the shell's pipes open. Escalate
      // the whole process group, even if its shell has already exited.
      if (job.state === 'running') {
        job.timer = this.#setTimer(() => this.#signal(job, 'SIGKILL'), 1500);
        job.timer?.unref?.();
      }
    }
    return this.snapshot(providerId);
  }

  #signal(job, signal) {
    if (!job.child?.pid) return;
    try { this.#kill(-job.child.pid, signal); }
    catch (error) {
      if (error.code !== 'ESRCH') job.log = (job.log + `${error.message}\n`).slice(-LOG_LIMIT);
    }
  }

  /** Providers with a job still running, for a page that returns mid-install. */
  running() { return [...this.#jobs].filter(([, job]) => job.state === 'running').map(([providerId]) => providerId); }

  snapshot(providerId) {
    const job = this.#jobs.get(providerId);
    return job ? { state: job.state, log: job.log, exitCode: job.exitCode } : null;
  }

  async close() {
    for (const id of this.running()) this.cancel(id);
    await Promise.all([...this.#jobs.values()].map(job => job.closed));
  }
}
