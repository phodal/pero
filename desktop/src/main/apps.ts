import { DoclingSetup, doclingInput, doclingStatus } from './docling-runtime.ts';
import { randomUUID } from 'node:crypto';
import { environmentInspectionInput } from './environment-inspection.ts';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net } from 'electron';
import { AppWriteRoutes } from './app-write-routes.ts';
import { PreparedAppWrite, type AppWriteDefinition } from './app-write.ts';

// These are transport values, generated from the same contract as the Rust Host.
import type { AppAccess, AppRecord, ArtifactSnapshot, ProjectResourceCatalog } from '../../../protocol/generated/host';

type Event = { version: number; kind: string; request_id: string | null; text: string; data?: unknown };
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

type ReproductionIds = Readonly<{ itemId: string; specId: string; requestId: string }>;
type ReproductionInput = ReproductionIds & { operation: 'request' | 'cancel' };
type ReproductionPrompt = { ticket: string; bindingDigest: string; summary: string };
type ReproductionPending = {
  ids: ReproductionIds;
  controller: AbortController;
  prompt?: ReproductionPrompt;
  decision?: Promise<unknown>;
  result: Promise<unknown>;
};

function reproductionInput(value: unknown): ReproductionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid reproduction request');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 4 || !Object.keys(raw).every(key => ['operation', 'itemId', 'specId', 'requestId'].includes(key)) ||
      !['request', 'cancel'].includes(raw.operation as string) ||
      !['itemId', 'specId'].every(key => typeof raw[key] === 'string' && /^[a-f0-9]{64}$/.test(raw[key] as string)) ||
      typeof raw.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(raw.requestId))
    throw new Error('Expected frozen item, specification and request identities');
  return raw as ReproductionInput;
}

// This route is a public status view, never a channel for Host capabilities.
function reproductionStatus(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid reproduction status');
  const raw = value as Record<string, unknown>;
  return Object.fromEntries(['state', 'status', 'itemId', 'specId', 'requestId', 'attemptId', 'paperVerdict', 'reason']
    .filter(key => typeof raw[key] === 'string').map(key => [key, raw[key]]));
}

/** Desktop projection of Host-owned Apps. Tokens and installed paths stay here. */
export class DesktopApps {
  private pending = new Map<string, Pending>();
  private reproductions = new Map<string, ReproductionPending>();
  private docling: DoclingSetup;
  connectors?: (request: Record<string, unknown>) => Promise<unknown>;
  artifactSnapshot?: (thread: string, artifact: string, version: number, signal: AbortSignal) => Promise<ArtifactSnapshot>;

  async requireConnectorsGrant(name = 'connectors'): Promise<void> {
    await this.request('connectors', { name });
  }

  constructor(
    private write: (request: object) => void,
    private send: (event: Event) => void,
    private choose: () => Promise<string | undefined>,
    private input?: (app:string,token:string)=>Promise<{data:Buffer;name:string;mediaType:string}>,
    private onAgentCancel?: (sessionId: string) => void,
    private confirmReproduction?: (summary: string, signal: AbortSignal) => Promise<boolean>,
    confirmDocling?: (summary: string, signal: AbortSignal, operation?: 'install' | 'revoke') => Promise<boolean>,
  ) { this.docling = new DoclingSetup(request => this.request('doclingruntime', { name: 'paper-agent', request }), confirmDocling); }

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
    this.docling.close();
    for (const operation of this.reproductions.values()) operation.controller.abort();
    this.reproductions.clear();
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

