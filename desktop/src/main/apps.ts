import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net } from 'electron';
import { readPointApp, pointTarget, pointHeaders, pointWrites, appProxyHeaders } from './point-apps.ts';
import { PreparedAppWrite, type AppWriteDefinition } from './app-write.ts';

// These are transport values, generated from the same contract as the Rust Host.
import type { AppAccess, AppRecord } from '../../../protocol/generated/host';

type Event = { version: number; kind: string; request_id: string | null; text: string; data?: unknown };
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

/** Desktop projection of Host-owned Apps. Tokens and installed paths stay here. */
export class DesktopApps {
  private pending = new Map<string, Pending>();
  installedRoot?: string;
  connectors?: (request: Record<string, unknown>) => Promise<unknown>;

  async requireConnectorsGrant(name = 'connectors'): Promise<void> {
    await this.request('connectors', { name });
  }

  constructor(
    private write: (request: object) => void,
    private send: (event: Event) => void,
    private choose: () => Promise<string | undefined>,
    private input?: (app:string,token:string)=>Promise<{data:Buffer;name:string;mediaType:string}>,
    private onAgentCancel?: (sessionId: string) => void,
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

  private request<T>(action: string, fields: Record<string, unknown> = {}): Promise<T> {
    const id = `apps-${randomUUID()}`;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The App request timed out. Check the App and retry.'));
      }, 660000);
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
          name: record.name, panel: panel.id, url: `pero-app://${record.name}/${panel.entry}`,
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

