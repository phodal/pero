// Provider metadata and definition matching, ported from Point.
// Configuration, authorization, runtime and tool policy remain separate facts.
// The directory is declarative metadata, never an integration acceptance claim.

import { computingDirectory, R_MCP_EXPRESSION } from './computing-directory.mjs';
import { researchDirectory } from './research-directory.mjs';
import { publicDataDirectory, publicDataProviderId } from './public-data-directory.mjs';
import { scienceDirectory } from './science/directory.mjs';
import { scienceProviderId } from './science/specs.mjs';
import { channelFields } from './channel-fields.mjs';
import { BOT_CHANNEL_IDS, botChannelId } from './channels/bot-definition.mjs';

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KINDS = new Set(['text', 'url', 'path', 'secretRef']);
const EFFECTS = new Set(['read', 'write', 'delete', 'share', 'external_send']);
const MODES = new Set(['none', 'user-oauth', 'user-qr', 'shared-token', 'service-identity']);
const REGISTRATIONS = new Set(['none', 'dcr', 'preregistered']);
const CAPABILITY_PLANES = new Set(['identity', 'context', 'tool', 'event', 'execution', 'delivery']);
const CAPABILITY_AVAILABILITY = new Set(['available', 'delegated', 'gated']);
const CATALOG_STAGES = new Set(['tenant', 'review', 'vendor', 'upcoming', 'planned']);
const CONNECTOR_ICONS = new Set(['cad', 'signal', 'replay', 'evidence', 'target', 'simulation', 'notebook', 'gateway', 'test', 'manufacturing', 'circuit', 'workflow', 'protein', 'bom', 'instrument', 'robot']);
export const MAX_RECOMMENDED_SCOPES = 128;
export const MAX_DECLARED_OPERATIONS = 256;
export const MAX_DECLARED_CAPABILITIES = 64;

const fail = message => { throw Object.assign(new Error(message), { code: 'MCP_DIRECTORY' }); };

