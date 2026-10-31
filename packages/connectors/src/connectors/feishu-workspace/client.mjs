import { baseTables, baseFields, baseRecordCreate } from './base.mjs';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { browseResources, listChats, readChat, readResource, timestamp } from './resources.mjs';
import { SOURCE_REFERENCE_PROTOCOL, sourceReference, resourceURL } from './reference.mjs';

import { FeishuError } from './errors.mjs';
export { FeishuError } from './errors.mjs';
const fail = code => { throw new FeishuError(code); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const scopeSet = value => new Set(String(value ?? '').split(/[,\s]+/).filter(Boolean));
export const READ_SCOPES = ['search:docs:read', 'docx:document:readonly'];

/** Fixed native binary, no shell, no inherited credential/environment overrides. */
export function createCliRunner({ binary, sha256, home, cwd, profile = 'point-readonly', timeoutMs = 30000, maxBytes = 1048576 }) {
  if (!isAbsolute(binary ?? '') || !/^[a-f0-9]{64}$/.test(sha256 ?? '') || !isAbsolute(home ?? '') ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(profile)) fail('FEISHU_CONFIG');
  return async (args, { signal, stdin, mode = 'json', cwd: operationCwd } = {}) => {
    if (!['json', 'events', 'discard'].includes(mode)) fail('FEISHU_ARGUMENT');
    if (stdin !== undefined && (typeof stdin !== 'string' || Buffer.byteLength(stdin) > 65536)) fail('FEISHU_ARGUMENT');
    if (signal?.aborted) fail('FEISHU_CANCELLED');
    if (await realpath(binary).catch(() => '') !== binary ||
        createHash('sha256').update(await readFile(binary)).digest('hex') !== sha256) fail('FEISHU_INTEGRITY');
    return new Promise((resolve, reject) => {
      const child = spawn(binary, [...args, '--profile', profile], { shell: false, cwd: operationCwd ?? cwd, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        env: { HOME: home, PATH: '/usr/bin:/bin', LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } });
      let stdout = [], stderr = [], bytes = 0, stopped;
      const stop = code => { if (!stopped) { stopped = code; child.kill(mode === 'events' ? 'SIGTERM' : 'SIGKILL'); } };
      const timer = setTimeout(() => stop('FEISHU_TIMEOUT'), timeoutMs);
      const abort = () => stop('FEISHU_CANCELLED');
      signal?.addEventListener('abort', abort, { once: true });
      if (child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(stdin); }
      if (signal?.aborted) abort();
      for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) stop('FEISHU_OUTPUT_LIMIT'); else chunks.push(chunk);
      });
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      child.once('error', () => { cleanup(); reject(new FeishuError('FEISHU_PROCESS')); });
      child.once('close', code => {
        cleanup();
        if (stopped) return reject(new FeishuError(stopped));
        if (mode === 'discard' && code === 0) return resolve({ ok: true });
        if (mode === 'events' && code === 0) {
          const diagnostics = Buffer.concat(stderr).toString('utf8');
          if (!diagnostics.includes('[event] ready event_key=') || /warn|drop/i.test(diagnostics)) return reject(new FeishuError('FEISHU_EVENT_LOSS'));
          try { return resolve({ ok: true, identity: 'user', data: { events: Buffer.concat(stdout).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) } }); }
          catch { return reject(new FeishuError('FEISHU_RESPONSE')); }
        }
        let value;
        try { value = JSON.parse(Buffer.concat(code === 0 ? stdout : stderr).toString('utf8')); }
        catch { return reject(new FeishuError('FEISHU_RESPONSE')); }
        // CLI stderr can contain URLs, tokens or upstream content: return only fixed codes.
        if (code !== 0 || value?.ok === false) {
          const type = value?.error?.type;
          return reject(new FeishuError(type === 'authentication' || type === 'auth' || type === 'config' ? 'FEISHU_AUTH_REQUIRED'
            : type === 'authorization' ? 'FEISHU_PERMISSION' : 'FEISHU_REQUEST'));
        }
        resolve(value);
      });
    });
  };
}

export function safeIdentity(status) {
  const user = status?.identities?.user;
  if (status?.brand !== 'feishu' || status?.verified !== true || user?.verified !== true || user.status !== 'ready' ||
      user.tokenStatus !== 'valid' || !/^ou_[A-Za-z0-9]+$/.test(user.openId ?? '') || !/^cli_[A-Za-z0-9]+$/.test(status.appId ?? '')) fail('FEISHU_AUTH_REQUIRED');
  const scopes = scopeSet(user.scope);
  if (!READ_SCOPES.every(scope => scopes.has(scope))) fail('FEISHU_PERMISSION');
  return { appId: status.appId, openId: user.openId, userName: typeof user.userName === 'string' ? user.userName : '',
    scopes: [...scopes], expiresAt: user.expiresAt, verified: true };
}

