import { randomUUID } from 'node:crypto';
import type { ComputerClient } from './computer-client.ts';
import { LinuxDesktopGuest } from './linux-desktop-guest.ts';
import { LinuxDesktopVnc } from './linux-desktop-vnc.ts';
import { SshDesktop, SshManagedDesktop, type SshVncProfile } from './ssh-desktop.ts';

export type LinuxDesktopPhase = 'stopped' | 'starting' | 'watching' | 'handoff' | 'controlling' | 'stopping' | 'failed';
export type LinuxDesktopState = {
  phase: LinuxDesktopPhase;
  endpoint?: string;
  attached: boolean;
  enabled: boolean;
  hasGuest: boolean;
  external?: SshVncProfile;
  remoteManaged: boolean;
  sharing: boolean;
  error?: string;
};
export type LinuxComputerRoute = { client: ComputerClient; signal: AbortSignal; attachment: string } | { reason: string };

/** The trusted desktop session owns which conversation and operator use the guest display. */
export class LinuxDesktop {
  private phase: LinuxDesktopPhase = 'stopped';
  private error?: string;
  private guest?: LinuxDesktopGuest | SshManagedDesktop;
  private external?: SshDesktop;
  private thread?: string;
  private attachment = '';
  private readonly disconnectedChats = new Set<string>();
  private input = new AbortController();
  private sharing = false;
  private monitor?: AbortController;
  private pending?: Promise<void>;

  constructor(readonly vnc: LinuxDesktopVnc, private enabled: () => boolean, private changed: () => void) {}

  get state(): LinuxDesktopState {
    return { phase: this.phase, endpoint: !this.sharing && (this.phase === 'watching' || this.phase === 'controlling') ? this.vnc.endpoint : undefined,
      attached: this.thread !== undefined, enabled: this.enabled(), hasGuest: !!this.guest,
      external: this.external?.profile, remoteManaged: this.guest instanceof SshManagedDesktop, sharing: this.sharing, error: this.error };
  }

  route(thread: string): LinuxComputerRoute | undefined {
    if (this.thread !== thread) return this.disconnectedChats.has(thread)
      ? { reason: 'This chat was disconnected from the Linux desktop. Connect it again from Workbench.' } : undefined;
    if (this.phase === 'watching' && this.guest) return { client: this.guest.computer, signal: this.input.signal, attachment: this.attachment };
    return { reason: this.phase === 'controlling' || this.phase === 'handoff'
      ? 'The user has control of the Linux desktop. Wait for control to be returned and observe again.'
      : 'The Linux desktop is unavailable. Reopen it from Workbench.' };
  }

  attach(thread: string) {
    if (!this.guest || this.phase !== 'watching') throw new Error('Start the Linux desktop and return any active manual control first.');
    if (!this.enabled()) throw new Error('Enable Computer Use before connecting a chat.');
    if (this.thread && this.thread !== thread) throw new Error('Disconnect the current chat before connecting another.');
    this.disconnectedChats.delete(thread);
    if (this.thread !== thread) this.attachment = randomUUID();
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

  start(remote?: { host: string; launcher: string }) {
    if (this.guest || this.external) throw new Error('Close the current Linux desktop before starting another.');
    return this.transition('starting', async () => {
      const guest = this.guest = remote ? new SshManagedDesktop(remote.host, remote.launcher) : new LinuxDesktopGuest();
      try { await guest.start(); }
      catch (error) {
        if (guest instanceof LinuxDesktopGuest) await guest.stop();
        this.guest = undefined;
        throw error;
      }
      this.input = new AbortController();
      this.vnc.expose(guest, false);
      this.phase = 'watching';
      if (guest instanceof SshManagedDesktop) return;
      const monitor = this.monitor = new AbortController();
      void guest.wait(monitor.signal).catch(() => {}).then(async () => {
        if (monitor.signal.aborted) return;
        // Exit can happen during a handoff. Wait for its owner to finish before changing phase.
        await this.pending;
        if (monitor.signal.aborted) return;
        this.input.abort();
        this.sharing = false;
        this.phase = 'failed';
        this.error = 'The Linux desktop connection ended. Stop it, then start a new desktop.';
        this.changed();
        await this.vnc.revoke();
        this.changed();
      });
    });
  }

  connect(profile: SshVncProfile) {
    if (this.guest || this.external) throw new Error('Close the current Linux desktop before opening another.');
    return this.transition('starting', async () => {
      const external = new SshDesktop(profile);
      await external.probe();
      this.external = external;
      this.vnc.expose(external, true);
      this.phase = 'controlling';
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

  async share() {
    const guest = this.guest;
    const phase = this.phase;
    if (!guest || this.sharing || (phase !== 'watching' && phase !== 'controlling'))
      throw new Error('Open a managed Linux desktop to share it.');
    const control = phase === 'controlling';
    await this.transition('handoff', async () => {
      await this.vnc.revoke();
      if (control) await guest.idleInput();
      this.vnc.expose(guest, control);
      this.sharing = true;
      this.phase = phase;
    });
    if (!this.sharing || !this.vnc.endpoint) throw new Error(this.error || 'Cannot share Linux desktop.');
    return { endpoint: this.vnc.endpoint, viewOnly: !control };
  }

  async endShare() {
    await this.pending;
    if (!this.sharing) return;
    this.sharing = false;
    const guest = this.guest;
    if (!guest) return;
    if (this.phase === 'controlling') { await this.handoff(false); return; }
    if (this.phase === 'watching') {
      await this.transition('handoff', async () => {
        await this.vnc.revoke();
        this.vnc.expose(guest, false);
        this.phase = 'watching';
      });
    }
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
    if (this.sharing) { await this.endShare(); return; }
    if (this.external) await this.stop();
    else if (this.phase === 'controlling') await this.handoff(false);
  }

  async stop() {
    await this.pending;
    if (this.phase === 'stopping') return this.pending;
    if (this.external) {
      return this.transition('stopping', async () => {
        await this.vnc.revoke();
        this.external = undefined;
        this.phase = 'stopped';
      });
    }
    const guest = this.guest;
    if (!guest) return;
    this.input.abort();
    this.monitor?.abort();
    this.sharing = false;
    await this.transition('stopping', async () => {
      // Removal releases the display and all of its in-guest processes, even if a tool or transport failed.
      await Promise.all([this.vnc.revoke(), guest instanceof LinuxDesktopGuest ? guest.stop() : undefined]);
      await guest.computer.stop();
      this.guest = undefined;
      this.phase = 'stopped';
    });
  }
}