function validate(definition) {
  if (!definition || typeof definition !== 'object') fail('connectors: directory entry must be an object');
  if (!PROVIDER_ID.test(definition.providerId ?? '')) fail(`connectors: invalid providerId ${definition.providerId}`);
  if (typeof definition.displayName !== 'string' || !definition.displayName.trim()) fail(`connectors: provider ${definition.providerId} needs a display name`);
  for (const key of ['summary', 'summaryEn', 'prerequisiteCopy', 'prerequisiteEn', 'gotchaCopy', 'gotchaEn', 'endpoint', 'oauthIssuer', 'brand']) {
    if (definition[key] !== undefined && (typeof definition[key] !== 'string' || !definition[key].trim())) fail(`connectors: provider ${definition.providerId} has invalid ${key}`);
  }
  for (const key of ['vendorApprovalPending', 'launchGatePassed', 'preregistered']) {
    if (definition[key] !== undefined && typeof definition[key] !== 'boolean') fail(`connectors: provider ${definition.providerId} has invalid ${key}`);
  }
  if (definition.catalogStage !== undefined && !CATALOG_STAGES.has(definition.catalogStage)) fail(`connectors: provider ${definition.providerId} has invalid catalogStage`);
  if (definition.iconId !== undefined && !CONNECTOR_ICONS.has(definition.iconId)) fail(`connectors: provider ${definition.providerId} has invalid iconId`);
  if (definition.listed !== undefined && typeof definition.listed !== 'boolean') fail(`connectors: provider ${definition.providerId} has invalid listed`);
  if (definition.listed === true && (!['review', 'vendor', 'upcoming', 'planned'].includes(definition.catalogStage) || definition.preregistered === true || definition.launchGatePassed === true)) {
    fail(`connectors: provider ${definition.providerId} cannot list an installable candidate`);
  }
  // A launch template only pre-fills a new stdio definition. It may carry
  // arguments and timeouts, never the executable, its digest or environment:
  // those are the operator's own machine facts and stay theirs to supply.
  const template = definition.stdioTemplate;
  if (template !== undefined) {
    const bounded = value => value === undefined || (Number.isSafeInteger(value) && value >= 1 && value <= 45000);
    if (definition.transport !== 'stdio' || !template || typeof template !== 'object' ||
        Object.keys(template).some(key => !['args', 'callTimeoutMs', 'initializeTimeoutMs'].includes(key)) ||
        !Array.isArray(template.args ?? []) || (template.args ?? []).some(arg => typeof arg !== 'string' || arg.includes('\0')) ||
        !bounded(template.callTimeoutMs) || !bounded(template.initializeTimeoutMs)) {
      fail(`connectors: provider ${definition.providerId} has an invalid stdioTemplate`);
    }
  }
  // Discovery names what the trusted host may look for on this machine: bare
  // executable names (never paths) and whether to look for MATLAB installs.
  const discovery = definition.discovery;
  if (discovery !== undefined && (definition.transport !== 'stdio' || !discovery || typeof discovery !== 'object' ||
      Object.keys(discovery).some(key => !['executables', 'prefix', 'matlabRoot', 'extensionFile'].includes(key)) ||
      !Array.isArray(discovery.executables) || !discovery.executables.length ||
      discovery.executables.some(name => typeof name !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(name)) ||
      ['prefix', 'matlabRoot', 'extensionFile'].some(key => discovery[key] !== undefined && typeof discovery[key] !== 'boolean'))) {
    fail(`connectors: provider ${definition.providerId} has an invalid discovery`);
  }
  // A managed install is one fixed recipe: a PyPI package installed with uv,
  // or a named asset of a GitHub repository's latest release.
  const install = definition.install;
  if (install !== undefined && (!discovery || !install || typeof install !== 'object' ||
      !(install.kind === 'uv-tool' && Object.keys(install).length === 2 && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(install.package ?? '')) &&
      !(install.kind === 'github-release' && Object.keys(install).length === 3 && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(install.repo ?? '') && /^[A-Za-z0-9._{}-]{1,100}$/.test(install.asset ?? '')))) {
    fail(`connectors: provider ${definition.providerId} has an invalid install`);
  }
  if (definition.installHint !== undefined && (typeof definition.installHint !== 'string' || !definition.installHint.trim())) fail(`connectors: provider ${definition.providerId} has invalid installHint`);
  const auth = definition.auth ?? {};
  if (!MODES.has(auth.mode ?? 'none') || !REGISTRATIONS.has(auth.registration ?? 'none')) fail(`connectors: provider ${definition.providerId} has an unsupported auth strategy`);
  if ((auth.recommendedScopes ?? []).length > MAX_RECOMMENDED_SCOPES) fail(`connectors: provider ${definition.providerId} declares too many recommended scopes`);
  if ((definition.operations ?? []).length > MAX_DECLARED_OPERATIONS) fail(`connectors: provider ${definition.providerId} declares too many operations`);
  if ((definition.capabilities ?? []).length > MAX_DECLARED_CAPABILITIES) fail(`connectors: provider ${definition.providerId} declares too many capabilities`);
  const keys = new Set();
  for (const requirement of definition.requires ?? []) {
    if (!requirement?.key || keys.has(requirement.key) || !KINDS.has(requirement.kind ?? 'text')) fail(`connectors: provider ${definition.providerId} has an invalid requirement`);
    keys.add(requirement.key);
  }
  const tools = new Set();
  for (const operation of definition.operations ?? []) {
    if (!operation?.tool || tools.has(operation.tool) || !EFFECTS.has(operation.effect)) fail(`connectors: provider ${definition.providerId} has an invalid operation`);
    tools.add(operation.tool);
  }
  if (definition.defaultTools !== undefined && (!Array.isArray(definition.defaultTools) ||
      definition.defaultTools.some(tool => typeof tool !== 'string' || !tools.has(tool)) ||
      new Set(definition.defaultTools).size !== definition.defaultTools.length)) fail(`connectors: provider ${definition.providerId} has invalid defaultTools`);
  if (definition.deployment !== undefined && !['local-process', 'local-desktop', 'remote-service', 'on-premise-gateway'].includes(definition.deployment)) fail(`connectors: provider ${definition.providerId} has invalid deployment`);
  if (definition.workTemplate !== undefined && (!definition.workTemplate ||
      ['title', 'titleEn', 'prompt', 'promptEn', 'artifact', 'artifactEn'].some(key => typeof definition.workTemplate[key] !== 'string' || !definition.workTemplate[key].trim() || definition.workTemplate[key].length > 2000))) {
    fail(`connectors: provider ${definition.providerId} has invalid workTemplate`);
  }
  const capabilities = new Set();
  for (const capability of definition.capabilities ?? []) {
    const identity = `${capability?.plane}:${capability?.name}`;
    if (!CAPABILITY_PLANES.has(capability?.plane) || !PROVIDER_ID.test(capability?.name ?? '') ||
        !CAPABILITY_AVAILABILITY.has(capability?.availability) || capabilities.has(identity)) {
      fail(`connectors: provider ${definition.providerId} has an invalid capability`);
    }
    capabilities.add(identity);
  }
  return definition;
}

