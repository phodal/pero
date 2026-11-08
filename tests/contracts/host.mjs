// Drives the real pero-host through the ACP fixture and validates every JSONL
// line in both directions against protocol/generated/host.schema.json.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with { type: 'json' };
import computerRequests from '../../protocol/generated/computer-request.schema.json' with { type: 'json' };
import computerEvents from '../../protocol/generated/computer-response.schema.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '../..');
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
ajv.addSchema(schema).addSchema(computerRequests).addSchema(computerEvents);
const validator = (name) => { const source=[schema,computerRequests,computerEvents].find(source=>source.$defs[name]);return source&&ajv.getSchema(`${source.$id}#/$defs/${name}`); };
const validInput = value => (value.method?.startsWith('settings.computer') ? validator('ComputerSettingsRequest') : validator('HostInput'))(value);
// Map each discriminator value to its variant so failures report one branch, not every oneOf arm.
const variants = (union, tag) => schema.$defs[union].oneOf.flatMap(function flatten({ $ref }) {
  const name = $ref.split('/').pop();
  const def = schema.$defs[name];
  if (def.oneOf) return def.oneOf.flatMap(flatten);
  const discriminator = def.properties[tag];
  const values = discriminator.enum ?? (discriminator.anyOf ?? discriminator.oneOf ?? [discriminator]).map(value => value.const);
  if (values.some(value => typeof value !== 'string'))
    throw new Error(`Missing ${tag} discriminator in ${name}`);
  return values.map(value => [value, name]);
});
const eventVariants = new Map(variants('HostEvent', 'kind'));
for (const name of ['ComputerSettingsEvent','ComputerSettingsErrorEvent']) eventVariants.set(computerEvents.$defs[name].properties.kind.const,name);
const commandVariants = new Map(variants('HostCommand', 'action'));
const explain = (name, value) => {
  if (!name) return 'no matching variant';
  const validate = validator(name);
  validate(value);
  return `${name}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`;
};

const temp = mkdtempSync(`${tmpdir()}/pero-contract-`);
// Scoped ACP sessions require a genuinely installed App/panel.
const builtins = resolve(temp, 'builtins'), app = resolve(builtins, 'fixture');
mkdirSync(resolve(app, 'dist'), { recursive: true });
writeFileSync(resolve(app, 'app.json'), JSON.stringify({ schemaVersion: 1, name: 'fixture',
  version: '0.1.0', displayName: 'Host contract fixture',
  contributes: { panels: [{ id: 'main', title: 'Fixture', entry: 'dist/index.html' }] } }));
writeFileSync(resolve(app, 'dist/index.html'), '<title>Host contract fixture</title>');
const agents = resolve(temp, 'agents.json');
writeFileSync(agents, JSON.stringify([
 { id: 'fixture', name: 'ACP test fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs')] },
 { id: 'settings-fixture', name: 'ACP settings fixture', command: process.execPath, args: [resolve(root, 'tests/runtime/lifecycle-agent.mjs')], env: {PERO_FIXTURE_SCENARIO:'settings'} },
 { id: 'runtime-fixture', name: 'ACP runtime fixture', command: process.execPath, args: [resolve(root, 'tests/runtime/lifecycle-agent.mjs')], env: {PERO_FIXTURE_SCENARIO:'runtime_live'},
   mcp_servers: [{type:'http',name:'docs',url:'http://127.0.0.1/mcp',headers:[]}] },
]));
writeFileSync(resolve(temp, 'notes.txt'), 'Context file for the contract test.\n');
const env = { ...process.env, PERO_APPS_ROOT: resolve(temp, 'installed'), PERO_BUILTIN_APPS_ROOT: builtins,
  PERO_BUILTIN_APPS: 'fixture', PERO_REQUIRED_APPS: '', PERO_LOCALE: 'en', PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'sessions.jsonl'), PERO_AGENTS_FILE: agents };

const failures = [];
const seen = new Set();
const hosts = [];

