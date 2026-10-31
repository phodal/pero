// Most MCP configuration is copied, not typed: a README, another client's
// config file, a teammate's snippet. This module accepts the shapes those
// sources actually use and maps them onto one trusted connector definition.
//
// It converts and reports; it never quietly fixes. Anything the native
// validator would reject — a relative command, a literal Authorization header,
// a missing digest — comes back as a note so the form can say what is still
// needed instead of failing at save time with a bare code.

const CONNECTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
/** Picks the Chinese or English copy; Chinese stays the default for existing callers. */
const copyFor = locale => (zh, en) => locale === 'en' ? en : zh;

/** The wrapper keys the common clients use around a map of servers. */
const WRAPPERS = ['mcpServers', 'servers', 'mcp_servers'];

function unwrap(document) {
  for (const key of WRAPPERS) {
    if (plain(document[key])) return { servers: document[key], named: true };
  }
  // A bare map of one or more servers, with the wrapper omitted.
  const entries = Object.entries(document).filter(([, value]) => plain(value));
  if (entries.length && entries.every(([, value]) => value.command || value.url || value.type)) {
    return { servers: Object.fromEntries(entries), named: true };
  }
  return { servers: { '': document }, named: false };
}

function importStdio(server, notes, t) {
  const definition = { transport: 'stdio', tools: [], command: String(server.command) };
  if (!definition.command.startsWith('/')) {
    // npx/uvx style launchers are the norm in shared snippets, and the native
    // service pins an absolute path plus a digest on purpose. Keep what was
    // written so the user can see what to resolve, and say so.
    notes.push(t(`启动命令 "${definition.command}" 不是绝对路径，请填写可执行文件的完整路径。`, `The command "${definition.command}" is not an absolute path. Enter the full path to the executable.`));
  }
  if (Array.isArray(server.args) && server.args.length) {
    if (server.args.some(argument => typeof argument !== 'string')) fail('MCP_IMPORT_ARGS', t('args 必须都是字符串。', 'Every args entry must be a string.'));
    definition.args = [...server.args];
  }
  if (plain(server.env) && Object.keys(server.env).length) {
    definition.env = {};
    for (const [name, value] of Object.entries(server.env)) {
      if (typeof value !== 'string') { notes.push(t(`环境变量 ${name} 不是字符串，已跳过。`, `Environment variable ${name} is not a string and was skipped.`)); continue; }
      definition.env[name] = value;
    }
    if (Object.keys(definition.env).length) notes.push(t('环境变量按字面值导入。密钥请改成 {"secretRef":"引用名"} 并存入系统凭据存储。', 'Environment variables were imported as literal values. For secrets, use {"secretRef":"name"} and store the value in OS credential storage.'));
    else delete definition.env;
  }
  if (typeof server.cwd === 'string' && server.cwd) definition.cwd = server.cwd;
  notes.push(t('本地进程需要可执行文件的 SHA-256 摘要，导入无法代填。', 'A local process needs the executable’s SHA-256 digest, which import cannot fill in.'));
  return definition;
}

function importHTTP(server, notes, t) {
  let url;
  try { url = new URL(server.url); } catch { fail('MCP_IMPORT_URL', t('服务地址不是合法的 URL。', 'The server address is not a valid URL.')); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    fail('MCP_IMPORT_URL', t('服务地址必须是 HTTPS，本地回环 HTTP 需要在 JSON 里显式写 allowLoopbackHttp。', 'The server address must use HTTPS. Loopback HTTP requires allowLoopbackHttp in the JSON.'));
  }
  const definition = { transport: 'http', tools: [], url: server.url };
  if (url.protocol === 'http:') definition.allowLoopbackHttp = true;
  if (plain(server.headers)) {
    definition.headers = {};
    for (const [name, value] of Object.entries(server.headers)) {
      if (typeof value !== 'string') { notes.push(t(`Header ${name} 不是字符串，已跳过。`, `Header ${name} is not a string and was skipped.`)); continue; }
      if (name.toLowerCase() === 'authorization') {
        // The native validator refuses a literal Authorization value outright.
        // Dropping it here turns a save-time rejection into an instruction.
        notes.push(t('Authorization 的字面值未导入：请在「凭据与密钥」存入系统凭据存储，再用 {"secretRef":"引用名"} 引用。', 'The literal Authorization value was not imported. Store it in OS credential storage under Credentials and secrets, then reference it with {"secretRef":"name"}.'));
        continue;
      }
      definition.headers[name] = value;
    }
    if (!Object.keys(definition.headers).length) delete definition.headers;
  }
  return definition;
}