/** An immutable directory snapshot, validated once so lookups can be trusted. */
export function createCatalog(definitions) {
  const byId = new Map();
  for (const definition of definitions ?? []) {
    validate(definition);
    if (byId.has(definition.providerId)) fail(`connectors: duplicate provider ${definition.providerId}`);
    byId.set(definition.providerId, Object.freeze(structuredClone(definition)));
  }
  return {
    provider: providerId => byId.get(providerId) ?? null,
    providers: () => [...byId.values()].sort((a, b) => a.providerId.localeCompare(b.providerId)),
    // Listing and resolution are deliberately different operations. A hidden
    // provider remains resolvable for development and for an already-stored
    // connection, but is not offered as a new install until its own launch
    // gate passes. Listed candidates are informational cards only; the UI
    // cannot add them. Vendor approval remains a hard install gate.
    visibleProviders: () => [...byId.values()]
      .filter(provider => provider.listed === true || (provider.vendorApprovalPending !== true && (provider.launchGatePassed === true || provider.preregistered === true)))
      .sort((a, b) => a.providerId.localeCompare(b.providerId)),
  };
}

// Microsoft 365 P0 is read-only by construction: the native allowlist maps six
// tools onto Graph read scopes. Declaring that here lets a card state the
// access before the user authorizes, which is the first of the two permission
// disclosures — the second happens per call, at execution time.
import { pointDirectory, engineeringProviderId, argValue } from './catalog-definitions.mjs';
export { pointDirectory };
export const pointCatalog = () => createCatalog(pointDirectory());

const headerSecretRef = (definition, name) => Object.entries(definition?.headers ?? {})
  .find(([key]) => key.toLowerCase() === name)?.[1]?.secretRef;

/**
 * Bridges a stored native definition onto a directory entry. The definition
 * format the signed service validates has no provider field, so the transport
 * plus the presence of an OAuth block is what identifies the entry. This is a
 * mapping, not an identity: the providerId it returns is still never reused as
 * the connection, process or session id.
 */
export function providerIdForDefinition(definition, source) {
  if (botChannelId(definition?.transport)) return botChannelId(definition.transport);
  if (definition?.transport === 'ilink-long-poll') return 'wechat';
  if (definition?.transport === 'websocket') return 'wecom';
  if (definition?.transport === 'lark-long-connection') return 'feishu';
  if (source === 'sealed' || definition?.transport === 'builtin') return 'point-builtin';
  if (definition?.transport === 'gitlab') return 'gitlab';
  if (definition?.transport === 'github') return 'github';
  if (definition?.transport === 'linear') return 'linear';
  if (definition?.transport === 'gmail') return 'gmail';
  if (definition?.transport === 'microsoft365') return 'microsoft-365';
  if (definition?.transport === 'stdio') return engineeringProviderId(definition) ?? 'local-process';
  const publicDataId = publicDataProviderId(definition);
  if (publicDataId) return publicDataId;
  if (definition?.transport === 'http' && definition?.url === 'http://127.0.0.1:7333/mcp') return 'foxglove';
  if (definition?.transport === 'http' && definition?.url === 'https://mcp.platform.opentargets.org/mcp') return 'open-targets';
  if (definition?.transport === 'http' && definition?.url === 'https://agenttools.wolfram.com/mcp') return 'wolfram';
  if (definition?.transport === 'http' && definition?.url === 'https://mcp.withwandb.com/mcp') return 'wandb';
  if (definition?.transport === 'http' && definition?.url === 'http://127.0.0.1:27182') return 'autodesk-fusion';
  if (definition?.transport === 'http' && definition?.url === 'https://api.scite.ai/mcp') return 'scite';
  if (definition?.transport === 'http' && definition?.url === 'https://mcp.synapse.org/mcp') return 'synapse';
  if (definition?.transport === 'http' && definition?.url === 'https://mcp.seqera.io/mcp') return 'seqera';
  if (definition?.transport === 'http' && /^https:\/\/[a-z0-9-]+\.mcp\.benchling\.com\/mcp\/?$/i.test(definition?.url ?? '')) return 'benchling';
  if (definition?.transport === 'http' && /\/mcp\/?$/.test(definition?.url ?? '') && headerSecretRef(definition, 'authorization') === 'highbyte.token') return 'highbyte';
  if (definition?.transport === 'http' && /\/mcp\/?$/.test(definition?.url ?? '') && headerSecretRef(definition, 'apikey') === 'labkey.api-key') return 'labkey';
  if (definition?.transport === 'http' && definition?.url === 'https://mcp.figma.com/mcp') return 'figma';
  if (definition?.transport === 'http' && definition?.url === 'https://mcp.notion.com/mcp') return 'notion';
  if (definition?.transport === 'http' && definition?.url === 'https://mcp.vercel.com') return 'vercel';
  return definition?.oauth ? 'remote-oauth' : 'remote-token';
}