  private async reproduction(input: ReproductionInput): Promise<unknown> {
    const { operation, ...ids } = input;
    const active = this.reproductions.get(ids.requestId);
    if (active && (active.ids.itemId !== ids.itemId || active.ids.specId !== ids.specId))
      throw new Error('Request identity belongs to another frozen item');
    if (operation === 'cancel') {
      active?.controller.abort();
      if (active?.prompt && !active.decision) return this.decideReproduction(active, false);
      return this.request('reproduction', { name: 'paper-agent', request: { operation: 'cancel', ...ids } });
    }
    if (active) return active.result;
    if (!this.confirmReproduction) throw new Error('Native reproduction approval is unavailable');
    const pending: ReproductionPending = { ids, controller: new AbortController(), result: Promise.resolve() };
    this.reproductions.set(ids.requestId, pending);
    pending.result = Promise.resolve().then(async () => {
      const prepared = await this.request<Record<string, unknown>>('reproduction', {
        name: 'paper-agent', request: { operation: 'prepare', ...ids },
      });
      if (prepared.state !== 'requires-approval') return prepared;
      if (typeof prepared.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(prepared.ticket) ||
          typeof prepared.bindingDigest !== 'string' || !/^[a-f0-9]{64}$/.test(prepared.bindingDigest) ||
          typeof prepared.summary !== 'string' || !prepared.summary || prepared.summary.length > 12000)
        throw new Error('Invalid Host reproduction approval');
      pending.prompt = { ticket: prepared.ticket, bindingDigest: prepared.bindingDigest, summary: prepared.summary };
      const signal = pending.controller.signal;
      if (signal.aborted) return this.decideReproduction(pending, false);
      let stop: () => void = () => {};
      const cancelled = new Promise<boolean>(resolve => {
        stop = () => resolve(false);
        signal.addEventListener('abort', stop, { once: true });
      });
      let allowed = false;
      try { allowed = await Promise.race([this.confirmReproduction!(pending.prompt.summary, signal), cancelled]); }
      catch { allowed = false; }
      finally { signal.removeEventListener('abort', stop); }
      return this.decideReproduction(pending, allowed && !signal.aborted);
    }).finally(() => {
      if (this.reproductions.get(ids.requestId) === pending) this.reproductions.delete(ids.requestId);
    });
    return pending.result;
  }

  private decideReproduction(pending: ReproductionPending, allowed: boolean): Promise<unknown> {
    if (!pending.decision) {
      const { ticket, bindingDigest } = pending.prompt!;
      pending.decision = this.request('reproduction', { name: 'paper-agent', request: {
        operation: 'decide', ...pending.ids, ticket, bindingDigest,
        decision: allowed && !pending.controller.signal.aborted ? 'allow' : 'deny',
      } });
    }
    return pending.decision;
  }