function startHost(overrides = {}) {
  const child = spawn(process.env.PERO_HOST_PATH || resolve(root, 'target/debug/pero-host'), ['--stdio'], { cwd: temp, env: {...env, ...overrides}, stdio: ['pipe', 'pipe', 'inherit'] });
  // Register at launch so early failures and already-exited Hosts still have an owner.
  const closed = new Promise(done => child.once('close', (code, signal) => {
    if (code !== 0) failures.push(`Host closed with code ${code}, signal ${signal}`);
    done();
  }));
  const events = [];
  let waiters = [];
  let inputError;
  child.on('error', error => failures.push(`Host process: ${error}`));
  child.stdin.on('error', error => {
    inputError = error;
    failures.push(`Host stdin: ${error}`);
    for (const waiter of waiters) waiter.reject(error);
    waiters = [];
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    let event;
    try { event = JSON.parse(line); } catch { failures.push(`non-JSON event: ${line}`); return; }
    seen.add(event.kind);
    if (eventVariants.has(event.kind) && !validator(eventVariants.get(event.kind))(event)) failures.push(`event ${explain(eventVariants.get(event.kind), event)}\n    ${line.slice(0, 240)}`);
    // Replayed journal entries are validated by ReplayData; count their kinds too.
    for (const replayed of event.kind === 'replay' ? event.data?.events ?? [] : []) seen.add(`replay:${replayed.kind}`);
    events.push(event);
    waiters = waiters.filter(waiter => !waiter.accept(event));
  });
  const send = (input, { invalid = false } = {}) => {
    if (!invalid && !validInput(input)) {
      const name = input.action ? commandVariants.get(input.action) : input.method === 'documents' ? 'FileDocumentRequest' : input.method === 'settings.remote' ? 'SetRemoteSettingsRequest' : input.method ? 'SetLocaleRequest' : 'EchoRequest';
      const preview = input.method === 'settings.remote' ? '[remote settings redacted]' : JSON.stringify(input);
      failures.push(`input ${preview}: ${explain(name, input)}`);
    }
    child.stdin.write((typeof input === 'string' ? input : JSON.stringify(input)) + '\n');
  };
  const next = (kind, match = () => true, timeout = 5000) => new Promise((resolveEvent, reject) => {
    if (inputError) return reject(inputError);
    const found = events.find((event) => event.kind === kind && match(event) && !event.taken);
    if (found) { found.taken = true; return resolveEvent(found); }
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${kind}`)), timeout);
    waiters.push({
      accept(event) {
        if (event.kind !== kind || !match(event)) return false;
        event.taken = true; clearTimeout(timer); resolveEvent(event); return true;
      },
      reject(error) { clearTimeout(timer); reject(error); },
    });
  });
  let stopping;
  const stop = () => stopping ??= (async () => { child.stdin.end(); await closed; })();
  const host = { send, next, stop };
  hosts.push(host);
  return host;
}

try {
  let host = startHost();
  await host.next('settings');
  await host.next('ready');
  if ((await host.next('computer_settings')).data.enabled !== false) failures.push('Computer Use must default to disabled');
  host.send({method:'settings.computer',id:'computer-enable',enabled:true});
  if (!(await host.next('computer_settings',event=>event.request_id==='computer-enable')).data.enabled) failures.push('Computer Use was not enabled');
  host.send({method:'settings.computer',id:'computer-invalid',enabled:'true'},{invalid:true});
  await host.next('computer_settings_error',event=>event.request_id==='computer-invalid');
  host.send({method:'settings.computer.get'});
  if (!(await host.next('computer_settings')).data.enabled) failures.push('Invalid Computer Use settings replaced the saved value');

  const guide=resolve(temp,'guide.md');
  writeFileSync(guide,'# File document\n');
  writeFileSync(resolve(temp,'data set.json'),'[{"n":9007199254740993}]');
  host.send({method:'documents',action:'open',request_id:'file-open',path:guide});
  const openedFile=await host.next('document_file',e=>e.request_id==='file-open');
  if(openedFile.text!=='# File document\n' || openedFile.data.format.kind!=='markdown')failures.push('File document source/format did not cross the Host boundary');
  host.send({method:'documents',action:'save',request_id:'file-save',source:openedFile.data.source.id,revision:openedFile.data.revision,text:'# Saved\n'});
  await host.next('document_file',e=>e.request_id==='file-save');
  if(readFileSync(guide,'utf8')!=='# Saved\n')failures.push('File save did not reach disk');
  host.send({method:'documents',action:'follow',request_id:'file-link',source:openedFile.data.source.id,href:'data%20set.json'});
  const linkedFile=await host.next('document_file',e=>e.request_id==='file-link');
  if(linkedFile.text!=='[{"n":9007199254740993}]')failures.push('Relative file link changed exact source');
  host.send({method:'documents',action:'release',source:openedFile.data.source.id});

  host.send({ id: 'probe-1', text: '你好，Pero' });
  await host.next('echo', (e) => e.request_id === 'probe-1');
  host.send('not json', { invalid: true });
  await host.next('error');
  host.send({ method: 'settings.locale', locale: 'zh-CN' });
  await host.next('settings', (e) => e.text === 'zh-CN');
  const legacyWorkbench = {appearance:'dark',projects:[{workspace:temp,project_id:'pero'}]};
  host.send({method:'settings.workbench',preferences:legacyWorkbench});
  const migrated = await host.next('workbench_settings');
  const expectedLegacy={...legacyWorkbench,shortcuts:{macos:{},other:{}},research_projects:[],accent:'teal',typography:{ui_size:14,chat_size:12,code_size:null},layout:{chat_width:420,chat_open:false,sidebar_width:260,sessions_width:280,artifact_pane_width:280,artifact_view:'icons',resource_tab:'artifacts',link_surface:'in_app'}};
  if (!isDeepStrictEqual(migrated.data,expectedLegacy)) failures.push('Legacy workbench preferences did not restore default layout');
  const workbench = {...expectedLegacy,shortcuts:{macos:{new_chat:['alt-cmd-n'],toggle_sidebar:[]},other:{}},accent:'blue',typography:{ui_size:18,chat_size:20,code_size:null},layout:{chat_width:512,chat_open:true,sidebar_width:260,sessions_width:360,artifact_pane_width:640,artifact_view:'gallery',resource_tab:'files',link_surface:'in_app'}};
  host.send({method:'settings.workbench',preferences:workbench});
  const applied = await host.next('workbench_settings');
  if (!isDeepStrictEqual(applied.data,workbench)) failures.push('Workbench preferences were not acknowledged');
  for (const invalidPreferences of [
    {...workbench,shortcuts:{macos:{new_chat:['cmd-p']},other:{}}},
    {...workbench,appearance:'invalid'},
    {...workbench,layout:{...workbench.layout,sessions_width:199}},
    {...workbench,layout:{...workbench.layout,sessions_width:481}},
    {...workbench,layout:{...workbench.layout,artifact_view:'invalid'}},
    {...workbench,layout:{...workbench.layout,resource_tab:'invalid'}},
  ]) {
    host.send({method:'settings.workbench',preferences:invalidPreferences},{invalid:true});
    await host.next('error',event=>event.message_key==='error.preferences');
    host.send({method:'settings.workbench.get'});
    if (!isDeepStrictEqual((await host.next('workbench_settings')).data,workbench)) failures.push('Invalid preferences replaced saved workbench settings');
  }

  host.send({ method: 'contribution', id: 'contribution-invalid', operation: 'prepare',
    task_id: 'task_contract', repository: '../invalid', parent: temp, title: 'Contract test',
    source_url: 'https://github.com/acme/repo/issues/1', source_revision: 'contract-revision' });
  await host.next('contribution_error', e => e.request_id === 'contribution-invalid' && e.data.code === 'invalid_request');

  const storedConnection = { url: 'https://openpero.com', mode: 'client', encrypted_token: 'ZW5jcnlwdGVk' };
  host.send({ method: 'settings.remote', id: 'remote-save', connection: storedConnection });
  const saved = await host.next('remote_settings_saved', e => e.request_id === 'remote-save');
  if (saved.text || saved.data !== undefined) failures.push('remote preference acknowledgement exposed a payload');
  const preferences = () => JSON.parse(readFileSync(env.PERO_SETTINGS_PATH, 'utf8'));
  if (!isDeepStrictEqual(preferences().remote_connection, storedConnection)) failures.push('Host did not persist encrypted remote preference');
  if (preferences().locale !== 'zh-CN') failures.push('Saving remote connection replaced locale');
  if (process.platform !== 'win32' && (statSync(env.PERO_SETTINGS_PATH).mode & 0o777) !== 0o600) failures.push('Runtime preferences must be private to the user');
  for (const connection of [{ ...storedConnection, token: 'never-store-plaintext' }, { ...storedConnection, encrypted_token: '====' }, undefined]) {
    host.send({ method: 'settings.remote', id: 'remote-invalid', ...(connection === undefined ? {} : { connection }) }, { invalid: true });
    await host.next('remote_settings_error', e => e.request_id === 'remote-invalid');
  }
  if (!isDeepStrictEqual(preferences().remote_connection, storedConnection)) failures.push('Invalid remote preference changed existing settings');

  host.send({ action: 'list_agents' });
  await host.next('agents');
  await host.next('replay');
  await host.next('workspace');
  host.send({ action: 'workspace', path: temp });
  const workspace = await host.next('workspace');
  if (realpathSync(workspace.text) !== realpathSync(temp)) failures.push(`Workspace path must resolve to the selected directory: ${workspace.text}`);
  if (process.platform === 'win32' && /^[A-Za-z]:\\/.test(temp) && /^\\\\\?\\[A-Za-z]:\\/.test(workspace.text)) failures.push(`Drive workspace path must use ordinary platform syntax: ${workspace.text}`);
  host.send({ action: 'attach_files', paths: [resolve(temp, 'notes.txt')] });
  await host.next('context_files');
  host.send({action:'search_context',request_id:'context-search',kind:'file',query:'notes.txt'});
  const candidates = await host.next('context_candidates',e=>e.request_id==='context-search');
  const selected = candidates.data.find(item=>item.label==='notes.txt');
  if (!selected) throw new Error('Host did not find context file');
  host.send({action:'resolve_context',request_id:'context-select',kind:selected.kind,source:selected.source});
  const context = await host.next('context_resolved',e=>e.request_id==='context-select');
  host.send({action:'resolve_context',request_id:'context-missing',kind:'file',source:resolve(temp,'missing.txt')});
  await host.next('context_error',e=>e.request_id==='context-missing');

  const thread = 'contract-thread';
  const inThread = (e) => e.thread_id === thread;
  host.send({ action: 'new_session', thread_id: thread, agent_id: 'fixture', scope: { app: 'fixture', panel: 'main' } });
  const created = await host.next('session_created', inThread);
  if (!isDeepStrictEqual(created.data.scope, { app: 'fixture', panel: 'main' })) failures.push('App scope did not survive session creation');
  await host.next('session_ready', inThread, 10000);
  writeFileSync(resolve(temp,'workspace-preview.json'),'[1,2,3]');
  for (const [action,path,kind] of [['list','.','workspace_files_list'],['read','workspace-preview.json','workspace_files_document'],['read','../outside','workspace_files_error']]) {
    host.send({method:'workspace_files',action,path,thread_id:thread,request_id:`files-${action}-${path}`});
    const event=await host.next(kind, inThread);
    if(event.thread_id!==thread) failures.push('Workspace file response lost conversation identity');
  }


  // Current Host wire contains pane-owned tabs; old local checkpoint shapes are
  // deliberately excluded from new save commands, even though Rust migrates them on load.
  const conversation = {kind:'conversation',value:thread};
  const route = {kind:'content',value:conversation};
  const tabSet = {
    items:[{id:1,route}],active:1,preview:1,pinned_count:0,activation_history:[1],
    history:{reading:null,preview:true,back:[{route,preview:true}],forward:[]},
    closed:[{route}],
  };
  const checkpoint = {
    version:1,workspace:temp,documents:[],web:[],
    navigation:{items:[conversation],route,other:null,focused:'left',reading:null,back:[],forward:[],
      panes:{root:{kind:'leaf',view:{id:1,tabs:tabSet}},focused:1,next_id:2,next_view_id:2}},
  };
  const saveCheckpoint = {method:'workspace',action:'save',request_id:'pane-tabs-wire',session:checkpoint,sources:[],refresh:[]};
  for (const [label, mutate] of [
    ['old leaf', value => {value.session.navigation.panes.root.view={id:1,route,reading:null};}],
    ['missing view allocator', value => {delete value.session.navigation.panes.next_view_id;}],
    ['route-only history', value => {value.session.navigation.panes.root.view.tabs.history.back=[route];}],
    ['unknown nested history field', value => {value.session.navigation.panes.root.view.tabs.history.extra=true;}],
  ]) {
    const invalid=structuredClone(saveCheckpoint);mutate(invalid);
    if (validator('SaveWorkspaceSession')(invalid)) failures.push(`New workspace save schema accepted ${label}`);
  }
  host.send(saveCheckpoint);
  await host.next('workspace_saved', event => event.request_id==='pane-tabs-wire');
  host.send({method:'workspace',action:'get'});
  const restoredCheckpoint=await host.next('workspace_restored', event=>event.data.session?.navigation?.panes?.root?.view?.tabs?.preview===1);
  if (!isDeepStrictEqual(restoredCheckpoint.data.session,checkpoint)) failures.push('Pane tab state, preview history, or closed items changed across Host save/get');

  host.send({ action: 'prompt', thread_id: thread, text: 'hello', contexts:[context.data] });
  await host.next('user_message', inThread);
  await host.next('turn_finished', inThread);

  host.send({ action: 'prompt', thread_id: thread, text: 'needs permission' });
  const permission = await host.next('permission', inThread);
  host.send({ action: 'permission', thread_id: thread, request_id: permission.data.permission_id, option_id: 'allow' });
  await host.next('turn_finished', inThread);

  host.send({ action: 'model', thread_id: thread, model_id: 'fixture' });
  await host.next('model_changed', inThread);

  host.send({ action: 'prompt', thread_id: thread, text: 'wait' });
  await host.next('turn_started', inThread);
  host.send({ action: 'prompt', thread_id: thread, text: 'queued follow-up' });
  await host.next('prompt_queued', inThread);
  host.send({ action: 'cancel', thread_id: thread });
  await host.next('turn_finished', (e) => inThread(e) && e.data?.stopReason === 'cancelled');

  host.send({ action: 'authenticate', thread_id: thread, method_id: 'none' });
  await host.next('session_auth_error', inThread);
  host.send({ action: 'close', thread_id: thread });
  await host.next('session_closed', inThread);
  host.send({ action: 'prompt', thread_id: thread, text: 'after close' });
  await host.next('session_error', inThread);
  host.send({action:'new_session',thread_id:'settings-contract',agent_id:'settings-fixture',scope:{app:'fixture',panel:'main'}});
  await host.next('session_ready',e=>e.thread_id==='settings-contract');
  host.send({action:'configure',thread_id:'settings-contract',config_id:'effort',value:'low'});
  await host.next('configuration_changed',e=>e.thread_id==='settings-contract');
  host.send({action:'close',thread_id:'settings-contract'});
  await host.next('session_closed',e=>e.thread_id==='settings-contract');
  host.send({action:'search_context',request_id:'thread-before-delete',kind:'thread',query:'hello'});
  const beforeDelete = await host.next('context_candidates', e => e.request_id === 'thread-before-delete');
  if (!beforeDelete.data.some(item => item.source === thread)) failures.push('saved thread was not searchable before delete');
  host.send({action:'new_session',thread_id:'delete-live',agent_id:'fixture'});
  await host.next('session_ready', e => e.thread_id === 'delete-live', 10000);
  host.send({action:'delete',thread_id:'delete-live'});
  await host.next('session_deleted', e => e.thread_id === 'delete-live');
  await host.next('session_closed', e => e.thread_id === 'delete-live');
  host.send({action:'prompt',thread_id:'delete-live',text:'after delete'});
  await host.next('session_error', e => e.thread_id === 'delete-live');
  host.send({action:'delete',thread_id:thread});
  await host.next('session_deleted', inThread);
  host.send({action:'search_context',request_id:'thread-after-delete',kind:'thread',query:'hello'});
  const afterDelete = await host.next('context_candidates', e => e.request_id === 'thread-after-delete');
  if (afterDelete.data.some(item => item.source === thread || item.source === 'delete-live')) failures.push('deleted thread remained searchable');
  // A renderer reload must receive observations newer than session_ready,
  // including both a post-startup disconnect and a subsequent recovery.
  const runtimeThread = 'runtime-contract';
  host.send({action:'new_session',thread_id:runtimeThread,agent_id:'runtime-fixture'});
  await host.next('session_ready', event => event.thread_id === runtimeThread);
  for (const [text, status] of [['disconnect','disconnected'], ['recover','connected']]) {
    host.send({action:'prompt',thread_id:runtimeThread,text});
    const changed = await host.next('mcp_runtime', event => event.thread_id === runtimeThread
      && event.data.servers.some(server => server.server === 'docs' && server.status === status && server.generation > 2));
    await host.next('turn_finished', event => event.thread_id === runtimeThread);
    host.send({action:'list_agents'});
    await host.next('replay');
    const refreshed = await host.next('mcp_runtime', event => event.thread_id === runtimeThread
      && event.data.servers.some(server => server.server === 'docs' && server.generation === changed.data.servers.find(server => server.server === 'docs').generation));
    if (!isDeepStrictEqual(refreshed.data, changed.data)) failures.push('renderer reconnect restored a stale MCP observation');
  }
  await host.stop();

  // A malformed byte line must not hide later intact conversations. Replaying
  // recovers valid records without rewriting the source journal.
  const journal = readFileSync(env.PERO_HISTORY_PATH);
  const boundary = journal.indexOf(10) + 1;
  const damaged = Buffer.concat([journal.subarray(0,boundary), Buffer.from([0xff,0xfe,10]), Buffer.from('{malformed}\n'), journal.subarray(boundary)]);
  writeFileSync(env.PERO_HISTORY_PATH, damaged);
  // A fresh Host replays the journal written above.
  // The ACP fixture reports failure without connecting to this inert endpoint.
  const connectorUrl = 'http://127.0.0.1:1/mcp', connectorSecret = 'ab'.repeat(32);
  host = startHost({PERO_CONNECTORS_URL:connectorUrl, PERO_CONNECTORS_TOKEN:connectorSecret});
  await host.next('ready');
  host.send({method:'settings.workbench.get'});
  if (!isDeepStrictEqual((await host.next('workbench_settings')).data,workbench)) failures.push('Workbench preferences were lost after Host restart');
  if (!isDeepStrictEqual(preferences().remote_connection, storedConnection)) failures.push('Remote preference was lost after Host restart');
  host.send({ method: 'settings.remote', id: 'remote-disconnect', connection: null });
  await host.next('remote_settings_saved', e => e.request_id === 'remote-disconnect');
  if (preferences().remote_connection !== null || preferences().locale !== 'zh-CN') failures.push('Disconnect must retain a tombstone and preserve locale');
  host.send({ action: 'list_agents' });
  const replay = await host.next('replay');
  if (!replay.data.events.length) failures.push('replay after restart contained no events');
  if (replay.data.events.some(event => event.thread_id === thread || event.thread_id === 'delete-live')) failures.push('deleted thread was replayed');
  if (!replay.data.events.some(event => event.thread_id === 'settings-contract')) failures.push('deleting a thread removed unrelated history');
  if (!replay.data.events.some(event => event.thread_id === 'settings-contract' && event.kind === 'session_created' && isDeepStrictEqual(event.data.scope, {app:'fixture',panel:'main'}))) failures.push('App scope was lost after Host restart');
  if (!readFileSync(env.PERO_HISTORY_PATH).equals(damaged)) failures.push('history recovery rewrote the source journal');
  host.send({action:'new_session',thread_id:'builtin-contract',agent_id:'runtime-fixture'});
  const builtinReady = await host.next('session_ready', event => event.thread_id === 'builtin-contract');
  const builtin = builtinReady.data.peroMcp.servers.find(server => server.server === 'pero-connectors');
  if (!isDeepStrictEqual(builtin, {server:'pero-connectors',generation:3,status:'error',tools:[]})) failures.push('Host-bound optional Connector failure was hidden or exposed private fields');
  const publicSnapshot = JSON.stringify(builtinReady.data.peroMcp);
  if ([connectorUrl, connectorSecret, 'Authorization', 'headers'].some(value => publicSnapshot.includes(value))) failures.push('Connector transport or credentials reached the public runtime snapshot');
  await host.stop();
} catch (error) {
  failures.push(String(error));
} finally {
  try {
    // close, unlike exit, also waits for inherited stdout to drain. Never remove
    // a Windows working directory while one of this test's Hosts still owns it.
    await Promise.all(hosts.map(host => host.stop()));
    rmSync(temp, { recursive: true, force: true });
  } catch (error) {
    failures.push(`Host cleanup: ${error}`);
  }
}

const declared = [...eventVariants.keys()];
const undeclared = [...seen].filter((kind) => !kind.startsWith('replay:') && !declared.includes(kind));
const unexercised = declared.filter((kind) => !seen.has(kind));
if (undeclared.length) failures.push(`Host emitted kinds missing from host.tsp: ${undeclared.join(', ')}`);
console.log(`Observed ${[...seen].filter((k) => !k.startsWith('replay:')).length}/${declared.length} declared event kinds.`);
if (unexercised.length) console.log(`Not exercised here: ${unexercised.join(', ')}`);
if (failures.length) {
  console.error(`\n${failures.length} contract failure(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('Host protocol conformance passed.');