  async describeWrites():Promise<AppWriteDefinition[]>{
    const records=await this.request<AppRecord[]>('list');
    const routes: AppWriteDefinition[] = [];
    for (const record of records.filter(record => record.enabled)) {
      routes.push(...(record.writes || []).map(route => ({ app: record.name, panel: record.panels[0].id, version: record.version, ...route })));
      const point = this.installedRoot ? await readPointApp(resolve(this.installedRoot, record.name)) : null;
      if (point) routes.push(...pointWrites(point, record.panels[0].id));
    }
    return routes;
  }
  async applyWrite(prepared:PreparedAppWrite,signal:AbortSignal,goal?:import('./control-lab-goal.ts').ControlLabGoal):Promise<unknown>{
    const route=prepared.definition;prepared.requireCurrent((await this.describeWrites()).find(current=>current.app===route.app&&current.name===route.name));
    const access=await this.request<AppAccess>('resolve',{name:route.app});
    if(!access.backend)throw new Error('The App write backend is unavailable');
    if(route.app==='control-lab'&&route.path==='/api/agent-step'&&!goal)throw new Error('Control Lab goal is required');
    const body=goal?{...(prepared.document as Record<string,unknown>),specHash:goal.specHash}:prepared.document;
    const point = await readPointApp(access.root);
    const encoded = JSON.stringify(body), method = route.method || 'POST';
    const headers = point ? pointHeaders(access.backend.token, method, pointTarget(point, `/apps/${route.app}${route.path}`), Buffer.from(encoded)) : { 'X-Pero-App-Token': access.backend.token };
    const response=await net.fetch(access.backend.url+route.path,{method,headers:{'Content-Type':'application/json',...headers},body:encoded,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
    const text=await response.text();if(Buffer.byteLength(text)>1000000)throw new Error('App write response exceeds 1 MiB');
    if(!response.ok)throw new Error(text.slice(0,1000)||`App write failed (${response.status})`);
    const value=JSON.parse(text);this.send({version:1,kind:'app_written',request_id:null,text:'',data:{app:route.app,tool:route.name,digest:prepared.digest}});return value;
  }

  /** App origins have no Electron preload. Their /api is always this App's backend. */
  async serve(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.hostname.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.hostname)) return new Response('Not found', { status: 404 });
      const origin = `pero-app://${url.host}`;
      const caller = request.headers.get('Origin');
      if (caller && caller !== origin) return new Response('App origin refused', { status: 403 });
      if (url.hostname === 'control-lab' && url.pathname === '/api/agent-step')
        return new Response('Agent route is reserved for the Host', { status: 403 });
      if(url.pathname.startsWith('/host/inputs/')){
        if(request.method!=='GET'||!this.input||!/^\/host\/inputs\/[a-f0-9]{64}$/.test(url.pathname))return new Response('App input unavailable',{status:404});
        const file=await this.input(url.hostname,url.pathname.split('/').at(-1)!);
        return new Response(new Uint8Array(file.data),{headers:{'Content-Type':file.mediaType,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase())}`,'Cache-Control':'no-store'}});
      }
      if (url.pathname === '/host/connectors') {
        if (request.method !== 'POST') return new Response('Method refused', { status: 405 });
        await this.requireConnectorsGrant(url.hostname);
        if (!this.connectors) return Response.json({ ok: false, code: 'MCP_HOST_UNAVAILABLE' }, { status: 503 });
        const body = await request.text();
        if (Buffer.byteLength(body) > 131072) return new Response('Request too large', { status: 413 });
        return Response.json(await this.connectors(JSON.parse(body)), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/host/insights') {
        if (request.method !== 'POST') return new Response('Method refused', { status: 405 });
        const body = await request.text();
        if (Buffer.byteLength(body) > 4096) return new Response('Request too large', { status: 413 });
        const operation = body ? JSON.parse(body) as { threadId?: string } : {};
        const fields: Record<string, unknown> = { name: url.hostname };
        if (operation.threadId) fields.threadId = operation.threadId;
        return Response.json(await this.request('insights', fields), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/host/agent') {
        if (request.method !== 'POST') return new Response('Method refused', { status: 405 });
        const body = await request.text();
        if (Buffer.byteLength(body) > 256_000) return new Response('Research request too large', { status: 413 });
        const operation = JSON.parse(body);
        const result = await this.request<{ cancelled?: boolean }>('agent', { name: url.hostname, request: operation });
        if (operation.operation === 'cancel' && result.cancelled === true)
          this.onAgentCancel?.(operation.sessionId);
        return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
      }
      const access = await this.request<AppAccess>('resolve', { name: url.hostname });
      const point = await readPointApp(access.root);
      if (point && url.pathname === `/api/apps/${url.hostname}/config`) {
        if (!point.permissions?.storage || !point.permissions.api?.includes(url.pathname)) return new Response('App storage denied', { status: 403 });
        if (!['GET', 'PUT'].includes(request.method)) return new Response('Method refused', { status: 405 });
        const fields: Record<string, unknown> = { name: url.hostname };
        if (request.method === 'PUT') {
          const body = await request.text();
          if (Buffer.byteLength(body) > 1048576) return new Response('Config exceeds 1 MiB', { status: 400 });
          const config = JSON.parse(body);
          if (!config || typeof config !== 'object' || Array.isArray(config)) return new Response('Config must be an object', { status: 400 });
          fields.config = config;
        }
        const value = await this.request<{ config: Record<string, unknown> }>('pointconfig', fields);
        return Response.json(value.config, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname.startsWith('/api/') || point && url.pathname.startsWith(`/apps/${url.hostname}/api/`)) {
        if (!access.backend) return new Response('This App has no backend', { status: 503 });
        const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
        if (body && body.byteLength > (point ? point.backend?.maxBodyBytes ?? 1048576 : 16 * 1024 * 1024)) return new Response('Request too large', { status: 413 });
        const target = point ? pointTarget(point, url.pathname + url.search) : url.pathname + url.search;
        const authentication = point ? pointHeaders(access.backend.token, request.method, target, body ? new Uint8Array(body) : undefined) : { 'X-Pero-App-Token': access.backend.token };
        const forwarded = point ? appProxyHeaders(request.headers) : new Headers({'Content-Type':request.headers.get('Content-Type') || 'application/json'});
        for (const [key, value] of Object.entries(authentication)) forwarded.set(key, value);
        const response = await net.fetch(`${access.backend.url}${target}`, {
          method: request.method,
          headers: forwarded,
          body,
          redirect: 'error',
        });
        const headers = appProxyHeaders(response.headers, true);
        if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
        return new Response(response.body, { status: response.status, headers });
      }
      if (request.method !== 'GET') return new Response('Method refused', { status: 405 });
      const root = await realpath(access.root);
      const file = await realpath(resolve(root, '.' + decodeURIComponent(url.pathname)));
      const assets = resolve(root, dirname(access.entry));
      if (!file.startsWith(assets + sep) || !(await stat(file)).isFile()) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      const ancestors = file === resolve(assets, '_reader/reader.html') ? "'self' pero://workbench" : 'pero://workbench';
      headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors ${ancestors}`);
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      return new Response((error as Error).message, { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  }
}
