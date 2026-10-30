// Deterministic protocol fixture. It performs no filesystem or network work.
import readline from 'node:readline';
const scenario = process.env.PERO_FIXTURE_SCENARIO || '';
import { isDeepStrictEqual } from 'node:util';
let authenticated = false;
let sessionAttempts = 0;
let sessionMcp = [];
let active;
let permission;
let turn = 0;
let model = 'model-a';
let mode = 'agent';
let effort = 'medium';
let approval = 'ask';
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const reply = (id, result) => send({ id, result });
const fail = (id, code, message) => send({ id, error: { code, message } });
const update = text => send({ method: 'session/update', params: { sessionId: 'fixture-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
const finish = reason => { if (active !== undefined) { reply(active, { stopReason: reason }); active = undefined; } };
const configs = () => [{ id: 'provider-model', name: 'Model', category: 'model', type: 'select', currentValue: model, options: [{ value: 'model-a', name: 'Model A' }, { value: 'model-b', name: 'Model B' }] },
 ...(scenario==='composer' ? [{id:'approval',name:'Tool permissions',category:'_permission',type:'select',currentValue:approval,options:[{value:'ask',name:'Ask before tools',description:'Request approval before using tools'},{value:'read',name:'Allow reads',description:'Allow read tools only'}]}] : []),
 ...(scenario==='settings' ? [
  {id:'mode',name:'Mode',category:'mode',type:'select',currentValue:mode,options:[{value:'agent',name:'Agent'},{value:'plan',name:'Plan'}]},
  {id:'effort',name:'Thinking effort',category:'thought_level',type:'select',currentValue:effort,options:[{group:'standard',name:'Standard',options:[{value:'medium',name:'Medium'},{value:'low',name:'Low'},{value:'high',name:'High'}]}]},
 ]:[])];
const legacyModels = () => ({ currentModelId: model, availableModels: [{ modelId: 'model-a', name: 'Legacy A' }, { modelId: 'model-b', name: 'Legacy B' }] });
readline.createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params, result } = JSON.parse(line);
  if (method === 'initialize') {
    if (scenario === 'initialization_hangs') return;
    if (scenario === 'unsupported_protocol') { reply(id, { protocolVersion: 999, agentCapabilities: {}, authMethods: [] }); return; }
    if (scenario === 'dsh_wire') { reply(id, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }); return; }
    reply(id, { protocolVersion: 1, agentCapabilities: scenario === 'composer' ? {promptCapabilities:{image:true,embeddedContext:true}} : (scenario.startsWith('mcp') && scenario !== 'mcp_unsupported' || scenario === 'app_use_boundary') ? {mcpCapabilities: {http: true, sse: true}} : {}, agentInfo: { name: 'lifecycle-fixture', version: '1' }, authMethods: [{ id: 'login', name: 'Fixture login' }, { type: 'terminal', id: 'terminal-login', name: 'Interactive fixture login' }] });
  } else if (method === 'session/new') {
    sessionAttempts += 1;
    sessionMcp = params.mcpServers;
    if (scenario === 'mcp_auth' && authenticated && sessionAttempts !== 2) { fail(id, -32602, 'Unexpected authentication retry count'); return; }
    if (scenario.startsWith('mcp') && !isDeepStrictEqual(params.mcpServers, JSON.parse(process.env.PERO_EXPECT_MCP))) { fail(id, -32602, 'MCP forwarding mismatch'); return; }
    if (scenario === 'mcp_unsupported') { fail(id, -32602, 'Unexpected session creation'); return; }
    if (scenario === 'unsupported_protocol') { update('unexpected-session-new'); return; }
    if ((scenario === 'auth' || scenario === 'mcp_auth') && !authenticated) { fail(id, -32000, 'Fixture requires login'); return; }
    const session = { sessionId: 'fixture-session' };
    if (scenario === 'dsh_wire') { reply(id, { ...session, configOptions: [] }); return; }
    if (scenario !== 'legacy_models' && scenario !== 'no_models') session.configOptions = configs();
    if (scenario === 'legacy_models' || scenario === 'both_models') session.models = legacyModels();
    if (scenario === 'legacy_modes') session.modes = {currentModeId:mode,availableModes:[{id:'agent',name:'Agent'},{id:'plan',name:'Plan'}]};
    reply(id, session);
    if (scenario === 'composer') send({ method:'session/update', params:{sessionId:'fixture-session', update:{sessionUpdate:'available_commands_update', availableCommands:[{name:'compact',description:'Compact conversation',input:{hint:'instructions'}}]}} });
  } else if (method === 'authenticate') {
    if (params.methodId !== 'login') { fail(id, -32602, 'Unadvertised login invoked'); return; }
    authenticated = true;
    reply(id, {});
  } else if (method === 'session/set_config_option') {
    if (scenario==='composer' && params.configId==='approval') { approval=params.value; reply(id,{configOptions:configs()}); return; }
    if(scenario==='settings' && params.configId!=='provider-model') {
      if(params.configId==='effort' && params.value==='high'){fail(id,-32602,'High effort rejected by fixture');return;}
      if(params.configId==='mode')mode=params.value;else if(params.configId==='effort')effort=params.value;
      reply(id,{configOptions:configs()});return;
    }
    if (scenario === 'bad_model' || scenario === 'legacy_models' || params.configId !== 'provider-model') { fail(id, -32602, 'Fixture model unavailable'); return; }
    model = params.value;
    reply(id, { configOptions: configs() });
  } else if (method === 'session/set_mode') {
    if(scenario!=='legacy_modes'){fail(id,-32602,'Legacy mode not advertised');return;}
    mode=params.modeId;reply(id,{});
  } else if (method === 'session/set_model') {
    if (scenario !== 'legacy_models' || !['model-a', 'model-b'].includes(params.modelId)) { fail(id, -32602, 'Legacy setter invoked without advertisement'); return; }
    model = params.modelId;
    send({ method: 'session/update', params: { sessionId: 'fixture-session', update: { sessionUpdate: 'current_model_update', currentModelId: model } } });
    reply(id, {});
  } else if (method === 'session/prompt') {
    active = id;
    turn += 1;
    const text = params.prompt[0].text;
    if (scenario === 'prompt_auth' && !authenticated) {
      setTimeout(() => { fail(id, -32000, 'Fixture provider requires login'); active = undefined; }, 100);
      return;
    }
    if (scenario === 'composer') { update(JSON.stringify(params.prompt)); finish('end_turn'); return; }
    if (scenario === 'app_use_boundary') { update(JSON.stringify({prompt:params.prompt,mcpServers:sessionMcp})); finish('end_turn'); return; }
    if (text === 'permission') {
      permission = 900 + turn;
      if (scenario === 'dsh_wire') {
        send({ id: permission, method: 'session/request_permission', params: { sessionId: 'fixture-session', toolCall: { toolCallId: 'permission-tool' }, options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' }] } });
        return;
      }
      send({ id: permission, method: 'session/request_permission', params: { sessionId: 'fixture-session', toolCall: { toolCallId: 'permission-tool', title: 'Fixture permission', status: 'pending' }, options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Reject', kind: 'reject_once' }] } });
      return;
    }
    if (text === 'wait') return;
    if (scenario === 'dsh_wire') {
      const notify = update => send({ method: 'session/update', params: { sessionId: 'fixture-session', update } });
      notify({ sessionUpdate: 'agent_message_chunk', messageId: 'message-1', content: { type: 'text', text: 'fixture response' } });
      notify({ sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'fixture_tool', kind: 'other', status: 'in_progress', rawInput: { fixture: true } });
      notify({ sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'fixture result' } }] });
      finish('end_turn');
      return;
    }
    update(`turn-${turn}:${text}`);
    setTimeout(() => finish('end_turn'), 100);
  } else if (method === 'session/cancel') {
    if (scenario === 'ignore_cancel') return;
    finish('cancelled');
  } else if (permission !== undefined && id === permission) {
    update(`permission:${result.outcome.outcome}`);
    finish('end_turn');
    permission = undefined;
  } else if (id !== undefined) fail(id, -32601, 'Fixture method not found');
});