/**
 * Accepts one pasted document and returns a connector draft.
 *
 * Recognized: a `mcpServers` / `servers` wrapper, a bare map of servers, a
 * single server object, or a definition already in this app's own shape.
 */
export function importConnectorJSON(text, locale = 'zh') {
  const t = copyFor(locale);
  let document;
  try { document = JSON.parse(text); } catch { fail('MCP_IMPORT_JSON', t('不是有效的 JSON。请检查括号、引号和逗号。', 'This is not valid JSON. Check brackets, quotes, and commas.')); }
  if (!plain(document)) fail('MCP_IMPORT_JSON', t('JSON 顶层必须是一个对象。', 'The top level of the JSON must be an object.'));

  const { servers } = unwrap(document);
  const names = Object.keys(servers);
  if (!names.length) fail('MCP_IMPORT_EMPTY', t('这段 JSON 里没有找到服务配置。', 'No server configuration was found in this JSON.'));
  const notes = [];
  if (names.length > 1) notes.push(t(`这段 JSON 含 ${names.length} 个服务，本次只导入 "${names[0]}"。其余请分别粘贴：${names.slice(1).join('、')}。`, `This JSON contains ${names.length} servers; only "${names[0]}" was imported. Paste the others separately: ${names.slice(1).join(', ')}.`));

  const name = names[0];
  const server = servers[name];
  if (!plain(server)) fail('MCP_IMPORT_SHAPE', t('服务配置必须是一个对象。', 'The server configuration must be an object.'));
  // Legacy HTTP+SSE is refused rather than rewritten: guessing a Streamable
  // HTTP endpoint from an SSE one silently points at a different address.
  if (server.type === 'sse' || server.transport === 'sse') {
    fail('MCP_TRANSPORT_UNSUPPORTED', t('旧版 SSE 不再支持，请向服务端索取 Streamable HTTP 地址。', 'Legacy SSE is no longer supported. Ask the server for a Streamable HTTP address.'));
  }

  let definition;
  if (server.command) definition = importStdio(server, notes, t);
  else if (server.url) definition = importHTTP(server, notes, t);
  else fail('MCP_IMPORT_SHAPE', t('服务配置里既没有 command 也没有 url。', 'The server configuration has neither command nor url.'));

  // A definition already in this app's shape keeps the fields the generic
  // formats have no place for, rather than losing them on a round trip.
  for (const key of ['oauth', 'files', 'sha256', 'callTimeoutMs', 'initializeTimeoutMs', 'allowLoopbackHttp']) {
    if (server[key] !== undefined) definition[key] = server[key];
  }
  if (Array.isArray(server.tools) && server.tools.length) definition.tools = server.tools.filter(tool => typeof tool === 'string');
  else notes.push(t('工具白名单需要自己填写：只有明确列出的工具才允许调用。', 'Fill in the tool allowlist yourself: only tools listed explicitly can be called.'));

  const connectorId = CONNECTION_ID.test(name) ? name : '';
  if (name && !connectorId) notes.push(t(`"${name}" 不能直接作为连接 ID（只允许字母、数字、点、下划线和连字符），请另起一个。`, `"${name}" cannot be used as a connection ID (only letters, digits, dots, underscores, and hyphens). Choose another one.`));
  return { connectorId, definition, notes };
}
