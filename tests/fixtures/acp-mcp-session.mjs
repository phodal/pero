// Explicit ACP session-resource stub. It never opens an MCP transport. Go's
// separate real transport fixtures establish resource/tool execution behavior.
import readline from 'node:readline';
import { appendFileSync } from 'node:fs';
const capture = process.argv.find(arg => arg.startsWith('--capture='))?.slice(10);
const supported = !process.argv.includes('--unsupported');
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
let sessionId, servers = [], pending, pendingTool, appClosed = false;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params, result: answer } = JSON.parse(line);
  if (id === 'app-approval' && !method) {
    appendFileSync(capture, JSON.stringify({method:'approval_answer',sessionId,outcome:answer?.outcome})+'\n');
    if (pendingTool !== undefined && !appClosed && answer?.outcome?.outcome === 'selected') {
      appendFileSync(capture, JSON.stringify({method:'tool_executed',sessionId})+'\n');
      send({id:pendingTool,result:{content:[]}});pendingTool=undefined;
    } else if (pendingTool !== undefined && answer?.outcome?.outcome === 'cancelled') {
      send({id:pendingTool,error:{code:-32800,message:'Permission cancelled'}});pendingTool=undefined;
    }
    return;
  }
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: 1, agentInfo: { name: 'mcp-session-fixture', version: '1' },
      agentCapabilities: { mcpCapabilities: { http: true }, _meta: { 'pero.mcpRuntime': 1, ...(supported ? { 'pero.mcpSession': 1 } : {}) } } } });
  } else if (method === 'session/new') {
    sessionId = `actual-acp-${process.pid}`;
    servers = params.mcpServers.map(server => ({ name: server.name, generation: 1, connected: true, tools: [] }));
    send({ id, result: { sessionId } });
    for (const server of servers) send({ method: '_pero/mcp/runtime', params: { sessionId,
      revision: params._meta['pero.mcpRuntime'].revision, server: server.name, generation: 1, status: 'connected', tools: [] } });
  } else if (method === '_pero/mcp/session') {
    appendFileSync(capture, JSON.stringify(params) + '\n', { mode: 0o600 });
    if (params.sessionId !== sessionId) throw new Error('Host did not supply actual ACP session identity');
    if (params.action === 'read' && params.uri === 'fixture://slow') { pending = id; return; }
    if (params.action === 'prepare') {send({id,result:{binding:'fixture-binding',resource:{contents:[{uri:'ui://fixture',mimeType:'text/html;profile=mcp-app',text:'<p>Fixture</p>'}]}}});return;}
    if (params.action === 'tool' && params.name === 'ask-write') {
      pendingTool=id;appClosed=false;
      send({id:'app-approval',method:'session/request_permission',params:{sessionId,_meta:{'pero.mcpBinding':'fixture-binding'},
        toolCall:{toolCallId:'app-write',title:'Synthetic App write',status:'pending'},
        options:[{optionId:'allow-once',name:'Allow once',kind:'allow_once'}]}});
      return;
    }
    if (params.action === 'close' && params.binding === 'fixture-binding') {
      appClosed=true;
      if(pendingTool !== undefined){send({id:pendingTool,error:{code:-32800,message:'App binding closed'}});pendingTool=undefined;}
      send({id,result:{}});return;
    }
    const result = params.action === 'list'
      ? { servers: [...servers, { name: 'disabled', generation: 1, connected: true, tools: [] }, { name: 'pero-app-use', generation: 1, connected: true, tools: [] }], echo: params }
      : params.action === 'read'
        ? { contents: [{ uri: params.uri, mimeType: 'text/plain', text: 'Synthetic session-bound resource' }], echo: params }
        : { resources: [{ uri: 'fixture://document', name: 'Document' }], echo: params };
    send({ id, result });
  } else if (method === 'session/cancel') {
    appendFileSync(capture, JSON.stringify({ method, ...params }) + '\n', { mode: 0o600 });
    if (pending !== undefined) { send({ id: pending, error: { code: -32800, message: 'Fixture cancelled' } }); pending = undefined; }
  } else if (method === 'session/prompt') {
    appendFileSync(capture, JSON.stringify({ method, ...params }) + '\n', { mode: 0o600 });
    send({ id, result: { stopReason: 'end_turn' } });
  } else if (method === 'session/close') send({ id, result: {} });
});
