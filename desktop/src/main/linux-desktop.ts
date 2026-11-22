import type { ComputerClient } from './computer-client.ts';
import { LinuxDesktopGuest } from './linux-desktop-guest.ts';
import { LinuxDesktopVnc } from './linux-desktop-vnc.ts';

export type LinuxDesktopPhase = 'stopped' | 'starting' | 'watching' | 'handoff' | 'controlling' | 'stopping' | 'failed';
export type LinuxDesktopState = {
  phase: LinuxDesktopPhase;
  endpoint?: string;
  attached: boolean;
  enabled: boolean;
  hasGuest: boolean;
  error?: string;
};
export type LinuxComputerRoute = { client: ComputerClient; signal: AbortSignal } | { reason: string };

/** The trusted desktop session owns which conversation and operator use the guest display. */
export class LinuxDesktop {
  private phase: LinuxDesktopPhase = 'stopped';
  private error?: string;
  private guest?: LinuxDesktopGuest;
  private thread?: string;
  private readonly disconnectedChats = new Set<string>();
  private input = new AbortController();
  private monitor?: AbortController;
  private pending?: Promise<void>;

  constructor(readonly vnc: LinuxDesktopVnc, private enabled: () => boolean, private changed: () => void) {}

  get state(): LinuxDesktopState {
    return { phase: this.phase, endpoint: this.phase === 'watching' || this.phase === 'controlling' ? this.vnc.endpoint : undefined,
      attached: this.thread !== undefined, enabled: this.enabled(), hasGuest: !!this.guest, error: this.error };
  }

  route(thread: string): LinuxComputerRoute | undefined {
    if (this.thread !== thread) return this.disconnectedChats.has(thread)
      ? { reason: 'This chat was disconnected from the Linux desktop. Connect it again from Workbench.' } : undefined;
    if (this.phase === 'watching' && this.guest) return { client: this.guest.computer, signal: this.input.signal };
    return { reason: this.phase === 'controlling' || this.phase === 'handoff'
      ? 'The user has control of the Linux desktop. Wait for control to be returned and observe again.'
      : 'The Linux desktop is unavailable. Reopen it from Workbench.' };
  }

  attach(thread: string) {
    if (!this.guest || this.phase !== 'watching') throw new Error('Start the Linux desktop and return any active manual control first.');
    if (!this.enabled()) throw new Error('Enable Computer Use before connecting a chat.');
    if (this.thread && this.thread !== thread) throw new Error('Disconnect the current chat before connecting another.');
    this.disconnectedChats.delete(thread);
    this.thread = thread;
    this.changed();
  }

  private transition(phase: LinuxDesktopPhase, operation: () => Promise<void>) {
    if (this.pending) throw new Error('The Linux desktop is already changing state.');
    this.phase = phase;
    this.error = undefined;
    const pending = Promise.resolve().then(operation).catch(error => {
      this.phase = 'failed';
      this.error = error instanceof Error ? error.message : String(error);
    }).finally(() => { this.pending = undefined; this.changed(); });
    this.pending = pending;
    this.changed();
    return pending;
  }

  start() {
    if (this.guest) throw new Error('Stop the current Linux desktop before starting another.');
    return this.transition('starting', async () => {
      const guest = this.guest = new LinuxDesktopGuest();
      try { await guest.start(); }
      catch (error) {
        await guest.stop();
        this.guest = undefined;
        throw error;
      }
      this.input = new AbortController();
      this.vnc.expose(guest, false);
      this.phase = 'watching';
      const monitor = this.monitor = new AbortController();
      void guest.wait(monitor.signal).catch(() => {}).then(async () => {
        if (monitor.signal.aborted) return;
        // Exit can happen during a handoff. Wait for its owner to finish before changing phase.
        await this.pending;
        if (monitor.signal.aborted) return;
        this.input.abort();
        this.phase = 'failed';
        this.error = 'The Linux desktop connection ended. Stop it, then start a new desktop.';
        this.changed();
        await this.vnc.revoke();
        this.changed();
      });
    });
  }

  handoff(control: boolean) {
    const guest = this.guest;
    if (!guest || this.phase !== (control ? 'watching' : 'controlling')) throw new Error('The Linux desktop is not ready to change control.');
    this.input.abort();
    return this.transition('handoff', async () => {
      await this.vnc.revoke();
      await guest.computer.stop();
      await guest.idleInput();
      this.input = new AbortController();
      this.vnc.expose(guest, control);
      this.phase = control ? 'controlling' : 'watching';
    });
  }

  async detach() {
    const thread = this.thread;
    if (!thread) return;
    await this.pending;
    this.input.abort();
    await this.guest?.computer.stop();
    this.disconnectedChats.add(thread);
    this.thread = undefined;
    this.input = new AbortController();
    this.changed();
  }

  async forget(thread: string) {
    if (this.thread === thread) await this.detach();
    this.disconnectedChats.delete(thread);
  }

  async returnControl() {
    await this.pending;
    if (this.phase === 'controlling') await this.handoff(false);
  }

  async stop() {
    await this.pending;
    if (this.phase === 'stopping') return this.pending;
    const guest = this.guest;
    if (!guest) return;
    this.input.abort();
    this.monitor?.abort();
    await this.transition('stopping', async () => {
      // Removal releases the display and all of its in-guest processes, even if a tool or transport failed.
      await Promise.all([this.vnc.revoke(), guest.stop()]);
      await guest.computer.stop();
      this.guest = undefined;
      this.phase = 'stopped';
    });
  }
}