/**
 * Which requirement keys a stored definition satisfies. Only presence is
 * inspected: a secretRef requirement is met by the reference existing, and the
 * value it names never reaches this module.
 */
export function suppliedKeys(definition) {
  const botId = botChannelId(definition?.transport);
  if (botId) return channelFields[botId].requires.filter(field => field.kind === 'secretRef'
    ? !!definition[field.key]?.secretRef : typeof definition[field.key] === 'string' && !!definition[field.key].trim()).map(field => field.key);
  const supplied = [];
  if (typeof definition?.url === 'string' && definition.url) supplied.push('url');
  if (definition?.transport === 'gmail' && definition.appSecret?.secretRef) supplied.push('appSecret');
  if (definition?.oauth?.clientId) supplied.push('clientId');
  if (definition?.oauth?.issuer) supplied.push('oauthIssuer');
  if (definition?.oauth?.redirectUri) supplied.push('redirectUri');
  if (typeof definition?.command === 'string' && definition.command) supplied.push('command');
  if (typeof definition?.sha256 === 'string' && definition.sha256) supplied.push('sha256');
  if (providerIdForDefinition(definition) === 'feishu-workspace') {
    const pins = definition.files ?? [];
    if (pins.some(pin => pin.path === definition.args?.[0] && /^[a-f0-9]{64}$/.test(pin.sha256 ?? ''))) supplied.push('serverScript');
    if (pins.some(pin => pin.path === definition.env?.POINT_FEISHU_CLI && pin.sha256 === definition.env?.POINT_FEISHU_CLI_SHA256 && /^[a-f0-9]{64}$/.test(pin.sha256 ?? ''))) supplied.push('cliBinary');
    if (/^cli_[A-Za-z0-9]+$/.test(definition.env?.POINT_FEISHU_APP_ID ?? '') && /^ou_[A-Za-z0-9]+$/.test(definition.env?.POINT_FEISHU_OPEN_ID ?? '') &&
        /^[A-Za-z0-9._-]{1,64}$/.test(definition.env?.POINT_FEISHU_PROFILE ?? '')) supplied.push('userBinding');
  }
  if (definition?.transport === 'stdio' && argValue(definition, '--matlab-root', 'MW_MCP_SERVER_MATLAB_ROOT')) supplied.push('matlabRoot');
  if (definition?.transport === 'stdio' && argValue(definition, '--extension-file', 'MW_MCP_SERVER_EXTENSION_FILE')) supplied.push('extensionFile');
  if (definition?.transport === 'stdio' && ['fmu-runtime', 'elabftw'].includes(engineeringProviderId(definition))) {
    const script = (definition.args ?? []).find(arg => typeof arg === 'string' &&
      (/(?:^|\/)fmu-runtime\/src\/mcp-server\.mjs$/.test(arg) || /(?:^|\/)elabftw-connector\/bin\/stdio\.mjs$/.test(arg)));
    if (script && (definition.files ?? []).some(pin => pin.path === script && /^[a-f0-9]{64}$/.test(pin.sha256 ?? ''))) supplied.push('serverScript');
  }
  if (definition?.transport === 'stdio' && typeof definition.env?.POINT_FMU_MODEL_ROOT === 'string' && definition.env.POINT_FMU_MODEL_ROOT.trim()) supplied.push('modelRoot');
  if (definition?.transport === 'stdio' && typeof definition.env?.POINT_FMU_WORK_ROOT === 'string' && definition.env.POINT_FMU_WORK_ROOT.trim()) supplied.push('workRoot');
  if (definition?.transport === 'stdio' && typeof definition.env?.POINT_FMU_PYTHON === 'string' && definition.env.POINT_FMU_PYTHON.trim()) supplied.push('python');
  if (definition?.transport === 'stdio' && typeof definition.env?.POINT_ELABFTW_API_BASE_URL === 'string' && definition.env.POINT_ELABFTW_API_BASE_URL.trim()) supplied.push('apiBaseUrl');
  if (definition?.transport === 'stdio' && definition.env?.POINT_ELABFTW_API_KEY?.secretRef &&
      definition.env.POINT_ELABFTW_API_KEY.secretRef === definition.env?.POINT_ELABFTW_SECRET_REF) supplied.push('token');
  if (['gitlab', 'github', 'linear'].includes(definition?.transport) && Object.entries(definition.headers ?? {}).some(([name, binding]) => ['authorization', 'private-token'].includes(name.toLowerCase()) && binding?.secretRef)) supplied.push('token');
  if (definition?.transport === 'http' && definition?.url === 'http://127.0.0.1:7333/mcp' &&
      Object.entries(definition.headers ?? {}).some(([name, binding]) => name.toLowerCase() === 'authorization' && binding?.secretRef)) supplied.push('token');
  if (definition?.transport === 'http' && ['seqera', 'highbyte', 'labkey', 'wandb'].includes(providerIdForDefinition(definition)) &&
      Object.entries(definition.headers ?? {}).some(([name, binding]) => ['authorization', 'apikey'].includes(name.toLowerCase()) && binding?.secretRef)) supplied.push('token');
  if (definition?.transport === 'stdio') {
    for (const [variable, key] of [['MLFLOW_TRACKING_URI', 'trackingUrl'], ['GALAXY_URL', 'galaxyUrl'], ['JUPYTER_URL', 'jupyterUrl'], ['DOCUMENT_ID', 'notebookPath']]) {
      if (typeof definition.env?.[variable] === 'string' && definition.env[variable].trim()) supplied.push(key);
    }
    if ((engineeringProviderId(definition) === 'galaxy' && definition.env?.GALAXY_API_KEY?.secretRef) ||
        (engineeringProviderId(definition) === 'jupyter' && definition.env?.JUPYTER_TOKEN?.secretRef)) supplied.push('token');
  }
  if (Array.isArray(definition?.tools) && definition.tools.length) supplied.push('tools');
  if (typeof definition?.botId === 'string' && definition.botId) supplied.push('botId');
  if (definition?.secret?.secretRef) supplied.push('secret');
  if (typeof definition?.appId === 'string' && definition.appId) supplied.push('appId');
  if (definition?.appSecret?.secretRef) supplied.push('appSecret');
  if (typeof definition?.allowedOpenIds === 'string' && definition.allowedOpenIds) supplied.push('allowedOpenIds');
  return supplied;
}

/** A human-readable origin for the card subtitle, with no credential material. */
export function connectionOrigin(definition) {
  if (botChannelId(definition?.transport)) return definition.tenantId || definition.corpId || definition.appId || '机器人消息渠道';
  if (definition?.transport === 'stdio') return definition.command ?? '本地进程';
  if (definition?.transport === 'builtin') return 'Pero 内置服务';
  if (definition?.transport === 'ilink-long-poll') return definition.accountId ? `微信账号 ${definition.accountId}` : '扫码后显示账号';
  if (definition?.transport === 'websocket') return definition.botId ? `机器人 ${definition.botId}` : '待配置机器人';
  if (definition?.transport === 'lark-long-connection') return definition.appId ? `应用 ${definition.appId}` : '待配置应用';
  try { return new URL(definition?.url).host; } catch { return '服务地址待检查'; }
}
