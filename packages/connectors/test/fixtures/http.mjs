import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export async function fixture({ splitOAuthOrigin = false } = {}) {
  const sessions = new Map(), codes = new Map(), metrics = { calls: 0, refresh: 0, tokens: 0, registrations: 0, deletes: 0, pkce: false, resource: false, authHeaderLeak: false, resourceHeader: false };
  let origin, oauthOrigin, backchannelServer, callDelay = 0, registeredClient = '', held;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    if (req.headers['x-resource-key']) {
      if (url.pathname === '/mcp') metrics.publicHeader = true;
      if (url.pathname === '/secure') metrics.resourceHeader = true;
      else metrics.authHeaderLeak = true;
    }
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      if (url.pathname === '/.well-known/oauth-authorization-server') return send(200, { issuer: origin, authorization_endpoint: origin + '/authorize', token_endpoint: oauthOrigin + '/token', registration_endpoint: oauthOrigin + '/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true });
      if (url.pathname === '/authorize') {
        const client = url.searchParams.get('client_id');
        if (![registeredClient, 'point-fixture'].includes(client) || url.searchParams.get('code_challenge_method') !== 'S256' || url.searchParams.get('resource') !== origin + '/secure') return send(400, {});
        const code = randomUUID(); codes.set(code, url.searchParams.get('code_challenge'));
        const redirect = new URL(url.searchParams.get('redirect_uri'));
        redirect.searchParams.set('code', code); redirect.searchParams.set('state', url.searchParams.get('state')); redirect.searchParams.set('iss', origin);
        res.writeHead(302, { location: redirect.href }).end(); return;
      }
      let bytes = ''; for await (const chunk of req) { bytes += chunk; if (bytes.length > 131072) return send(413, {}); }
      if (url.pathname === '/register') {
        const registration = JSON.parse(bytes);
        if (req.method !== 'POST' || registration.token_endpoint_auth_method !== 'none' || registration.redirect_uris?.length !== 1) return send(400, {});
        registeredClient = 'point-dynamic-fixture'; metrics.registrations++;
        return send(201, { client_id: registeredClient, client_name: registration.client_name, redirect_uris: registration.redirect_uris });
      }
      if (url.pathname === '/token') {
        const form = new URLSearchParams(bytes);
        if (![registeredClient, 'point-fixture'].includes(form.get('client_id')) || form.get('resource') !== origin + '/secure') return send(400, {});
        metrics.resource = true;
        if (form.get('grant_type') === 'refresh_token') {
          if (form.get('refresh_token') !== 'fixture-refresh') return send(400, {});
          metrics.refresh++; return send(200, { access_token: 'fixture-access', refresh_token: 'fixture-refresh-rotated', token_type: 'Bearer', expires_in: 3600 });
        }
        const expected = codes.get(form.get('code')); codes.delete(form.get('code'));
        if (!expected || createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') !== expected) return send(400, { error: 'invalid_grant' });
        metrics.pkce = true; metrics.tokens++;
        return send(200, { access_token: 'fixture-initial', refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 1 });
      }
      if (!['/mcp', '/secure'].includes(url.pathname)) return send(404, {});
      if (url.pathname === '/secure' && req.headers.authorization !== 'Bearer fixture-access') return send(401, {});
      let entry = sessions.get(req.headers['mcp-session-id']);
      if (!entry && req.method === 'POST' && JSON.parse(bytes).method === 'initialize') {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true });
        const mcp = new Server({ name: 'independent-http-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
        let count = 0;
        mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'counter', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }));
        mcp.setRequestHandler(CallToolRequestSchema, async () => { metrics.calls++; if (held) { held.enter(); await held.gate; } if (callDelay) await new Promise(resolve => setTimeout(resolve, callDelay)); return { content: [{ type: 'text', text: JSON.stringify({ count: ++count }) }] }; });
        await mcp.connect(transport); entry = { transport, mcp };
        await transport.handleRequest(req, res, JSON.parse(bytes));
        sessions.set(transport.sessionId, entry); return;
      }
      if (!entry) return send(404, {});
      if (req.method === 'DELETE') metrics.deletes++;
      await entry.transport.handleRequest(req, res, bytes ? JSON.parse(bytes) : undefined);
    } catch { if (!res.headersSent) send(500, {}); else res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  oauthOrigin = origin;
  if (splitOAuthOrigin) {
    backchannelServer = createServer(async (req, res) => {
      try {
        const upstream = await fetch(origin + req.url, { method: req.method, headers: { 'content-type': req.headers['content-type'] ?? 'application/octet-stream' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req, duplex: 'half', redirect: 'manual' });
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch { res.writeHead(502).end(); }
    });
    await new Promise(resolve => backchannelServer.listen(0, '127.0.0.1', resolve));
    oauthOrigin = `http://127.0.0.1:${backchannelServer.address().port}`;
  }
  return { origin, metrics, setCallDelay(ms) { callDelay = ms; }, holdCalls() {
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
    held = { enter, gate }; return { entered, release };
  }, async close() {
    for (const s of sessions.values()) await s.mcp.close();
    if (backchannelServer) { backchannelServer.closeAllConnections(); await new Promise(resolve => backchannelServer.close(resolve)); }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}
