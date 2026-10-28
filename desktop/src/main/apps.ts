import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net } from 'electron';

// These are transport values, generated from the same contract as the Rust Host.
import type { AppAccess, AppRecord } from '../../../protocol/generated/host';

type Event = { version: number; kind: string; request_id: string | null; text: string; data?: unknown };
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

/** Desktop projection of Host-owned Apps. Tokens and installed paths stay here. */
export class DesktopApps {
  private pending = new Map<string, Pending>();

  constructor(
    private write: (request: object) => void,
    private send: (event: Event) => void,
    private choose: () => Promise<string | undefined>,
  ) {}

  accept(event: Event): boolean {
    if (event.kind !== 'apps_result') return false;
    const pending = this.pending.get(event.request_id || '');
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(event.request_id!);
      const result = event.data as { ok: boolean; value?: unknown; error?: string };
      if (result.ok) pending.resolve(result.value);
      else pending.reject(new Error(result.error || 'App request failed'));
    }
    return true; // Never forward private backend access descriptors to the renderer.
  }

  close() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('The local runtime stopped. Reopen Pero to retry.'));
    }
    this.pending.clear();
  }

  private request<T>(action: string, fields: Record<string, string> = {}): Promise<T> {
    const id = `apps-${randomUUID()}`;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The App request timed out. Check the App and retry.'));
      }, 15000);
      this.pending.set(id, { resolve: value => resolveRequest(value as T), reject, timer });
      try { this.write({ method: 'apps', id, action, ...fields }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async command(value: unknown): Promise<void> {
    try {
      const command = value as { action?: string; name?: string; panel?: string };
      const action = command?.action?.replace(/^apps_/, '');
      if (!['list', 'install', 'enable', 'disable', 'uninstall', 'open'].includes(action || '')) throw new Error('Unsupported App action');
      if (command.name !== undefined && (command.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(command.name))) throw new Error('Invalid App name');
      if (action === 'open') {
        if (!command.name) throw new Error('Choose an App first');
        const catalog = await this.request<AppRecord[]>('list');
        const record = catalog.find(app => app.name === command.name);
        const panel = record?.panels.find(panel => panel.id === (command.panel || record.panels[0]?.id));
        if (!record?.enabled || !panel) throw new Error('Enable the App before opening it');
        const access = await this.request<AppAccess>('resolve', { name: record.name });
        this.send({ version: 1, kind: 'apps_opened', request_id: null, text: '', data: {
          name: record.name, panel: panel.id, url: `pero-app://${record.name}/${access.entry}`,
        } });
        return;
      }
      let fields: Record<string, string> = {};
      if (action === 'install') {
        const path = await this.choose();
        if (!path) return;
        fields = { path };
      } else if (action !== 'list') {
        if (!command.name) throw new Error('Choose an App first');
        fields = { name: command.name };
      }
      const catalog = await this.request<AppRecord[]>(action!, fields);
      this.send({ version: 1, kind: 'apps_catalog', request_id: null, text: '', data: catalog });
    } catch (error) {
      this.send({ version: 1, kind: 'apps_error', request_id: null, text: (error as Error).message });
    }
  }

  /** App origins have no Electron preload. Their /api is always this App's backend. */
  async serve(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.hostname.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.hostname)) return new Response('Not found', { status: 404 });
      const origin = `pero-app://${url.host}`;
      const caller = request.headers.get('Origin');
      if (caller && caller !== origin) return new Response('App origin refused', { status: 403 });
      const access = await this.request<AppAccess>('resolve', { name: url.hostname });
      if (url.pathname.startsWith('/api/')) {
        if (!access.backend) return new Response('This App has no backend', { status: 503 });
        const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
        if (body && body.byteLength > 16 * 1024 * 1024) return new Response('Request too large', { status: 413 });
        const response = await net.fetch(`${access.backend.url}${url.pathname}${url.search}`, {
          method: request.method,
          headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': access.backend.token },
          body,
          redirect: 'error',
        });
        return new Response(response.body, { status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' } });
      }
      if (request.method !== 'GET') return new Response('Method refused', { status: 405 });
      const root = await realpath(access.root);
      const file = await realpath(resolve(root, '.' + decodeURIComponent(url.pathname)));
      const assets = resolve(root, dirname(access.entry));
      if (!file.startsWith(assets + sep) || !(await stat(file)).isFile()) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors pero://workbench");
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      return new Response((error as Error).message, { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  }
}
