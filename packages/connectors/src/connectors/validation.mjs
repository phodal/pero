import { isAbsolute } from 'node:path';
import { realpath, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { botChannelId, validateBotChannel } from './channels/bot-definition.mjs';
const fail = code => Object.assign(new Error(code), { code });
const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
const fields = new Set(['transport', 'tools', 'command', 'sha256', 'cwd', 'args', 'files', 'url', 'oauth', 'allowLoopbackHttp', 'env', 'headers', 'callTimeoutMs', 'initializeTimeoutMs',
  'accountId', 'token', 'botId', 'secret', 'appId', 'appSecret', 'allowedOpenIds', 'allowedUserIds', 'baseUrl', 'mentionOwnerOpenId', 'mentionChatIds', 'mentionVoice']);
const channelTransports = new Set(['ilink-long-poll', 'websocket', 'lark-long-connection']);
const m365Tools = new Map([
  ['m365_account_get', ['User.Read']],
  ['m365_mail_list', ['Mail.ReadBasic', 'Mail.Read']],
  ['m365_mail_get', ['Mail.Read']],
  ['m365_calendar_list', ['Calendars.Read']],
  ['m365_drive_list', ['Files.Read']],
  ['m365_drive_item_get', ['Files.Read']],
]);
const m365Scopes = new Set(['offline_access', 'User.Read', 'Mail.ReadBasic', 'Mail.Read', 'Calendars.Read', 'Files.Read']);
const gitlabTools = new Set(['gitlab_user_get', 'gitlab_project_list', 'gitlab_project_get', 'gitlab_repository_tree_list', 'gitlab_repository_file_get', 'gitlab_issue_list', 'gitlab_issue_get', 'gitlab_merge_request_list', 'gitlab_merge_request_get', 'gitlab_pipeline_list', 'gitlab_pipeline_get', 'gitlab_pipeline_job_list', 'gitlab_job_trace_get']);
const githubTools = new Set(["github_account_get", "github_repository_list", "github_issue_list", "github_issue_get", "github_pull_request_get", "github_pull_request_search", "github_pull_request_files", "github_repository_get", "github_pull_request_list", "github_branch_list", "github_branch_get", "github_compare_get", "github_commit_get", "github_tree_get", "github_blob_get", "github_pull_request_comments", "github_pull_request_review_comments", "github_pull_request_reviews", "github_commit_checks", "github_commit_statuses", "github_factory_blob_create", "github_factory_tree_create", "github_factory_commit_create", "github_factory_branch_create", "github_factory_draft_create", "github_factory_pull_lookup", "github_factory_branch_advance"]);
const linearTools = new Set(['linear_viewer_get', 'linear_team_list', 'linear_issue_list', 'linear_issue_get']);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function validateMicrosoft365(value) {
  let graph, issuer, redirect;
  try { graph = new URL(value.url); issuer = new URL(value.oauth?.issuer); redirect = new URL(value.oauth?.redirectUri); } catch { throw fail('MCP_CONFIG'); }
  const oauth = value.oauth;
  const tenant = issuer.pathname.split('/').filter(Boolean);
  if (value.url !== 'https://graph.microsoft.com/v1.0/' || graph.href !== value.url || graph.username || graph.password || graph.search || graph.hash ||
      issuer.protocol !== 'https:' || issuer.hostname !== 'login.microsoftonline.com' || issuer.username || issuer.password || issuer.search || issuer.hash || tenant.length !== 2 || tenant[1] !== 'v2.0' || !(tenant[0] === 'organizations' || uuid(tenant[0])) ||
      !oauth || Object.keys(oauth).some(k => !['issuer', 'clientId', 'redirectUri', 'scopes', 'persist'].includes(k)) || !uuid(oauth.clientId) || oauth.persist !== true || !Array.isArray(oauth.scopes) || oauth.scopes.length < 2 || oauth.scopes.length > m365Scopes.size || new Set(oauth.scopes).size !== oauth.scopes.length || oauth.scopes.some(s => !m365Scopes.has(s)) || !oauth.scopes.includes('offline_access') ||
      redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || !redirect.port || redirect.username || redirect.password || redirect.search || redirect.hash ||
      value.tools.some(tool => !m365Tools.has(tool) || !m365Tools.get(tool).some(scope => oauth.scopes.includes(scope))) ||
      ['command', 'sha256', 'cwd', 'args', 'files', 'allowLoopbackHttp'].some(key => value[key] !== undefined) || Object.keys(value.env ?? {}).length || Object.keys(value.headers ?? {}).length) throw fail('MCP_CONFIG');
}
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_TOOLS = Object.freeze(['gmail_account_get', 'gmail_message_list', 'gmail_message_get', 'gmail_thread_get']);
function validateGmail(value) {
  const oauth = value.oauth;
  let redirect;
  try { redirect = new URL(oauth?.redirectUri); } catch { throw fail('MCP_CONFIG'); }
  if (value.url !== 'https://gmail.googleapis.com/gmail/v1/users/me/' || oauth?.issuer !== 'https://accounts.google.com' ||
      Object.keys(oauth).some(k => !['issuer', 'clientId', 'redirectUri', 'scopes', 'persist'].includes(k)) ||
      !/^[a-zA-Z0-9.-]+\.apps\.googleusercontent\.com$/.test(oauth.clientId ?? '') || oauth.clientId.length > 256 || oauth.persist !== true ||
      !Array.isArray(oauth.scopes) || oauth.scopes.length !== 1 || oauth.scopes[0] !== GMAIL_SCOPE ||
      redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || !redirect.port || redirect.username || redirect.password || redirect.search || redirect.hash ||
      !value.appSecret || Object.keys(value.appSecret).length !== 1 || !id(value.appSecret.secretRef) ||
      value.tools.some(t => !GMAIL_TOOLS.includes(t)) ||
      ['command','sha256','cwd','args','files','allowLoopbackHttp','token','secret','accountId','botId','appId','allowedOpenIds','allowedUserIds'].some(k => value[k] !== undefined) ||
      Object.keys(value.env ?? {}).length || Object.keys(value.headers ?? {}).length) throw fail('MCP_CONFIG');
}
function validateGitHub(value) {
  let api;
  try { api = new URL(value.url); } catch { throw fail('MCP_CONFIG'); }
  const headerEntries = Object.entries(value.headers ?? {});
  const authorization = headerEntries[0]?.[1];
  if (value.url !== 'https://api.github.com/' || api.href !== value.url || api.username || api.password || api.search || api.hash ||
      value.oauth !== undefined || value.allowLoopbackHttp !== undefined ||
      ['command', 'sha256', 'cwd', 'args', 'files'].some(key => value[key] !== undefined) || Object.keys(value.env ?? {}).length ||
      headerEntries.length !== 1 || headerEntries[0][0].toLowerCase() !== 'authorization' ||
      !authorization || typeof authorization !== 'object' || Array.isArray(authorization) || Object.keys(authorization).length !== 1 || !id(authorization.secretRef) ||
      value.tools.some(tool => !githubTools.has(tool))) throw fail('MCP_CONFIG');
}
function validateGitLab(value) {
  let api;
  try { api = new URL(value.url); } catch { throw fail('MCP_CONFIG'); }
  const headerEntries = Object.entries(value.headers ?? {});
  const [headerName, credential] = headerEntries[0] ?? [];
  if (api.href !== value.url || api.protocol !== 'https:' || !api.hostname || api.username || api.password || api.search || api.hash || !api.pathname.endsWith('/api/v4/') ||
      value.oauth !== undefined || value.allowLoopbackHttp !== undefined ||
      ['command', 'sha256', 'cwd', 'args', 'files'].some(key => value[key] !== undefined) || Object.keys(value.env ?? {}).length ||
      headerEntries.length !== 1 || !['authorization', 'private-token'].includes(headerName?.toLowerCase()) ||
      !credential || typeof credential !== 'object' || Array.isArray(credential) || Object.keys(credential).length !== 1 || !id(credential.secretRef) ||
      value.tools.some(tool => !gitlabTools.has(tool))) throw fail('MCP_CONFIG');
}
function validateLinear(value) {
  let api;
  try { api = new URL(value.url); } catch { throw fail('MCP_CONFIG'); }
  const headerEntries = Object.entries(value.headers ?? {}), authorization = headerEntries[0]?.[1];
  if (value.url !== 'https://api.linear.app/graphql' || api.href !== value.url || api.username || api.password || api.search || api.hash ||
      value.oauth !== undefined || value.allowLoopbackHttp !== undefined ||
      ['command', 'sha256', 'cwd', 'args', 'files'].some(key => value[key] !== undefined) || Object.keys(value.env ?? {}).length ||
      headerEntries.length !== 1 || headerEntries[0][0].toLowerCase() !== 'authorization' ||
      !authorization || typeof authorization !== 'object' || Array.isArray(authorization) || Object.keys(authorization).length !== 1 || !id(authorization.secretRef) ||
      value.tools.some(tool => !linearTools.has(tool))) throw fail('MCP_CONFIG');
}
// A channel is a messaging destination, not a tool server: it carries no
// `url`/`command` and instead the identity + credential a scan or a shared
// bot secret produced. `tools` is still required so the same discovery /
// admission machinery as every other transport applies to its operations.
function validateWechat(value) {
  if (value.accountId !== undefined && (typeof value.accountId !== 'string' || !value.accountId || value.accountId.length > 128)) throw fail('MCP_CONFIG');
  if (value.token !== undefined && (!value.token || typeof value.token !== 'object' || Array.isArray(value.token) || Object.keys(value.token).length !== 1 || !id(value.token.secretRef))) throw fail('MCP_CONFIG');
  // Point's own policy field (not part of the iLink protocol), same shape as
  // feishu's allowedOpenIds: optional, but when present must be a real
  // allowlist string. Absent means deny-all at runtime, not "unset".
  if (value.allowedUserIds !== undefined && (typeof value.allowedUserIds !== 'string' || !value.allowedUserIds || value.allowedUserIds.length > 4096)) throw fail('MCP_CONFIG');
  // The business API node a QR login named; only an https WeChat origin.
  if (value.baseUrl !== undefined) {
    let node;
    try { node = new URL(value.baseUrl); } catch { throw fail('MCP_CONFIG'); }
    if (node.protocol !== 'https:' || node.origin !== value.baseUrl || !(node.hostname === 'weixin.qq.com' || node.hostname.endsWith('.weixin.qq.com'))) throw fail('MCP_CONFIG');
  }
  if (['command', 'sha256', 'cwd', 'args', 'files', 'url', 'oauth', 'allowLoopbackHttp', 'botId', 'secret', 'appId', 'appSecret', 'allowedOpenIds'].some(key => value[key] !== undefined) || Object.keys(value.env ?? {}).length || Object.keys(value.headers ?? {}).length) throw fail('MCP_CONFIG');
}
function validateWecom(value) {
  if (typeof value.botId !== 'string' || !value.botId || value.botId.length > 128) throw fail('MCP_CONFIG');
  if (!value.secret || typeof value.secret !== 'object' || Array.isArray(value.secret) || Object.keys(value.secret).length !== 1 || !id(value.secret.secretRef)) throw fail('MCP_CONFIG');
  // Point's own sender allowlist, same shape as wechat's: optional, and
  // absent means deny-all at runtime, never allow-all.
  if (value.allowedUserIds !== undefined && (typeof value.allowedUserIds !== 'string' || !value.allowedUserIds || value.allowedUserIds.length > 4096)) throw fail('MCP_CONFIG');
  if (['command', 'sha256', 'cwd', 'args', 'files', 'url', 'oauth', 'allowLoopbackHttp', 'accountId', 'token', 'appId', 'appSecret', 'allowedOpenIds'].some(key => value[key] !== undefined) || Object.keys(value.env ?? {}).length || Object.keys(value.headers ?? {}).length) throw fail('MCP_CONFIG');
}
function validateFeishu(value) {
  const owner = value.mentionOwnerOpenId, chats = value.mentionChatIds;
  if (owner !== undefined || chats !== undefined || value.mentionVoice !== undefined) {
    if (typeof owner !== 'string' || !/^ou_[A-Za-z0-9_-]{1,128}$/.test(owner) || typeof chats !== 'string' || chats.length > 4096) throw fail('MCP_CONFIG');
    const ids = chats.split(',').map(id => id.trim());
    if (!ids.length || ids.length > 32 || new Set(ids).size !== ids.length || ids.some(id => !/^oc_[A-Za-z0-9_-]{1,128}$/.test(id))) throw fail('MCP_CONFIG');
    if (value.mentionVoice !== undefined && (typeof value.mentionVoice !== 'string' || Buffer.byteLength(value.mentionVoice) > 1000 || /[\0\r\n]/.test(value.mentionVoice))) throw fail('MCP_CONFIG');
  }
  if (typeof value.appId !== 'string' || !value.appId || value.appId.length > 128) throw fail('MCP_CONFIG');
  if (!value.appSecret || typeof value.appSecret !== 'object' || Array.isArray(value.appSecret) || Object.keys(value.appSecret).length !== 1 || !id(value.appSecret.secretRef)) throw fail('MCP_CONFIG');
  if (typeof value.allowedOpenIds !== 'string' || !value.allowedOpenIds || value.allowedOpenIds.length > 4096) throw fail('MCP_CONFIG');
  if (['command', 'sha256', 'cwd', 'args', 'files', 'url', 'oauth', 'allowLoopbackHttp', 'accountId', 'token', 'botId', 'secret', 'allowedUserIds'].some(key => value[key] !== undefined) || Object.keys(value.env ?? {}).length || Object.keys(value.headers ?? {}).length) throw fail('MCP_CONFIG');
}
export async function validateConnector(input, { verifyFiles = true } = {}) {
  const value = clone(input);
  if (value?.transport !== 'lark-long-connection' && ['mentionOwnerOpenId', 'mentionChatIds', 'mentionVoice'].some(key => value?.[key] !== undefined)) throw fail('MCP_CONFIG');
  if (botChannelId(value?.transport)) return validateBotChannel(value);
  if (value?.transport === 'sse') throw Object.assign(new Error('Legacy HTTP+SSE is unsupported; use the server\'s Streamable HTTP endpoint with transport: http'), { code: 'MCP_TRANSPORT_UNSUPPORTED' });
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.has(k)) || !['stdio', 'http', 'gitlab', 'github', 'linear', 'microsoft365', 'gmail', ...channelTransports].includes(value.transport)) throw fail('MCP_CONFIG');
  // An empty allowlist is admissible: it admits nothing. A connection has to
  // be able to exist before its tools have been discovered.
  if (value.baseUrl !== undefined && value.transport !== 'ilink-long-poll') throw fail('MCP_CONFIG');
  if (!Array.isArray(value.tools) || value.tools.length > 128 || value.tools.some(x => typeof x !== 'string' || !x || x.length > 128) || new Set(value.tools).size !== value.tools.length) throw fail('MCP_CONFIG');
  for (const key of ['callTimeoutMs', 'initializeTimeoutMs']) if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > 45000)) throw fail('MCP_CONFIG');
  for (const field of ['env', 'headers']) {
    const entries = value[field] ?? {};
    if (!entries || Array.isArray(entries) || typeof entries !== 'object' || Object.keys(entries).length > 64) throw fail('MCP_CONFIG');
    const names = new Set();
    for (const [key, binding] of Object.entries(entries)) {
      const upper = key.toUpperCase();
      if (!(field === 'env' ? /^[A-Za-z_][A-Za-z0-9_]{0,127}$/ : /^[A-Za-z0-9_-]{1,128}$/).test(key) || names.has(field === 'headers' ? upper : key)) throw fail('MCP_CONFIG');
      names.add(field === 'headers' ? upper : key);
      if (field === 'env' && (/^(DYLD_|LD_)/.test(upper) || ['NODE_OPTIONS','NODE_PATH','PYTHONPATH','PYTHONHOME','RUBYOPT','PERL5OPT','BASH_ENV','ENV'].includes(upper))) throw fail('MCP_CONFIG');
      if (field === 'headers' && ['HOST','COOKIE','CONTENT-LENGTH','CONTENT-TYPE','TRANSFER-ENCODING','CONNECTION','ACCEPT','ORIGIN','MCP-SESSION-ID','MCP-PROTOCOL-VERSION'].includes(upper)) throw fail('MCP_CONFIG');
      if (typeof binding === 'string') {
        if (binding.length > 16384 || binding.includes('\0') || (field === 'headers' && (/[\r\n]/.test(binding) || upper === 'AUTHORIZATION'))) throw fail('MCP_CONFIG');
      } else if (!binding || Object.keys(binding).length !== 1 || !id(binding.secretRef)) throw fail('MCP_CONFIG');
    }
  }
  if (value.transport === 'stdio') {
    if (!isAbsolute(value.command ?? '') || !/^[a-f0-9]{64}$/.test(value.sha256 ?? '') || !Array.isArray(value.args ?? []) || (value.args ?? []).some(x => typeof x !== 'string' || x.includes('\0'))) throw fail('MCP_CONFIG');
    for (const pin of [{ path: value.command, sha256: value.sha256 }, ...(value.files ?? [])]) {
      if (!isAbsolute(pin.path ?? '') || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? '')) throw fail('MCP_INTEGRITY');
      if (verifyFiles && (await realpath(pin.path) !== pin.path || createHash('sha256').update(await readFile(pin.path)).digest('hex') !== pin.sha256)) throw fail('MCP_INTEGRITY');
    }
    if (value.cwd !== undefined && !isAbsolute(value.cwd)) throw fail('MCP_CONFIG');
    if (value.url || value.oauth || Object.keys(value.headers ?? {}).length) throw fail('MCP_CONFIG');
  } else if (value.transport === 'http') {
    const url = new URL(value.url);
    if (url.username || url.password || url.hash || !(url.protocol === 'https:' || value.allowLoopbackHttp === true && url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw fail('MCP_CONFIG');
    if (['command', 'sha256', 'cwd', 'args', 'files'].some(key => value[key] !== undefined) || Object.keys(value.env ?? {}).length) throw fail('MCP_CONFIG');
    if (value.oauth && Object.keys(value.headers ?? {}).some(k => k.toLowerCase() === 'authorization')) throw fail('MCP_CONFIG');
    if (value.oauth !== undefined) {
      const oauth = value.oauth;
      const registration = oauth?.registration ?? 'preregistered';
      if (!oauth || Array.isArray(oauth) || typeof oauth !== 'object' || Object.keys(oauth).some(k => !['issuer', 'clientId', 'redirectUri', 'scopes', 'persist', 'registration'].includes(k)) || !['preregistered', 'dcr'].includes(registration) ||
          (registration === 'preregistered' ? typeof oauth.clientId !== 'string' || !oauth.clientId : oauth.clientId !== undefined && (typeof oauth.clientId !== 'string' || oauth.clientId.length > 0)) ||
          (oauth.clientId?.length ?? 0) > 1024 || (oauth.persist !== undefined && typeof oauth.persist !== 'boolean') || !Array.isArray(oauth.scopes ?? []) || (oauth.scopes ?? []).some(s => typeof s !== 'string' || !s || s.length > 1024) || (oauth.scopes ?? []).length > 128) throw fail('MCP_CONFIG');
      const issuer = new URL(oauth.issuer), redirect = new URL(oauth.redirectUri);
      if (issuer.username || issuer.password || issuer.hash || !(issuer.protocol === 'https:' || value.allowLoopbackHttp === true && issuer.protocol === 'http:' && issuer.hostname === '127.0.0.1')) throw fail('MCP_CONFIG');
      if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || !redirect.port || Number(redirect.port) < 1 || redirect.username || redirect.password || redirect.search || redirect.hash) throw fail('MCP_CONFIG');
    }
  } else if (value.transport === 'gmail') {
    validateGmail(value);
  } else if (value.transport === 'microsoft365') {
    validateMicrosoft365(value);
  } else if (value.transport === 'gitlab') {
    validateGitLab(value);
  } else if (value.transport === 'github') {
    validateGitHub(value);
  } else if (value.transport === 'linear') {
    validateLinear(value);
  } else if (value.transport === 'ilink-long-poll') {
    validateWechat(value);
  } else if (value.transport === 'websocket') {
    validateWecom(value);
  } else {
    validateFeishu(value);
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 65536) throw fail('MCP_CONFIG');
  return value;
}