  async command(value: unknown): Promise<void> {
    const command = value as { action?: string; name?: string; panel?: string; request_id?: string };
    if (command?.action === 'apps_project_resources') {
      const app = typeof command.name === 'string' ? command.name : '';
      const request_id = typeof command.request_id === 'string' ? command.request_id : null;
      let catalog: ProjectResourceCatalog;
      try {
        if (!['paper-agent', 'control-lab', 'lab'].includes(app)) throw new Error('This App has no project resource catalog');
        catalog = await this.request<ProjectResourceCatalog>('projectresources', { name: app });
      } catch (error) {
        catalog = { app, resources: [], error: (error as Error).message };
      }
      this.send({ version: 1, kind: 'project_resources', request_id, text: '', data: catalog });
      return;
    }
    try {
      const action = command?.action?.replace(/^apps_/, '');
      if (!['list', 'install', 'prepare', 'enable', 'disable', 'uninstall', 'open'].includes(action || '')) throw new Error('Unsupported App action');
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

  async describeWrites():Promise<AppWriteDefinition[]>{ return this.writeRoutes().describe(); }
  async applyWrite(prepared:PreparedAppWrite,signal:AbortSignal,goal?:import('./control-lab-goal.ts').ControlLabGoal):Promise<unknown>{ return this.writeRoutes().apply(prepared,signal,goal); }
  private writeRoutes() { return new AppWriteRoutes((action, fields) => this.request(action, fields), this.send, net.fetch); }

  /** App origins have no Electron preload. Their /api is always this App's backend. */
  async serve(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.hostname.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.hostname)) return new Response('Not found', { status: 404 });
      const origin = `pero-app://${url.host}`;
      const caller = request.headers.get('Origin');
      if (caller && caller !== origin) return new Response('App origin refused', { status: 403 });
      if (url.pathname.startsWith('/host/artifacts/')) {
        if (url.hostname !== 'scientific-viewer' || !this.artifactSnapshot) return new Response('Artifact preview unavailable', { status: 404 });
        if (request.method !== 'GET' || url.search) return new Response('Method refused', { status: 405 });
        const match = /^\/host\/artifacts\/([^/]+)\/([^/]+)\/([1-9][0-9]*)$/.exec(url.pathname);
        if (!match || !Number.isSafeInteger(Number(match[3]))) return new Response('Invalid artifact reference', { status: 400 });
        await this.request('sdkcontext', { name: url.hostname });
        const snapshot = await this.artifactSnapshot(decodeURIComponent(match[1]), decodeURIComponent(match[2]), Number(match[3]), request.signal);
        const media = snapshot.media;
        const contentType = media.kind === 'image' ? media.mime_type : media.kind === 'pdf' ? 'application/pdf'
          : media.kind === 'html' ? 'text/html;charset=utf-8' : media.kind === 'notebook' ? 'application/x-ipynb+json'
          : media.kind === 'csv' ? 'text/csv;charset=utf-8' : media.kind === 'tsv' ? 'text/tab-separated-values;charset=utf-8'
          : media.kind === 'document' && media.format.kind === 'json' ? 'application/json'
          : media.kind === 'document' && media.format.kind === 'json_lines' ? 'application/x-ndjson'
          : media.kind === 'document' && media.format.kind === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
        return new Response(new Uint8Array(await readFile(snapshot.path)), { headers: {
          'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:",
          'X-Pero-Artifact-Name': encodeURIComponent(snapshot.filename),
          'X-Pero-Artifact-Sha256': snapshot.sha256, 'X-Pero-Artifact-Kind': media.kind,
        } });
      }
      if ((url.hostname === 'control-lab' || url.hostname === 'lab') && decodeURIComponent(url.pathname) === '/api/agent-step')
        return new Response('Agent route is reserved for the Host', { status: 403 });
      if (url.pathname === '/host/environment/profiles') {
        if (request.method !== 'POST') return new Response('Method refused', {status:405});
        const body=await request.text();
        if (Buffer.byteLength(body)>4096) return new Response('Request too large',{status:413});
        let input: unknown;
        try { input=JSON.parse(body); } catch { return new Response('Invalid request',{status:400}); }
        return Response.json(await this.request('localenvironment',{name:url.hostname,request:input}),{headers:{'Cache-Control':'no-store'}});
      }
      if (url.pathname === '/host/environment') {
        if (request.method !== 'POST') return new Response('Method refused', { status: 405 });
        const body = await request.text();
        if (Buffer.byteLength(body) > 4096) return new Response('Request too large', { status: 413 });
        let input: { target: string };
        try { input = environmentInspectionInput(JSON.parse(body)); }
        catch { return new Response('Expected only a scientific method', { status: 400 }); }
        const value = await this.request('environment', { name: url.hostname, target: input.target });
        return Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/host/sdk') {
        if (request.method !== 'GET') return new Response('Method refused', {status:405});
        return Response.json({...await this.request<Record<string,unknown>>('sdkcontext', {name:url.hostname}),slots:['conversation']}, {headers:{'Cache-Control':'no-store'}});
      }
      if (url.pathname === '/host/capability') {
        if (request.method !== 'POST') return new Response('Method refused', {status:405});
        const body = await request.text();
        if (Buffer.byteLength(body) > 256000) return new Response('Host request too large', {status:413});
        const {capability, operation, input} = JSON.parse(body);
        const routes: Record<string,string> = {agent:'app-agent',insights:'insights',connectors:'connectors',automation:'automation','research-assets':'research-assets',skills:'skills'};
        if (!Object.hasOwn(routes, capability) || typeof operation !== 'string' || !input || typeof input !== 'object' || Array.isArray(input)) return new Response('Host capability unavailable', {status:403});
        const target = new URL(`/host/${routes[capability]}`, request.url);
        return this.serve(new Request(target, {method:'POST',headers:request.headers,body:JSON.stringify({...input,operation})}));
      }
      if (url.pathname === '/host/skills') {
        if (request.method !== 'POST') return new Response('Method refused', {status:405});
        const body = await request.text();
        if (Buffer.byteLength(body) > 4096) return new Response('Request too large', {status:413});
        const value = await this.request('skillsmarket', {name:url.hostname,request:JSON.parse(body)});
        return Response.json(value, {headers:{'Cache-Control':'no-store'}});
      }
      if (url.pathname.startsWith('/api/')) await this.request('apiaccess', {name:url.hostname,path:url.pathname});
      const sdkInputPrefix = `/api/apps/${url.hostname}/inputs/`;
      if (url.pathname.startsWith(sdkInputPrefix)) {
        return this.serve(new Request(new URL(`/host/inputs/${url.pathname.slice(sdkInputPrefix.length)}`, request.url), request));
      }
      if(url.pathname.startsWith('/host/inputs/')){
        if(request.method!=='GET'||!this.input||!/^\/host\/inputs\/[a-f0-9]{64}$/.test(url.pathname))return new Response('App input unavailable',{status:404});
        const file=await this.input(url.hostname,url.pathname.split('/').at(-1)!);
        return new Response(new Uint8Array(file.data),{headers:{'Content-Type':file.mediaType,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase())}`,'Cache-Control':'no-store'}});
      }
      if (url.hostname === 'paper-agent' && ['/api/reproduction/start', '/api/reproduction/host'].includes(decodeURIComponent(url.pathname)))
        return new Response('Reproduction execution is reserved for the Host', { status: 403 });
      if (url.pathname === '/host/docling-runtime') {
        if (url.hostname !== 'paper-agent' || caller !== origin) return new Response('Paper origin required', { status: 403 });
        if (request.method !== 'POST') return new Response('Method refused', { status: 405 });
        const body = await request.text();
        if (Buffer.byteLength(body) > 4096) return new Response('Request too large', { status: 413 });
        let input;
        try { input = doclingInput(JSON.parse(body)); }
        catch { return new Response('Invalid Docling component request', { status: 400 }); }
        try {
          return Response.json(doclingStatus(await this.docling.apply(input)), { headers: { 'Cache-Control': 'no-store' } });
        } catch {
          return new Response('Optional OCR setup unavailable. Check status or continue manually.', { status: 503 });
        }
      }
      if (url.pathname === '/host/reproduction') {
        if (url.hostname !== 'paper-agent') return new Response('Paper origin required', { status: 403 });
        if (request.method !== 'POST') return new Response('Method refused', { status: 405 });
        const body = await request.text();
        if (Buffer.byteLength(body) > 4096) return new Response('Request too large', { status: 413 });
        let input: ReproductionInput;
        try { input = reproductionInput(JSON.parse(body)); }
        catch { return new Response('Invalid frozen reproduction request', { status: 400 }); }
        try {
          return Response.json(reproductionStatus(await this.reproduction(input)), { headers: { 'Cache-Control': 'no-store' } });
        } catch {
          // Private Host approval material and exceptions never cross into the App.
          return new Response('Reproduction request unavailable. Inspect its status before retrying.', { status: 503 });
        }
      }
      if (url.pathname === '/host/automation') {
        if (request.method !== 'POST') return new Response('Method refused', { status: 405 });
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 256_000) return new Response('Request too large', { status: 413 });
        return Response.json(await this.request('automation', { name: url.hostname, request: JSON.parse(raw) }), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/host/research-assets') {
        if (request.method !== 'POST') return new Response('Method refused', { status: 405 });
        const body = await request.text();
        if (Buffer.byteLength(body) > 64 * 1024) return new Response('Request too large', { status: 413 });
        return Response.json(await this.request('research-assets', { name: url.hostname, request: JSON.parse(body) }), { headers: { 'Cache-Control': 'no-store' } });
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
      if (url.pathname === '/host/app-agent') {
        if (request.method !== 'POST') return new Response('Method refused', {status:405});
        const body = await request.text();
        if (Buffer.byteLength(body) > 256_000) return new Response('Pero Agent request too large', {status:413});
        const operation = JSON.parse(body);
        const value = await this.request<{context?: unknown}>('agentrun', {name:url.hostname,request:operation});
        return Response.json(operation.operation === 'prepare' ? value.context : value, {headers:{'Cache-Control':'no-store'}});
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
      const access = await this.request<AppAccess>(url.pathname.startsWith('/api/') ? 'resolve' : 'resolve_static', { name: url.hostname });
      if (['/api/workspaces','/api/harnesses'].includes(url.pathname)) {
        if (request.method !== 'GET' || url.search) return new Response('Method refused', {status:405});
        return Response.json(await this.request('agentcatalog', {name:url.hostname,path:url.pathname}), {headers:{'Cache-Control':'no-store'}});
      }
      if (url.pathname.startsWith('/api/')) {
        if (!access.backend) return new Response('This App has no backend', { status: 503 });
        const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
        if (body && body.byteLength > 16 * 1024 * 1024) return new Response('Request too large', { status: 413 });
        const response = await net.fetch(`${access.backend.url}${url.pathname}${url.search}`, {
          method: request.method,
          headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json', 'X-Pero-App-Token': access.backend.token },
          body,
          redirect: 'error',
        });
        return new Response(response.body, { status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' } });
      }
      if (request.method !== 'GET') return new Response('Method refused', { status: 405 });
      const root = await realpath(access.root);
      const assetPath = url.pathname;
      const file = await realpath(resolve(root, '.' + decodeURIComponent(assetPath)));
      const assets = resolve(root, dirname(access.entry));
      if (!file.startsWith(assets + sep) || !(await stat(file)).isFile()) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      const nestedReader = file === resolve(assets, '_reader/reader.html') ||
        url.hostname === 'paper-agent' && file === resolve(assets, '_paper-reader/frame.html');
      const artifactReader = url.hostname === 'scientific-viewer' && file === resolve(assets, 'artifact.html');
      const ancestors = artifactReader ? 'pero://workbench pero://chat' : nestedReader ? "'self' pero://workbench" : 'pero://workbench';
      headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' ${(access.frameOrigins ?? []).join(' ')}; object-src 'none'; base-uri 'none'; frame-ancestors ${ancestors}`);
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      return new Response((error as Error).message, { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  }
}