export class FeishuWorkspaceClient {
  constructor({ run, appId, openId, tenantId, connectionId = 'feishu-workspace', profile = 'point-readonly' }) {
    if (typeof run !== 'function' || !/^cli_[A-Za-z0-9]+$/.test(appId ?? '') || !/^ou_[A-Za-z0-9]+$/.test(openId ?? '')) fail('FEISHU_CONFIG');
    Object.assign(this, { run, appId, openId, tenantId, connectionId, profile });
  }
  async account(options = {}) {
    const identity = safeIdentity(await this.run(['auth', 'status', '--json', '--verify'], options));
    if (identity.appId !== this.appId || identity.openId !== this.openId) fail('FEISHU_ACCOUNT_CHANGED');
    if (this.tenantId) {
      const info = await this.run(['api', 'GET', '/open-apis/authen/v1/user_info', '--as', 'user', '--format', 'json'], options);
      if (info?.ok !== true || info.identity !== 'user' || info.data?.open_id !== this.openId || info.data?.tenant_key !== this.tenantId) fail('FEISHU_ACCOUNT_CHANGED');
      identity.tenantId = this.tenantId;
    }
    return { ...identity, profile: this.profile };
  }
  async read(args, options) {
    const account = await this.account(options);
    const result = await this.run(args, options);
    await this.account(options); // Fence profile/account changes during the request.
    if (result?.ok !== true || result.identity !== 'user' || !object(result.data)) fail('FEISHU_RESPONSE');
    return { trusted: false, source: 'feishu', retrievedAt: new Date().toISOString(), account, data: result.data };
  }
  async search(input = {}, options = {}) {
    if (!object(input)) fail('FEISHU_ARGUMENT');
    const { query = '', limit = 10, pageToken, mine = false, onlyTitle = false } = input;
    if (!object(input) || Object.keys(input).some(k => !['query', 'limit', 'pageToken', 'mine', 'onlyTitle'].includes(k)) ||
        typeof query !== 'string' || [...query].length > 30 || query.includes('\0') || (!query.trim() && !mine) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 20 || typeof mine !== 'boolean' || typeof onlyTitle !== 'boolean' ||
        (pageToken !== undefined && (typeof pageToken !== 'string' || pageToken.length > 16384 || pageToken.includes('\0')))) fail('FEISHU_ARGUMENT');
    const result = await this.read(['drive', '+search', '--as', 'user', '--format', 'json', '--query', query, '--doc-types', 'docx,wiki,file,slides',
      '--page-size', String(limit), ...(mine ? ['--mine'] : []), ...(onlyTitle ? ['--only-title'] : []), ...(pageToken ? ['--page-token', pageToken] : [])], options);
    result.data.items = (result.data.results ?? []).map(item => {
      const meta = item.result_meta ?? {};
      let url; try { url = resourceURL(meta.url); } catch { return null; }
      return { url, token: meta.token, type: meta.doc_types, crossTenant: meta.is_cross_tenant === true,
        modifiedAt: timestamp(item.edit_time ?? meta.edit_time), title: String(item.title_highlighted ?? '').replace(/<[^>]*>/g, '').slice(0,1000) };
    }).filter(Boolean);
    return result;
  }
  async browse(input,options){return browseResources.call(this,input,options)}
  async baseTables(input,options){return baseTables.call(this,input,options)}
  async baseFields(input,options){return baseFields.call(this,input,options)}
  async baseRecordCreate(input,options){return baseRecordCreate.call(this,input,options)}
  async chats(input,options){return listChats.call(this,input,options)}
  async chat(input,options){return readChat.call(this,input,options)}
  async resource(input,options){return readResource.call(this,input,options)}
  async document(input = {}, options = {}) {
    if (['file','slides','chat'].includes(input.reference?.resourceType) || /\/(drive\/file|slides)\//.test(input.document ?? '')) return this.resource(input,options);
    if (!object(input)) fail('FEISHU_ARGUMENT');
    let pinned;
    if (input.reference !== undefined) {
      if (Object.keys(input).length !== 1) fail('FEISHU_ARGUMENT');
      try { pinned = sourceReference(input.reference); } catch { fail('FEISHU_REFERENCE'); }
      if (pinned.connectionId !== this.connectionId || pinned.tenantId !== this.tenantId || pinned.appId !== this.appId || pinned.userId !== this.openId) fail('FEISHU_ACCOUNT_CHANGED');
      input = { document: pinned.url, ...pinned.selection };
    }
    const { document, scope = 'outline', blockId } = input;
    if (!object(input) || Object.keys(input).some(k => !['document', 'scope', 'blockId'].includes(k)) ||
        typeof document !== 'string' || document.length > 2048 || !['outline', 'section', 'full'].includes(scope) ||
        (blockId !== undefined && (typeof blockId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(blockId))) ||
        (scope === 'section' ? !blockId : blockId !== undefined)) fail('FEISHU_ARGUMENT');
    let ref = document;
    if (!/^[A-Za-z0-9]{10,128}$/.test(ref)) {
      let url;
      try { url = new URL(ref); } catch { fail('FEISHU_ARGUMENT'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !/(^|\.)(feishu\.cn|larkoffice\.com|larksuite\.com)$/.test(url.hostname) ||
          !/^\/(docx|wiki)\/[A-Za-z0-9]{10,128}\/?$/.test(url.pathname)) fail('FEISHU_ARGUMENT');
      // Accept resource URLs but no arbitrary origin requests, query redirects or anchors.
      ref = url.origin + url.pathname;
    }
    if (scope==='full' && /\/wiki\//.test(ref)) {
      const account=await this.account(options);
      if(account.scopes.includes('wiki:node:retrieve')) {const info=await this.read(['drive','+inspect','--as','user','--format','json','--url',ref],options);if(['file','slides'].includes(info.data.type))return this.resource(input,options);}
    }
    const result = await this.read(['docs', '+fetch', '--as', 'user', '--doc', ref, '--doc-format', 'xml', '--detail', 'with-ids',
      '--scope', scope, ...(scope === 'outline' ? ['--max-depth', '3'] : []), ...(blockId ? ['--start-block-id', blockId] : [])], options);
    if (typeof result.data.document?.content !== 'string' || typeof result.data.document?.document_id !== 'string' ||
        !Number.isSafeInteger(result.data.document?.revision_id)) fail('FEISHU_RESPONSE');
    if (this.tenantId) {
      const resourceId = result.data.document.document_id;
      result.reference = sourceReference({ protocol: SOURCE_REFERENCE_PROTOCOL, provider: 'feishu-workspace', connectionId: this.connectionId,
        tenantId: this.tenantId, appId: this.appId, userId: this.openId, resourceType: 'docx', resourceId,
        url: ref.startsWith('https:') && new URL(ref).pathname === `/docx/${resourceId}` ? ref : `https://www.feishu.cn/docx/${resourceId}`,
        version: result.data.document.revision_id, selection: { scope, ...(blockId ? { blockId } : {}) } });
      if (ref.startsWith('https:')) result.selectedURL = resourceURL(ref); // Wiki selection remains distinct from its resolved Docx.
    }
    if (pinned && result.reference.version !== pinned.version) fail('FEISHU_VERSION_CONFLICT');
    return result;
  }
  async agenda(input = {}, options = {}) {
    const { start, end } = input;
    if (!object(input) || Object.keys(input).some(k => !['start', 'end'].includes(k)) ||
      ![start, end].every(v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))) ||
      Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 31 * 86400000) fail('FEISHU_ARGUMENT');
    const account = await this.account(options);
    if (!account.scopes.includes('calendar:calendar.event:read')) fail('FEISHU_PERMISSION');
    return this.read(['calendar', '+agenda', '--as', 'user', '--format', 'json', '--start', start, '--end', end], options);
  }
  async meetingEvents(input = {}, options = {}) {
    if (!object(input) || Object.keys(input).some(k => k !== 'kind') || !['ended', 'note'].includes(input.kind)) fail('FEISHU_ARGUMENT');
    const key = input.kind === 'ended' ? 'vc.meeting.participant_meeting_ended_v1' : 'vc.note.generated_v1';
    const account = await this.account(options);
    if (!account.tenantId || !account.scopes.includes(input.kind === 'ended' ? 'vc:meeting.meetingevent:read' : 'vc:note:read')) fail('FEISHU_PERMISSION');
    const result = await this.run(['event', 'consume', key, '--as', 'user', '--max-events', '10', '--timeout', '10s'], { ...options, mode: 'events' });
    await this.account(options);
    if (result?.ok !== true || result.identity !== 'user' || !Array.isArray(result.data?.events) || result.data.events.length > 10) fail('FEISHU_RESPONSE');
    const events = result.data.events.map(event => normalizeMeetingEvent(event, key)).filter(Boolean);
    return { trusted: false, account, data: { events }, retrievedAt: new Date().toISOString() };
  }
  async meetingNote(input = {}, options = {}) {
    if (!object(input) || Object.keys(input).some(k => k !== 'noteId') || !/^[A-Za-z0-9_-]{1,128}$/.test(input.noteId ?? '')) fail('FEISHU_ARGUMENT');
    const account = await this.account(options);
    if (!account.scopes.includes('vc:note:read')) fail('FEISHU_PERMISSION');
    const result = await this.read(['note', '+detail', '--as', 'user', '--format', 'json', '--note-id', input.noteId], options);
    const token = result.data.note_doc_token;
    if (!/^[A-Za-z0-9]{10,128}$/.test(token ?? '')) fail('FEISHU_MATERIAL_PENDING');
    return this.document({ document: token, scope: 'full' }, options);
  }
  /** Narrow creation only: no arbitrary XML, assets, update, delete, or raw API from callers. */
  async createDocument(input = {}, options = {}) {
    if (!object(input) || Object.keys(input).some(k => !['title', 'content', 'parentToken', 'references'].includes(k)) ||
      typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160 ||
      typeof input.content !== 'string' || !input.content.trim() || Buffer.byteLength(input.content) > 32768 ||
      (input.parentToken !== undefined && !/^[A-Za-z0-9]{10,128}$/.test(input.parentToken)) ||
      !Array.isArray(input.references) || input.references.length > 8) fail('FEISHU_ARGUMENT');
    const refs = input.references.map(value => { try { return sourceReference(value); } catch { fail('FEISHU_REFERENCE'); } });
    const account = await this.account(options);
    if (!account.tenantId || !account.scopes.includes('docx:document:create')) fail('FEISHU_PERMISSION');
    for (const ref of refs) {
      if (ref.connectionId !== this.connectionId || ref.tenantId !== this.tenantId || ref.appId !== this.appId || ref.userId !== this.openId) fail('FEISHU_ACCOUNT_CHANGED');
      const fresh = await this.document({ reference: ref }, options);
      if (fresh.reference.version !== ref.version) fail('FEISHU_VERSION_CONFLICT');
    }
    const xml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const body = `<title>${xml(input.title)}</title>` + input.content.split('\n').map(line => `<p>${xml(line)}</p>`).join('') +
      refs.map(ref => `<p><a href="${xml(ref.url)}">${xml(ref.resourceId)} · v${ref.version}</a></p>`).join('');
    const output = await this.run(['docs', '+create', '--as', 'user', '--doc-format', 'xml', '--content', '-',
      ...(input.parentToken ? ['--parent-token', input.parentToken] : ['--parent-position', 'my_library'])], { ...options, stdin: body });
    // A post-write failure is deliberately ambiguous; the Host must never retry creation automatically.
    if (output?.ok !== true || output.identity !== 'user' || !object(output.data?.document)) fail('FEISHU_WRITE_UNKNOWN');
    let url;
    try { url = resourceURL(output.data.document.url); } catch { fail('FEISHU_WRITE_UNKNOWN'); }
    const receipt = { operation: 'document.create', identity: 'user', url,
      documentId: output.data.document.document_id, warnings: Array.isArray(output.data.warnings) ? output.data.warnings.map(() => 'provider-warning') : [], references: refs };
    try {
      await this.account(options);
      const verified = await this.document({ document: url, scope: 'full' }, options);
      // Compare visible text after XML entity normalization. A schema-valid read
      // does not prove the requested content survived conversion.
      const text = value => value.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      const actual = text(verified.data.document.content);
      if (!input.content.split('\n').filter(line => line.trim()).every(line => actual.includes(text(xml(line)))) ||
        !refs.every(ref => verified.data.document.content.includes(ref.resourceId))) fail('FEISHU_WRITE_UNKNOWN');
      return { trusted: false, source: 'feishu', account, reference: verified.reference,
        receipt: { ...receipt, documentId: verified.data.document.document_id, version: verified.data.document.revision_id, verifiedAt: verified.retrievedAt } };
    } catch {
      // Creation may have succeeded. Retain its known URL for reconciliation,
      // never present this as verified and never retry the create request.
      return { trusted: false, source: 'feishu', receipt, outcome: 'unknown' };
    }
  }
}
export function normalizeMeetingEvent(event, key) {
  if (event.type !== key || !/^[A-Za-z0-9_-]{1,128}$/.test(event.event_id ?? '')) fail('FEISHU_RESPONSE');
  if (key === 'vc.meeting.participant_meeting_ended_v1') {
    if (!/^\d{1,32}$/.test(event.meeting_id ?? '') || typeof event.topic !== 'string' || event.topic.length > 1000) fail('FEISHU_RESPONSE');
    return { type: event.type, eventId: event.event_id, meetingId: event.meeting_id, topic: event.topic, endTime: event.end_time };
  }
  if (key !== 'vc.note.generated_v1') fail('FEISHU_ARGUMENT');
  if (event.note_source?.source_type !== 'meeting') return null;
  if (!/^\d{1,32}$/.test(event.note_source.source_entity_id ?? '') || (event.note_token && !/^[A-Za-z0-9]{10,128}$/.test(event.note_token)) ||
    (!event.note_token && !/^[A-Za-z0-9_-]{1,128}$/.test(event.note_id ?? ''))) fail('FEISHU_RESPONSE');
  return { type: event.type, eventId: event.event_id, meetingId: event.note_source.source_entity_id, documentToken: event.note_token ?? '', noteId: event.note_id };
}
