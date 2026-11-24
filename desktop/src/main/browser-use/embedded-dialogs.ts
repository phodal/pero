import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { dialogRefusal, type BrowserDialog, type BrowserDialogAnswer } from './dialog.ts';
import { sendBrowserInput, type BrowserInput } from './input.ts';
import { captureBrowserDiagnostics, type BrowserDiagnosticOptions } from './diagnostics.ts';
import { ChromiumAccessibility } from './accessibility.ts';
import { ChromiumCdp } from './cdp.ts';
import type { CdpRequest } from './request.ts';

/** The debugger attachment belongs to one embedded-tab grant. */
export class EmbeddedDialogs {
  private enabled?: Promise<unknown>;
  private dialog?: { url: string; value: BrowserDialog };
  private dialogWaiters = new Set<() => void>();
  private pendingInput?: Promise<void>;
  private disposed = false;
  private accessibility?: ChromiumAccessibility;
  private cdpSession?: ChromiumCdp;

  constructor(private contents: WebContents, private changed: () => void) {}

  get available() { return !this.contents.debugger.isAttached() || !!this.enabled; }
  get isOpen() { return !!this.dialog; }

  async start() {
    if (this.disposed || this.contents.isDestroyed()) throw new Error('The authorized Web tab is unavailable.');
    if (!this.enabled) {
      const client = this.contents.debugger;
      if (client.isAttached()) throw new Error('DevTools already controls this tab.');
      client.attach('1.3');
      client.on('message', this.onMessage);
      client.once('detach', this.onDetach);
      this.enabled = client.sendCommand('Page.enable').catch(error => {
        this.detach();
        throw error;
      });
    }
    await this.enabled;
  }

  private onMessage = (_event: Electron.Event, method: string, params: Record<string, unknown>) => {
    if (method === 'Page.javascriptDialogOpening') {
      const { type, url, message } = params;
      if (type !== 'alert' && type !== 'confirm' && type !== 'prompt' && type !== 'beforeunload') return;
      this.dialog = { url: typeof url === 'string' ? url : '',
        value: { id: randomUUID(), type, message: typeof message === 'string' ? message.slice(0, 2048) : '' } };
      this.changed();
      for (const notify of this.dialogWaiters) notify();
    } else if (method === 'Page.javascriptDialogClosed') {
      this.dialog = undefined;
      this.changed();
    }
  };

  private onDetach = () => {
    this.enabled = undefined;
    this.accessibility = undefined;
    this.cdpSession?.invalidate();
    this.cdpSession = undefined;
    this.dialog = undefined;
    this.contents.debugger.off('message', this.onMessage);
    this.changed();
  };

  private detach() {
    if (!this.enabled || this.contents.isDestroyed()) return;
    const client = this.contents.debugger;
    client.off('detach', this.onDetach);
    this.onDetach();
    if (client.isAttached()) client.detach();
  }

  dispose() {
    this.disposed = true;
    this.detach();
  }

  current(approvedUrl: (url: string) => string | undefined) {
    return this.dialog && approvedUrl(this.dialog.url) ? this.dialog.value : undefined;
  }

  async handle(answer: BrowserDialogAnswer, approvedUrl: (url: string) => string | undefined) {
    const dialog = this.current(approvedUrl);
    const rejected = dialogRefusal(dialog, answer);
    if (rejected) return { rejected };
    await this.send('Page.handleJavaScriptDialog', { accept: answer.decision === 'accept',
      ...(answer.promptText !== undefined && { promptText: answer.promptText }) });
    if (this.dialog?.value === dialog) this.dialog = undefined;
    return null;
  }

  async untilDialog<T>(operation: () => Promise<T>) {
    if (this.dialog) return { dialogOpened: true } as const;
    let notify!: () => void;
    const opened = new Promise<{ dialogOpened: true }>(resolve => { notify = () => resolve({ dialogOpened: true }); });
    this.dialogWaiters.add(notify);
    try {
      return await Promise.race([operation().then(value => ({ value })), opened]);
    } finally {
      this.dialogWaiters.delete(notify);
    }
  }

  async drainInput() {
    const pending = this.pendingInput;
    if (pending && !this.dialog) await this.untilDialog(() => pending);
  }

  private get attached() {
    return !this.disposed && !!this.enabled && !this.contents.isDestroyed() && this.contents.debugger.isAttached();
  }

  send = async (method: string, params?: object) => {
    if (!this.attached) throw new Error('The authorized debugger session ended.');
    return this.contents.debugger.sendCommand(method, params);
  };

  private subscribe = (listener: (method: string, params: Record<string, unknown>) => void) => {
    const client = this.contents.debugger;
    const receive = (_event: Electron.Event, method: string, params: Record<string, unknown>) => listener(method, params);
    client.on('message', receive);
    return () => client.off('message', receive);
  };

  async diagnose(origin: string, options: BrowserDiagnosticOptions, check: () => void, signal: AbortSignal) {
    await this.start();
    await this.cdpSession?.stopCapture();
    return captureBrowserDiagnostics(origin, options, this.send, this.subscribe, check, signal);
  }

  async cdp(request: CdpRequest, document: string, origin: string, check: () => void, signal: AbortSignal) {
    await this.start();
    const session = this.cdpSession ??= new ChromiumCdp();
    const send = async (method: string, params?: Record<string, unknown>) => {
      if (this.cdpSession !== session) throw new Error('The authorized debugger session ended.');
      return this.send(method, params);
    };
    return session.call(request, document, origin, send, this.subscribe, () => {
      if (this.cdpSession !== session) throw new Error('The authorized debugger session ended.');
      check();
    }, signal);
  }

  clearCdp() {
    this.cdpSession?.invalidate();
  }

  async observeAX(origin: string, document: string, since: string | undefined, check: () => void) {
    await this.start();
    const accessibility = this.accessibility ??= new ChromiumAccessibility();
    return accessibility.observe(this.send, origin, document, since, () => {
      if (this.accessibility !== accessibility) throw new Error('The authorized debugger session ended.');
      check();
    });
  }

  async dispatch(input: BrowserInput) {
    await this.start();
    return this.untilDialog(() => {
      const sending = sendBrowserInput(this.send, () => this.attached, input);
      // Keep the original release pending until the renderer can finish it.
      const settled = sending.catch(() => {}).finally(() => {
        if (this.pendingInput === settled) this.pendingInput = undefined;
      });
      this.pendingInput = settled;
      return sending;
    });
  }
}
