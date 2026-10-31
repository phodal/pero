// Reviewed against vendor docs and read-only OAuth metadata on 2026-09-27.
// Configurable does not mean a real-account connection has passed acceptance.
const readOperations = tools => tools.map(tool => ({ tool, effect: 'read', helpId: 'research.evidence' }));
const oauthRequires = [
  { key: 'url', kind: 'url', required: true },
  { key: 'oauthIssuer', kind: 'url', required: true },
  { key: 'redirectUri', kind: 'url', required: true },
  { key: 'tools', kind: 'text' },
];
const synapseTools = ['search_synapse', 'get_entity', 'get_entity_annotations', 'get_entity_children', 'get_entity_provenance'];
const zoteroTools = ['zotero_search_items', 'zotero_get_collections', 'zotero_get_collection_items', 'zotero_get_item_metadata', 'zotero_get_item_fulltext', 'zotero_get_item_children', 'zotero_get_annotations', 'zotero_get_notes'];
const configurable = { multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true };
const candidate = fields => ({
  transport: 'http', auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
  requires: [], operations: [], defaultTools: [], listed: true, launchGatePassed: false, preregistered: false,
  ...fields,
});

export function researchDirectory() {
  return [
    {
      providerId: 'scite', displayName: 'Scite', category: 'research', transport: 'http', iconId: 'evidence', catalogStage: 'tenant',
      docsUrl: 'https://scite.ai/mcp', endpoint: 'https://api.scite.ai/mcp', oauthIssuer: 'https://api.scite.ai',
      summary: '检索学术文献与支持、反对论点的引用证据', summaryEn: 'Search scholarly literature and supporting or contrasting citation evidence',
      prerequisiteCopy: '需要 Scite 账号及当前可用的 MCP 访问权益；通过 OAuth 动态注册登录。',
      prerequisiteEn: 'Requires a Scite account with current MCP access; sign in using OAuth dynamic registration.',
      gotchaCopy: '默认未允许工具。登录后核对实际工具列表，再选择需要的检索工具；保留 DOI、引用语境和来源。',
      gotchaEn: 'No tools are allowed initially. After sign-in, inspect the actual tool list and select search tools; retain DOIs, citation context, and sources.',
      auth: { mode: 'user-oauth', registration: 'dcr', credentialHolder: 'native-keychain', recommendedScopes: ['mcp'] },
      requires: oauthRequires, operations: [], defaultTools: [], deployment: 'remote-service', ...configurable,
    },
    {
      providerId: 'synapse', displayName: 'Synapse', category: 'research', transport: 'http', iconId: 'protein', catalogStage: 'tenant',
      docsUrl: 'https://python-docs.synapse.org/en/stable/guides/synapse_mcp/', endpoint: 'https://mcp.synapse.org/mcp', oauthIssuer: 'https://mcp.synapse.org/',
      summary: '检索研究数据、实体元数据、注释及数据来源', summaryEn: 'Search research data, entity metadata, annotations, and provenance',
      prerequisiteCopy: '需要 Synapse 账号；受限数据还需相应项目或数据集的访问权限。',
      prerequisiteEn: 'Requires a Synapse account; restricted data also requires project or dataset access.',
      gotchaCopy: '默认申请 openid 与 view，只启用五个读取工具。记录实体 ID、版本和数据来源。',
      gotchaEn: 'Requests only openid and view, with five read tools enabled. Record entity IDs, versions, and provenance.',
      auth: { mode: 'user-oauth', registration: 'dcr', credentialHolder: 'native-keychain', recommendedScopes: ['openid', 'view'] },
      requires: oauthRequires, operations: readOperations(synapseTools), defaultTools: synapseTools, deployment: 'remote-service', ...configurable,
    },
    {
      providerId: 'zotero', displayName: 'Zotero MCP', category: 'research', transport: 'stdio', iconId: 'notebook',
      docsUrl: 'https://github.com/54yyyu/zotero-mcp',
      summary: '搜索本机 Zotero 文献库、全文、笔记与批注', summaryEn: 'Search a local Zotero library, full text, notes, and annotations',
      prerequisiteCopy: '社区维护的 MCP（非 Zotero 官方）。安装 zotero-mcp-server==0.9.1，在 Zotero 7+ 高级设置中启用本地 API，并保持 Zotero 运行。',
      prerequisiteEn: 'Community MCP, not an official Zotero server. Install zotero-mcp-server==0.9.1, enable the local API in Zotero 7+ Advanced settings, and keep Zotero running.',
      gotchaCopy: '默认本地模式、八个读取工具，不配置 Web API 密钥。可选工具组关闭；写入与语义索引工具不在默认允许列表中。',
      gotchaEn: 'Defaults to local mode and eight read tools without a Web API key. Optional toolsets are disabled; writes and semantic indexing are excluded from the default allowlist.',
      auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
      requires: [{ key: 'command', kind: 'path', required: true }, { key: 'sha256', kind: 'text', required: true }, { key: 'tools', kind: 'text' }],
      operations: readOperations(zoteroTools), defaultTools: zoteroTools, deployment: 'local-process',
      discovery: { executables: ['zotero-mcp'] }, stdioTemplate: { args: ['serve'], callTimeoutMs: 45000, initializeTimeoutMs: 45000 },
      installHint: 'uv tool install zotero-mcp-server==0.9.1', ...configurable,
    },
    candidate({
      providerId: 'onshape', displayName: 'Onshape FeatureScript', category: 'engineering', iconId: 'cad', catalogStage: 'review',
      docsUrl: 'https://www.onshape.com/en/blog/get-started-featurescript-mcp-server',
      summary: '通过 FeatureScript 创建与修改参数化 CAD 特征', summaryEn: 'Create and modify parametric CAD features with FeatureScript',
      prerequisiteCopy: '需 Onshape 账号及 Onshape Labs 应用权限；当前 OAuth 元数据要求客户端密钥认证，尚未通过 Point 公共客户端适配验证。',
      prerequisiteEn: 'Requires an Onshape account and Onshape Labs access. Current OAuth metadata requires client-secret authentication; Point public-client compatibility is pending.',
      gotchaCopy: '暂仅提供官方文档。认证兼容与真实 CAD 操作验收通过后开放安装。',
      gotchaEn: 'Documentation only until authentication compatibility and real CAD operations pass acceptance.',
    }),
    candidate({
      providerId: 'quilt', displayName: 'Quilt MCP', category: 'research', iconId: 'evidence', catalogStage: 'vendor',
      docsUrl: 'https://github.com/quiltdata/quilt-mcp-server',
      summary: '检索科学数据包、目录与数据来源', summaryEn: 'Search scientific data packages, catalogs, and provenance',
      prerequisiteCopy: '需 Quilt Catalog 实例、登录及底层数据访问权限；部署与认证需按机构实例配置。',
      prerequisiteEn: 'Requires a Quilt Catalog deployment, sign-in, and underlying data permissions; deployment and authentication are organization-specific.',
      gotchaCopy: '暂仅提供文档，待确定实例地址、凭据边界与工具范围。',
      gotchaEn: 'Documentation only until the instance URL, credential handling, and tool scope are established.',
    }),
    candidate({
      providerId: 'wiley', displayName: 'Wiley Scholar Gateway', category: 'research', iconId: 'evidence', catalogStage: 'vendor',
      docsUrl: 'https://docs.scholargateway.ai/',
      summary: '通过机构授权检索学术出版物与全文证据', summaryEn: 'Search scholarly publications and full-text evidence through institutional access',
      prerequisiteCopy: '需核实机构订阅及 Wiley CONNECT 登录权限；访问权益依当前机构方案而定。',
      prerequisiteEn: 'Confirm institutional subscription and Wiley CONNECT access; availability depends on the current institutional plan.',
      gotchaCopy: '暂仅提供文档；机构授权和 OAuth 兼容性尚待验收。',
      gotchaEn: 'Documentation only; institutional authorization and OAuth compatibility await acceptance.',
    }),
    candidate({
      providerId: 'biorender', displayName: 'BioRender', category: 'research', iconId: 'notebook', catalogStage: 'vendor',
      docsUrl: 'https://help.biorender.com/hc/en-gb/articles/30870978672157-How-to-use-the-BioRender-MCP-connector',
      summary: '搜索科研绘图模板与文件，并生成可编辑图示', summaryEn: 'Search scientific illustration templates and files, and generate editable figures',
      prerequisiteCopy: '需 BioRender 账号及 MCP 权限，生成操作可能消耗 AI credits；Point 接入地址与认证尚待官方确认。',
      prerequisiteEn: 'Requires BioRender account and MCP access. Generation may consume AI credits; Point endpoint and authentication await vendor confirmation.',
      gotchaCopy: '暂仅提供文档，不预设未确认的服务地址或生成工具。',
      gotchaEn: 'Documentation only; no unconfirmed endpoint or generation tools are preset.',
    }),
  ];
}
