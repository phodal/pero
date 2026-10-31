import { computingDirectory, R_MCP_EXPRESSION } from './computing-directory.mjs';
import { researchDirectory } from './research-directory.mjs';
import { publicDataDirectory, publicDataProviderId } from './public-data-directory.mjs';
import { scienceDirectory } from './science/directory.mjs';
import { scienceProviderId } from './science/specs.mjs';
import { channelFields } from './channel-fields.mjs';
import { BOT_CHANNEL_IDS, botChannelId } from './channels/bot-definition.mjs';
const microsoft365Operations = [
  { tool: 'm365_account_get', effect: 'read', helpId: 'm365.account' },
  { tool: 'm365_mail_list', effect: 'read', helpId: 'm365.mail' },
  { tool: 'm365_mail_get', effect: 'read', helpId: 'm365.mail' },
  { tool: 'm365_calendar_list', effect: 'read', helpId: 'm365.calendar' },
  { tool: 'm365_drive_list', effect: 'read', helpId: 'm365.drive' },
  { tool: 'm365_drive_item_get', effect: 'read', helpId: 'm365.drive' },
];

const githubOperations = [
  { tool: 'github_factory_branch_advance', effect: 'external_send', helpId: 'github.pull-requests' },
  { tool: 'github_factory_blob_create', effect: 'external_send', helpId: 'github.pull-requests' },
  { tool: 'github_factory_tree_create', effect: 'external_send', helpId: 'github.pull-requests' },
  { tool: 'github_factory_commit_create', effect: 'external_send', helpId: 'github.pull-requests' },
  { tool: 'github_factory_branch_create', effect: 'external_send', helpId: 'github.pull-requests' },
  { tool: 'github_factory_draft_create', effect: 'external_send', helpId: 'github.pull-requests' },
  { tool: 'github_factory_pull_lookup', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_account_get', effect: 'read', helpId: 'github.account' },
  { tool: 'github_repository_list', effect: 'read', helpId: 'github.repositories' },
  { tool: 'github_issue_list', effect: 'read', helpId: 'github.issues' },
  { tool: 'github_issue_get', effect: 'read', helpId: 'github.issues' },
  { tool: 'github_pull_request_get', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_pull_request_search', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_pull_request_files', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_repository_get', effect: 'read', helpId: 'github.repositories' },
  { tool: 'github_pull_request_list', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_branch_list', effect: 'read', helpId: 'github.repositories' },
  { tool: 'github_branch_get', effect: 'read', helpId: 'github.repositories' },
  { tool: 'github_compare_get', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_commit_get', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_tree_get', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_blob_get', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_pull_request_comments', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_pull_request_review_comments', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_pull_request_reviews', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_commit_checks', effect: 'read', helpId: 'github.pull-requests' },
  { tool: 'github_commit_statuses', effect: 'read', helpId: 'github.pull-requests' },
];
const gitlabOperations = [
  { tool: 'gitlab_user_get', effect: 'read', helpId: 'gitlab.identity' },
  { tool: 'gitlab_project_list', effect: 'read', helpId: 'gitlab.projects' },
  { tool: 'gitlab_project_get', effect: 'read', helpId: 'gitlab.projects' },
  { tool: 'gitlab_repository_tree_list', effect: 'read', helpId: 'gitlab.repository' },
  { tool: 'gitlab_repository_file_get', effect: 'read', helpId: 'gitlab.repository' },
  { tool: 'gitlab_issue_list', effect: 'read', helpId: 'gitlab.issues' },
  { tool: 'gitlab_issue_get', effect: 'read', helpId: 'gitlab.issues' },
  { tool: 'gitlab_merge_request_list', effect: 'read', helpId: 'gitlab.merge-requests' },
  { tool: 'gitlab_merge_request_get', effect: 'read', helpId: 'gitlab.merge-requests' },
  { tool: 'gitlab_pipeline_list', effect: 'read', helpId: 'gitlab.ci' },
  { tool: 'gitlab_pipeline_get', effect: 'read', helpId: 'gitlab.ci' },
  { tool: 'gitlab_pipeline_job_list', effect: 'read', helpId: 'gitlab.ci' },
  { tool: 'gitlab_job_trace_get', effect: 'read', helpId: 'gitlab.ci' },
];
const gitlabCapabilities = [
  { plane: 'identity', name: 'access-token', availability: 'available' },
  { plane: 'context', name: 'repository', availability: 'available' },
  { plane: 'context', name: 'work-items', availability: 'available' },
  { plane: 'context', name: 'merge-requests', availability: 'available' },
  { plane: 'context', name: 'ci', availability: 'available' },
  { plane: 'tool', name: 'rest', availability: 'available' },
  { plane: 'tool', name: 'mcp', availability: 'gated' },
  { plane: 'event', name: 'webhook', availability: 'gated' },
  { plane: 'execution', name: 'local-agent', availability: 'delegated' },
  { plane: 'execution', name: 'gitlab-ci', availability: 'gated' },
  { plane: 'delivery', name: 'branch-merge-request', availability: 'gated' },
];
const linearOperations = [
  { tool: 'linear_viewer_get', effect: 'read', helpId: 'linear.viewer' },
  { tool: 'linear_team_list', effect: 'read', helpId: 'linear.teams' },
  { tool: 'linear_issue_list', effect: 'read', helpId: 'linear.issues' },
  { tool: 'linear_issue_get', effect: 'read', helpId: 'linear.issues' },
];

// Engineering runtimes are vendor/community MCP servers Point
// launches over stdio, so they share local-process's native transport and only
// differ in what is declared about them. Tool names and effects are taken from
// each vendor's source, not from its annotations: running code, launching a
// solver or writing a model is a write even where a server hints otherwise.
const ops = (effect, helpId, tools) => tools.map(tool => ({ tool, effect, helpId }));

const investigationOperations = [
  ...ops('read', 'opcua.observe', ['get_server_status', 'browse_opcua_nodes', 'read_opcua_nodes', 'read_opcua_history', 'read_event_history', 'list_active_alarms', 'list_subscriptions', 'read_events']),
  ...ops('write', 'opcua.monitor', ['subscribe_opcua_nodes', 'unsubscribe_opcua_nodes', 'subscribe_events']),
  ...ops('write', 'opcua.control', ['write_opcua_nodes', 'call_opcua_method', 'acknowledge_alarm', 'act_on_alarm']),
];
const freecadOperations = [
  ...ops('read', 'freecad.inspect', ['list_documents', 'get_objects', 'get_object', 'get_view', 'get_rpc_status', 'get_async_status', 'get_parts_list']),
  ...ops('write', 'freecad.model', ['create_document', 'reload_document', 'create_object', 'edit_object', 'insert_part_from_library', 'run_fem_analysis']),
  ...ops('delete', 'freecad.model', ['delete_object']),
  ...ops('write', 'freecad.execute', ['execute_code', 'execute_code_async', 'execute_code_headless']),
];
const openTargetsOperations = ops('read', 'research.evidence', [
  'get_open_targets_graphql_schema', 'get_type_dependencies', 'query_open_targets_graphql',
  'batch_query_open_targets_graphql', 'search_entities',
]);

function researchEngineeringDirectory() {
  return [
    {
      providerId: 'freecad', displayName: 'FreeCAD MCP', category: 'engineering', transport: 'stdio', iconId: 'cad',
      summaryId: 'provider.freecad', docsUrl: 'https://github.com/neka-nat/freecad-mcp',
      summary: '检查、创建和修改 FreeCAD 模型，并运行 FEM 分析',
      summaryEn: 'Inspect and edit FreeCAD models, and run FEM analyses',
      prerequisiteCopy: '需安装 FreeCAD、启动 FreeCADMCP addon 的 RPC Server，并安装固定版本的 freecad-mcp 服务。',
      prerequisiteEn: 'Install FreeCAD, start the FreeCADMCP addon RPC server, and install a reviewed version of freecad-mcp.',
      gotchaCopy: 'Python 执行和模型修改有高权限；先审阅目标文档、参数与脚本，再逐次批准调用。',
      gotchaEn: 'Python execution and model edits are privileged. Review the document, parameters, and script before each approval.',
      auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
      requires: stdioRequires, operations: freecadOperations,
      defaultTools: ['list_documents', 'get_objects', 'get_object', 'get_view', 'get_rpc_status'], deployment: 'local-desktop',
      workTemplate: {
        title: '夹具设计评审', titleEn: 'Fixture design review', artifact: '候选模型、参数变化、检查结果与设计依据', artifactEn: 'Candidate model, parameter changes, checks, and design rationale',
        prompt: '针对当前 FreeCAD 文档，先列出对象和约束，再提出夹具参数修改方案。确认目标文档、尺寸、单位和预期结果后逐次请求批准写入。输出候选模型、参数差异、检查结果和设计依据；不要直接运行任意 Python。',
        promptEn: 'Inspect the current FreeCAD document and constraints, then propose fixture parameter changes. Confirm the document, dimensions, units, and expected result before approving each edit. Deliver the candidate model, parameter diff, checks, and rationale. Do not run arbitrary Python.',
      },
      capabilities: [{ plane: 'tool', name: 'cad-authoring', availability: 'available' }, { plane: 'execution', name: 'fem-job', availability: 'gated' }],
      stdioTemplate: { args: [], ...ENGINEERING_TIMEOUTS }, discovery: { executables: ['freecad-mcp'] },
      installHint: 'https://github.com/neka-nat/freecad-mcp/blob/master/docs/installation.md',
      multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'opc-ua', displayName: 'OPC UA MCP', category: 'engineering', transport: 'stdio', iconId: 'signal',
      summaryId: 'provider.opc-ua', docsUrl: 'https://github.com/IndustriAgents/OPCUA-MCP',
      summary: '浏览设备节点、读取变量、历史及报警',
      summaryEn: 'Browse device nodes and read values, history, and alarms',
      prerequisiteCopy: '需先安装固定版本的 opcua-mcp-server，并在环境变量 OPCUA_SERVER_URL 中指定模拟设备或经批准的网关。',
      prerequisiteEn: 'Install a reviewed opcua-mcp-server version and set OPCUA_SERVER_URL to a simulator or approved gateway.',
      gotchaCopy: '首版保持服务端 observe profile，默认仅允许读取类工具；真实设备和控制操作需单独验收。',
      gotchaEn: 'Keep the server in its observe profile and admit read tools first. Validate real devices and control separately.',
      auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
      requires: stdioRequires, operations: investigationOperations,
      defaultTools: ['get_server_status', 'browse_opcua_nodes', 'read_opcua_nodes', 'read_opcua_history', 'read_event_history', 'list_active_alarms'], deployment: 'on-premise-gateway',
      workTemplate: {
        title: '设备异常调查', titleEn: 'Equipment anomaly investigation', artifact: '节点、信号、事件和时间范围绑定的调查记录', artifactEn: 'Investigation record bound to nodes, signals, events, and time range',
        prompt: '在已批准的 OPC UA 模拟设备或网关中，确认设备与时间范围，浏览节点，读取变量、历史和报警。保留节点 ID、单位、质量状态和时间戳，比较基线并生成带证据的调查记录。仅使用读取工具。',
        promptEn: 'For an approved OPC UA simulator or gateway, identify the equipment and time range, browse nodes, and read values, history, and alarms. Keep node IDs, units, quality status, and timestamps, compare a baseline, and produce an evidence-backed investigation. Use read tools only.',
      },
      capabilities: [{ plane: 'context', name: 'equipment-signals', availability: 'available' }, { plane: 'event', name: 'subscription', availability: 'gated' }],
      stdioTemplate: { args: [], ...ENGINEERING_TIMEOUTS }, discovery: { executables: ['opcua-mcp-server'] },
      installHint: 'https://github.com/IndustriAgents/OPCUA-MCP/blob/main/docs/install.md',
      multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'biomcp', displayName: 'BioMCP', category: 'research', transport: 'stdio', iconId: 'evidence',
      summaryId: 'provider.biomcp', docsUrl: 'https://github.com/genomoncology/biomcp',
      summary: '检索公开生物医学文献、试验与知识来源',
      summaryEn: 'Search public biomedical literature, trials, and knowledge sources',
      prerequisiteCopy: '安装固定版本 biomcp-cli==0.9.0（不是 biomcp 包）；Point 将校验本机可执行文件摘要，使用 biomcp serve 启动。',
      prerequisiteEn: 'Install pinned biomcp-cli==0.9.0 (not the biomcp package); Point checks the local executable digest and starts biomcp serve.',
      gotchaCopy: '结果依赖上游数据的访问时间与版本；应保留检索条件、来源及支持和反对证据。',
      gotchaEn: 'Record query terms, source, access time, and supporting or conflicting evidence.',
      auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
      requires: stdioRequires, operations: ops('read', 'research.evidence', ['biomcp', 'search', 'get']), deployment: 'local-process',
      workTemplate: {
        title: '研究证据综述', titleEn: 'Research evidence review', artifact: '带检索条件、来源和不确定性的证据表', artifactEn: 'Evidence table with queries, sources, and uncertainty',
        prompt: '围绕给定研究问题检索公开文献、试验和数据库证据。记录检索条件、实体标识、来源、访问时间、支持与反对证据及不确定性。生成证据表与后续实验建议，不输出个体诊疗结论。',
        promptEn: 'Search public literature, trials, and databases for the research question. Record queries, entity IDs, sources, access times, supporting and conflicting evidence, and uncertainty. Deliver an evidence table and suggested follow-up experiments, without individual medical conclusions.',
      },
      capabilities: [{ plane: 'context', name: 'public-evidence', availability: 'available' }],
      stdioTemplate: { args: ['serve'], ...ENGINEERING_TIMEOUTS }, discovery: { executables: ['biomcp'] },
      installHint: 'uv tool install biomcp-cli==0.9.0',
      multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'foxglove', displayName: 'Foxglove Desktop', category: 'engineering', transport: 'http', iconId: 'replay',
      summaryId: 'provider.foxglove', docsUrl: 'https://docs.foxglove.dev/docs/agents/mcp-server',
      endpoint: 'http://127.0.0.1:7333/mcp', summary: '调查当前 Foxglove Desktop 标签页中的录制与布局',
      summaryEn: 'Investigate recordings and layouts in the active Foxglove Desktop tab',
      prerequisiteCopy: '需运行并登录 Foxglove Desktop，启用本地 MCP，具备 Pro / Enterprise / Academic developer seat，并把完整的 Bearer <token> 值以 foxglove.token 写入 Keychain。',
      prerequisiteEn: 'Run and sign in to Foxglove Desktop, enable local MCP, use an eligible developer seat, and store the full Bearer <token> value in Keychain as foxglove.token.',
      gotchaCopy: '大多数工具作用于最近聚焦窗口的活跃标签；每次调查都需核对 recording、时间范围和窗口。',
      gotchaEn: 'Most tools act on the active tab in the last focused window. Check recording, time range, and window for each investigation.',
      auth: { mode: 'shared-token', registration: 'none', credentialHolder: 'native-keychain' },
      requires: [{ key: 'url', kind: 'url', required: true, helpId: 'http.endpoint' }, { key: 'token', kind: 'secretRef', required: true, helpId: 'foxglove.token' }, { key: 'tools', kind: 'text', helpId: 'tools.allowlist' }],
      operations: [], deployment: 'local-desktop', capabilities: [{ plane: 'context', name: 'active-desktop-tab', availability: 'available' }],
      workTemplate: {
        title: '录制回放调查', titleEn: 'Recording replay investigation', artifact: '录制、时间范围、视图与异常证据', artifactEn: 'Recording, time range, views, and anomaly evidence',
        prompt: '先确认 Foxglove 最近聚焦窗口、活跃标签、录制 ID 和时间范围，再查看已加载数据并构建调查视图。定位异常时间段，记录视图配置和证据；切换标签后重新确认上下文。',
        promptEn: 'Confirm the last focused Foxglove window, active tab, recording ID, and time range before inspecting data or building views. Locate the anomaly, record the layout and evidence, and reconfirm context after any tab switch.',
      },
      multipleConnections: false, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'open-targets', displayName: 'Open Targets Platform', category: 'research', transport: 'http', iconId: 'target',
      summaryId: 'provider.open-targets', docsUrl: 'https://github.com/opentargets/platform-mcp',
      endpoint: 'https://mcp.platform.opentargets.org/mcp', summary: '查询靶点、疾病、药物与关联证据',
      summaryEn: 'Query targets, diseases, drugs, and association evidence',
      prerequisiteCopy: '使用 Open Targets 官方托管 MCP；查询时记录来源、访问时间和实体标识。',
      prerequisiteEn: 'Use the official hosted MCP and record source, access time, and entity identifiers.',
      auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
      requires: [{ key: 'url', kind: 'url', required: true, helpId: 'http.endpoint' }, { key: 'tools', kind: 'text', helpId: 'tools.allowlist' }],
      operations: openTargetsOperations, deployment: 'remote-service',
      workTemplate: {
        title: '靶点证据探索', titleEn: 'Target evidence exploration', artifact: '靶点、疾病、药物关联比较表与来源', artifactEn: 'Comparison of target, disease, and drug associations with sources',
        prompt: '针对研究问题先搜索靶点、疾病和药物的标准实体 ID，再检查 GraphQL schema 并查询关联证据。比较支持与反对证据，保留查询、来源、访问时间和不确定性，输出研究依据。',
        promptEn: 'Find canonical target, disease, and drug IDs for the research question, inspect the GraphQL schema, and query association evidence. Compare supporting and conflicting evidence; retain queries, sources, access time, and uncertainty in the research rationale.',
      },
      capabilities: [{ plane: 'context', name: 'target-evidence', availability: 'available' }],
      multipleConnections: false, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'fmu-runtime', displayName: 'FMU Runtime', category: 'engineering', transport: 'stdio', iconId: 'simulation',
      summaryId: 'provider.fmu-runtime', docsUrl: 'https://github.com/CATIA-Systems/FMPy',
      summary: '检查 FMU，提交和比较受控仿真实验',
      summaryEn: 'Inspect FMUs and submit or compare bounded simulation runs',
      prerequisiteCopy: '安装 Point 的 fmu-runtime 包和固定版本 FMPy；手动填写 Node 命令、服务脚本、模型目录、私有工作目录和 Python 路径，并在 JSON 编辑器的 files 中固定脚本摘要。',
      prerequisiteEn: 'Install the Point fmu-runtime package and pinned FMPy; configure the Node executable, server script, model root, private work root, and Python path, then pin the script in the JSON editor files list.',
      gotchaCopy: 'FMU 可含原生二进制。只运行已审查的模型，提交与取消须逐次批准；首版尚未绑定 Project 的长期 Job。',
      gotchaEn: 'FMUs may contain native binaries. Run reviewed models only and approve submit/cancel per call; long-lived Project jobs are not wired yet.',
      auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
      requires: [...stdioRequires, { key: 'serverScript', kind: 'path', required: true }, { key: 'modelRoot', kind: 'path', required: true }, { key: 'workRoot', kind: 'path', required: true }, { key: 'python', kind: 'path', required: true }],
      operations: [
        ...ops('read', 'fmu.inspect', ['model.inspect', 'experiment.status', 'result.describe', 'result.compare']),
        ...ops('write', 'fmu.execute', ['experiment.submit', 'experiment.cancel']),
      ],
      defaultTools: ['model.inspect', 'experiment.status', 'result.describe', 'result.compare'],
      deployment: 'local-process',
      workTemplate: {
        title: '仿真实验比较', titleEn: 'Simulation experiment comparison',
        artifact: '模型摘要、参数集、运行 ID、结果差异与来源', artifactEn: 'Model digest, parameter set, run IDs, result differences, and provenance',
        prompt: '先检查已批准目录中的 FMU，记录模型摘要、变量、单位和参数集。对基线与候选运行逐次请求批准，跟踪运行状态并比较同一模型和时间范围的结果，生成有来源的实验记录。',
        promptEn: 'Inspect an approved FMU and record its digest, variables, units, and parameter set. Request approval for each baseline and candidate run, track their status, compare results for the same model and time range, and produce a sourced experiment record.',
      },
      capabilities: [{ plane: 'execution', name: 'fmu-job', availability: 'available' }],
      stdioTemplate: { args: [], ...ENGINEERING_TIMEOUTS },
      installHint: 'packages/mcp/fmu-runtime/README.md',
      multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'elabftw', displayName: 'eLabFTW', category: 'research', transport: 'stdio', iconId: 'notebook',
      summaryId: 'provider.elabftw', docsUrl: 'https://doc.elabftw.net/api/v2/',
      summary: '只读检索 eLabFTW 实验记录与来源',
      summaryEn: 'Read eLabFTW experiment records with source receipts',
      prerequisiteCopy: '安装 Point 的 elabftw-connector 包；手动填写 Node 命令和服务脚本，在 JSON 编辑器的 files 中固定脚本摘要，用 Keychain 引用绑定 API Key，并设置租户的 /api/v2 地址。',
      prerequisiteEn: 'Install the Point elabftw-connector package; configure the Node executable and server script, pin the script in the JSON editor files list, bind the API key via Keychain reference, and set the tenant /api/v2 URL.',
      gotchaCopy: '首版仅读取实验列表和详情；真实租户权限、附件及草稿写回均未验收。',
      gotchaEn: 'This version reads experiment lists and details only. Tenant permissions, attachments, and draft writes remain unverified.',
      auth: { mode: 'shared-token', registration: 'none', credentialHolder: 'native-keychain' },
      requires: [...stdioRequires, { key: 'serverScript', kind: 'path', required: true }, { key: 'apiBaseUrl', kind: 'url', required: true }, { key: 'token', kind: 'secretRef', required: true }],
      operations: ops('read', 'elabftw.experiments', ['elabftw_experiments_list', 'elabftw_experiment_get']),
      deployment: 'local-process',
      workTemplate: {
        title: '实验记录复盘', titleEn: 'Experiment record review',
        artifact: '实验记录、检索条件、版本与来源说明', artifactEn: 'Experiment records, search terms, versions, and source receipts',
        prompt: '围绕研究问题检索已有实验记录，读取相关记录详情，保留记录 ID、更新时间、检索条件和来源。整理一致与矛盾的发现，生成带来源的复盘草稿；不修改原记录。',
        promptEn: 'Search existing experiments for the research question, inspect relevant records, and retain record IDs, modification times, search terms, and source receipts. Draft a review of consistent and conflicting findings without editing source records.',
      },
      capabilities: [{ plane: 'context', name: 'experiment-records', availability: 'available' }],
      stdioTemplate: { args: [], ...ENGINEERING_TIMEOUTS },
      installHint: 'packages/mcp/elabftw-connector/README.md',
      multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'highbyte', displayName: 'HighByte Intelligence Hub', category: 'engineering', transport: 'http', iconId: 'gateway', catalogStage: 'tenant',
      docsUrl: 'https://guide.highbyte.com/dev/configuration/servers/mcp/',
      summary: '通过客户配置的 Pipeline 查询设备与工厂上下文', summaryEn: 'Query equipment and plant context through tenant-configured pipelines',
      prerequisiteCopy: '需要已启用 MCP 的 Intelligence Hub、具备只读 Pipeline 权限的 API Key，以及 Point 可访问的 HTTPS /mcp 地址。',
      prerequisiteEn: 'Requires an MCP-enabled Intelligence Hub, an API key scoped to read-only pipelines, and an HTTPS /mcp endpoint reachable by Point.',
      gotchaCopy: '工具名和操作效果由客户的 Pipeline 决定；先发现并审查工具，再加入白名单。',
      gotchaEn: 'Tool names and effects depend on the tenant pipelines. Discover and review each tool before allowlisting it.',
      auth: { mode: 'shared-token', registration: 'none', credentialHolder: 'native-keychain' },
      requires: [{ key: 'url', kind: 'url', required: true }, { key: 'token', kind: 'secretRef', required: true }, { key: 'tools', kind: 'text' }],
      operations: [], deployment: 'on-premise-gateway', defaultTools: [],
      workTemplate: {
        title: '试验台上下文调查', titleEn: 'Test bench context investigation', artifact: '设备、指标、时间范围与来源记录', artifactEn: 'Equipment, metric, time range, and source record',
        prompt: '在已批准的 HighByte 只读 Pipeline 中查询指定设备与时间范围，保留 Pipeline 名、指标单位、时间戳与来源，并生成调查记录。先检查租户工具清单，不调用配置或写入工具。',
        promptEn: 'Query an approved read-only HighByte pipeline for the named equipment and time range. Retain pipeline name, units, timestamps, and sources in the investigation. Review tenant tools first; do not use configuration or write tools.',
      },
      multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'seqera', displayName: 'Seqera MCP', category: 'research', transport: 'http', iconId: 'workflow', catalogStage: 'tenant',
      docsUrl: 'https://docs.seqera.io/platform-cloud/seqera-mcp/overview', endpoint: 'https://mcp.seqera.io/mcp',
      summary: '选择、运行和跟踪 Nextflow 生物信息流程', summaryEn: 'Select, run, and monitor Nextflow bioinformatics workflows',
      prerequisiteCopy: '需要 Seqera 账户和具备最小权限的 Personal Access Token；先审查实际工具和工作区权限。',
      prerequisiteEn: 'Requires a Seqera account and minimally scoped Personal Access Token. Review actual tools and workspace permissions first.',
      gotchaCopy: '提交和取消 Pipeline 是执行操作；首版默认工具白名单为空，运行 ID 与产物需绑定 Project。',
      gotchaEn: 'Launching or cancelling a pipeline is an execution action. The initial allowlist is empty; bind run IDs and artifacts to the Project.',
      auth: { mode: 'shared-token', registration: 'none', credentialHolder: 'native-keychain' },
      requires: [{ key: 'url', kind: 'url', required: true }, { key: 'token', kind: 'secretRef', required: true }, { key: 'tools', kind: 'text' }],
      operations: [], defaultTools: [], deployment: 'remote-service',
      workTemplate: {
        title: '标准计算流程复盘', titleEn: 'Approved pipeline review', artifact: '流程版本、运行 ID、状态、结果与来源', artifactEn: 'Pipeline version, run ID, status, results, and provenance',
        prompt: '先确认工作区、已批准的 Nextflow 流程、输入数据与参数，再逐次批准提交。记录运行 ID、流程版本、状态与产物，汇总结果和不确定性；不要提交未经审查的流程。',
        promptEn: 'Confirm the workspace, approved Nextflow pipeline, inputs, and parameters before approving submission. Record run ID, pipeline version, status, and artifacts; summarize results and uncertainty. Do not launch an unreviewed pipeline.',
      },
      multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'labkey', displayName: 'LabKey SDMS MCP', category: 'research', transport: 'http', iconId: 'notebook', catalogStage: 'tenant',
      docsUrl: 'https://www.labkey.org/Documentation/wiki-page.view?name=mcp',
      summary: '浏览研究数据结构并起草、检查 LabKey SQL', summaryEn: 'Explore research schemas and draft or validate LabKey SQL',
      prerequisiteCopy: '需要 Professional / Enterprise 租户启用 MCP，使用 Reader 权限 API Key，并填写租户 HTTPS /mcp 地址。',
      prerequisiteEn: 'Requires a Professional / Enterprise tenant with MCP enabled, a Reader-role API key, and its HTTPS /mcp URL.',
      gotchaCopy: 'MCP 工具只读，生成的脚本仍可能具备写权限；以 API Key 的角色限制实际数据访问。',
      gotchaEn: 'MCP tools are read-only, but generated scripts can write. Restrict actual data access with the API key role.',
      auth: { mode: 'shared-token', registration: 'none', credentialHolder: 'native-keychain' },
      requires: [{ key: 'url', kind: 'url', required: true }, { key: 'token', kind: 'secretRef', required: true }, { key: 'tools', kind: 'text' }],
      operations: [], defaultTools: [], deployment: 'remote-service',
      workTemplate: {
        title: '研究数据结构探索', titleEn: 'Study data schema exploration', artifact: '文件夹、schema、SQL 草稿与验证结果', artifactEn: 'Folder, schema, SQL draft, and validation result',
        prompt: '先确认 LabKey 文件夹路径，浏览 schema、表与字段，再起草并验证只读 SQL。记录权限范围和来源；不要把生成脚本当作已经取得的实验数据。',
        promptEn: 'Confirm the LabKey folder path, browse schemas, tables, and fields, then draft and validate read-only SQL. Record permission scope and sources; do not treat generated scripts as retrieved experiment data.',
      },
      multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'benchling', displayName: 'Benchling MCP', category: 'research', transport: 'http', iconId: 'notebook', catalogStage: 'tenant',
      docsUrl: 'https://help.benchling.com/hc/en-us/articles/40342713479437-Benchling-MCP',
      summary: '向已启用的 Benchling Agent 委托实验资料查询', summaryEn: 'Delegate research-context queries to an enabled Benchling agent',
      prerequisiteCopy: '租户管理员须启用 Benchling Chat 和 MCP；使用租户专属 HTTPS /mcp 地址及 OAuth 2.1 DCR。',
      prerequisiteEn: 'A tenant admin must enable Benchling Chat and MCP; use the tenant-specific HTTPS /mcp URL with OAuth 2.1 DCR.',
      gotchaCopy: '该 MCP 主要调用 Benchling Agent；精确 CRUD 工具需在租户中核实，并保留委托与来源记录。',
      gotchaEn: 'This MCP delegates to the Benchling agent. Verify exact CRUD tools in the tenant and retain delegation and source receipts.',
      auth: { mode: 'user-oauth', registration: 'dcr', credentialHolder: 'native-keychain' },
      requires: [{ key: 'url', kind: 'url', required: true }, { key: 'oauthIssuer', kind: 'url', required: true }, { key: 'redirectUri', kind: 'url', required: true }, { key: 'tools', kind: 'text' }],
      operations: [], defaultTools: [], deployment: 'remote-service',
      workTemplate: {
        title: '实验资料复盘', titleEn: 'Experiment context review', artifact: '委托请求、回答、来源与不确定性', artifactEn: 'Delegation request, answer, sources, and uncertainty',
        prompt: '限定研究问题、Project 与时间范围后向 Benchling Agent 查询。保存委托请求、返回结果、对象链接和证据；先核对租户实际工具，不假定有 Notebook 或 Registry 写入能力。',
        promptEn: 'Bound the research question, Project, and time range before querying the Benchling agent. Retain delegation request, answer, object links, and evidence. Inspect tenant tools; do not assume Notebook or Registry write access.',
      },
      multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'biocontext', displayName: 'BioContextAI Knowledgebase', category: 'research', transport: 'stdio', iconId: 'protein',
      docsUrl: 'https://github.com/biocontext-ai/knowledgebase-mcp',
      summary: '交叉检索通路、蛋白、组学及文献知识库', summaryEn: 'Cross-search pathways, proteins, omics, and literature databases',
      prerequisiteCopy: '本地安装并固定受审查版本 biocontext_kb，使用 stdio 模式；部分来源受许可和访问频率限制。',
      prerequisiteEn: 'Install a reviewed, pinned biocontext_kb version locally in stdio mode; some sources have licensing and rate limits.',
      gotchaCopy: '与 BioMCP 有重叠；优先选择所需来源，保留原数据库引用，不默认同时开启全部工具。',
      gotchaEn: 'Capabilities overlap with BioMCP. Select needed sources, retain original database citations, and avoid enabling every tool by default.',
      auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
      requires: stdioRequires, operations: [], defaultTools: [], deployment: 'local-process',
      stdioTemplate: { args: [], ...ENGINEERING_TIMEOUTS }, discovery: { executables: ['biocontext_kb'] },
      workTemplate: {
        title: '蛋白与通路证据交叉检索', titleEn: 'Protein and pathway evidence cross-check', artifact: '数据库交叉证据、版本与来源', artifactEn: 'Cross-database evidence, versions, and sources',
        prompt: '对同一蛋白或通路查询经批准的知识库，记录标准实体 ID、各来源版本、访问时间、一致与冲突证据，生成可追溯的比较表。',
        promptEn: 'Query approved knowledgebases for the same protein or pathway. Record canonical IDs, source versions, access times, consistent and conflicting evidence, and produce a traceable comparison.',
      },
      multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
    },
    ...researchDirectory(),
    ...publicDataDirectory(),
    ...computingDirectory(),
    ...scienceDirectory(),
    ...candidateDirectory(),
  ];
}

function candidateDirectory() {
  const candidate = ({ providerId, displayName, category, transport = 'http', iconId, catalogStage, docsUrl, summary, summaryEn, prerequisiteCopy, prerequisiteEn, gotchaCopy, gotchaEn }) => ({
    providerId, displayName, category, transport, iconId, catalogStage, listed: true,
    docsUrl, summary, summaryEn, prerequisiteCopy, prerequisiteEn, gotchaCopy, gotchaEn,
    auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
    requires: [], operations: [], launchGatePassed: false, preregistered: false,
  });
  return [
    candidate({ providerId: 'nominal', displayName: 'Nominal MCP', category: 'engineering', iconId: 'test', catalogStage: 'vendor',
      docsUrl: 'https://nominal.io/products/developers', summary: '工程试验通道、校准与来源数据', summaryEn: 'Engineering test channels, calibration, and provenance',
      prerequisiteCopy: '官方确认提供 MCP；需要客户账户后核实租户端点、工具清单和权限。', prerequisiteEn: 'MCP is advertised officially; verify tenant endpoint, tools, and permissions with a customer account.' }),
    candidate({ providerId: 'carbon', displayName: 'Carbon MCP', category: 'engineering', iconId: 'manufacturing', catalogStage: 'review',
      docsUrl: 'https://docs.carbon.ms/api/mcp', summary: '关联物料、工单与质量记录', summaryEn: 'Relate parts, jobs, and quality records',
      prerequisiteCopy: '需要 Business 权限与客户实例；Point 运行时尚未接入 call_tool 的内层操作审批。', prerequisiteEn: 'Requires Business access and a customer instance; Point runtime has not yet wired inner-operation approval for call_tool.',
      gotchaCopy: '当前只提供接入说明，不开放添加；search_tools / describe_tool / call_tool 的外层工具名不足以界定真实效果。',
      gotchaEn: 'Information only for now. The outer search_tools / describe_tool / call_tool names do not bound the inner operation effect.' }),
    candidate({ providerId: 'kicad', displayName: 'KiCad MCP', category: 'engineering', iconId: 'circuit', catalogStage: 'review',
      docsUrl: 'https://github.com/lamaalrajih/kicad-mcp', summary: '检查原理图、BOM 与 PCB 规则', summaryEn: 'Inspect schematics, BOMs, and PCB design rules',
      prerequisiteCopy: '社区项目可本地安装；需先隔离文件范围并复核路径校验 Issue #57。', prerequisiteEn: 'Local community server; isolate project files and recheck path-validation Issue #57 before admission.' }),
    candidate({ providerId: 'openbom', displayName: 'OpenBOM MCP', category: 'engineering', iconId: 'bom', catalogStage: 'vendor',
      docsUrl: 'https://www.openbom.com/blog/press-release-openbom-announces-private-beta-of-ai-bom-agent-with-mcp-support',
      summary: 'BOM 查询与零件复用候选', summaryEn: 'BOM queries and part reuse candidate',
      prerequisiteCopy: '公开访问说明仍是 Private Beta；需供应商确认开通和端点。', prerequisiteEn: 'Public access information remains Private Beta; confirm enablement and endpoint with the vendor.' }),
    candidate({ providerId: 'comsol', displayName: 'COMSOL MCP Server', category: 'engineering', iconId: 'simulation', catalogStage: 'upcoming',
      docsUrl: 'https://www.comsol.com/press-release/system-level-modeling-and-agentic-ai-take-the-spotlight-in-comsol-multiphysics-version-2027-14722',
      summary: '跟踪 COMSOL Multiphysics 2027 的 MCP 发布', summaryEn: 'Track the announced COMSOL Multiphysics 2027 MCP release',
      prerequisiteCopy: '官方公告为计划在 2026 年秋季稍后发布；当前不是可安装连接器。', prerequisiteEn: 'Official announcement targets a later fall 2026 release; this is not an installable connector yet.' }),
    candidate({ providerId: 'pyvisa', displayName: 'PyVISA Instrument', category: 'engineering', transport: 'stdio', iconId: 'instrument', catalogStage: 'planned',
      docsUrl: 'https://pyvisa.readthedocs.io/en/latest/', summary: '受控测量仪器 profile 与采集', summaryEn: 'Controlled instrument profiles and measurement capture',
      prerequisiteCopy: 'PyVISA 是仪器 SDK；Point 的限命令 MCP 适配器尚未实现，需验证具体仪器与驱动。', prerequisiteEn: 'PyVISA is an instrument SDK. A command-limited Point MCP adapter is still needed, with device and driver verification.' }),
    candidate({ providerId: 'pylabrobot', displayName: 'PyLabRobot Automation', category: 'research', transport: 'stdio', iconId: 'robot', catalogStage: 'planned',
      docsUrl: 'https://github.com/PyLabRobot/pylabrobot', summary: '实验室设备布局、步骤与模拟状态', summaryEn: 'Lab device layouts, steps, and simulated state',
      prerequisiteCopy: 'PyLabRobot 是自动化 SDK；Point 尚需先封装模拟与审阅流程，再考虑真实设备执行。', prerequisiteEn: 'PyLabRobot is an automation SDK. Point needs a simulation and review adapter before any real-device execution.' }),
  ];
}

// matlab/matlab-mcp-server's default single-session surface.
const matlabOperations = [
  ...ops('read', 'matlab.inspect', ['detect_matlab_toolboxes', 'check_matlab_code']),
  ...ops('write', 'matlab.execute', ['evaluate_matlab_code', 'run_matlab_file', 'run_matlab_test_file']),
];
// matlab/simulink-agentic-toolkit's tools/tools.json, served by the same MATLAB
// MCP server through --extension-file rather than by a process of its own.
const simulinkOperations = [
  ...matlabOperations,
  ...ops('read', 'simulink.inspect', ['model_overview', 'model_read', 'model_query_params', 'model_resolve_params', 'model_read_diagnostics', 'model_check', 'model_scan']),
  ...ops('write', 'simulink.edit', ['model_edit']),
  ...ops('write', 'simulink.test', ['model_test']),
];
const matlabCapabilities = [
  { plane: 'execution', name: 'matlab-session', availability: 'available' },
  // MathWorks ships its domain knowledge as agent skills (matlab-agentic-toolkit,
  // simulink-agentic-toolkit skills-catalog), installed into the agent, not
  // served by this connector.
  { plane: 'context', name: 'matlab-skills', availability: 'delegated' },
];

const ansysMechanicalOperations = [
  ...ops('read', 'ansys.session', ['get_guidelines_for', 'check_mechanical_status', 'get_session_diagnostics', 'check_mechanical_installed', 'list_mechanical_instances', 'get_mechanical_logs']),
  ...ops('read', 'ansys.inspect', ['list_files', 'get_model_info', 'screenshot']),
  ...ops('write', 'ansys.session', ['launch_mechanical', 'connect_to_mechanical', 'disconnect_from_mechanical']),
  ...ops('write', 'ansys.execute', ['run_python_script', 'run_python_code', 'create_custom_plot', 'solve_analysis']),
  ...ops('write', 'ansys.files', ['upload_file', 'download_file', 'download_project', 'open_project', 'save_project', 'export_results']),
  ...ops('delete', 'ansys.files', ['clear_mechanical']),
];
const ansysFluentOperations = [
  ...ops('read', 'ansys.session', ['session_status', 'solver_status']),
  ...ops('read', 'ansys.inspect', ['find_api', 'get_help', 'get_state', 'get_targeted_context', 'list_named_objects', 'find_named_object', 'select_named_objects',
    'validate_code', 'summarize_setup', 'simulation_report', 'screenshot', 'mesh_quality', 'list_fields', 'compare_files']),
  ...ops('write', 'ansys.session', ['connect', 'disconnect', 'manage_component']),
  ...ops('write', 'ansys.execute', ['run_code']),
];
const ansysMapdlOperations = [
  ...ops('read', 'ansys.session', ['get_guidelines_for', 'check_mapdl_status', 'check_mapdl_installed', 'list_mapdl_instances']),
  ...ops('read', 'ansys.inspect', ['open_results']),
  ...ops('write', 'ansys.session', ['launch_mapdl_session', 'connect_to_mapdl', 'disconnect_from_mapdl']),
  // screenshot takes MAPDL commands to run before plotting, so it executes.
  ...ops('write', 'ansys.execute', ['run_mapdl_command', 'run_multiple_mapdl_commands', 'run_python_code', 'custom_plot', 'screenshot']),
  ...ops('write', 'ansys.files', ['upload_file', 'download_file', 'resume_model']),
];
const ansysAedtOperations = [
  ...ops('read', 'ansys.session', ['get_guidelines_for', 'check_aedt_status', 'check_aedt_installed', 'get_pyaedt_logs']),
  ...ops('read', 'ansys.inspect', ['list_projects', 'list_designs', 'validate_design', 'get_model_info', 'screenshot']),
  ...ops('write', 'ansys.session', ['launch_aedt', 'connect_to_aedt', 'disconnect_from_aedt']),
  ...ops('write', 'ansys.execute', ['run_python_script', 'run_python_code', 'analyze_design']),
  ...ops('write', 'ansys.files', ['open_project', 'save_project', 'create_design', 'export_results', 'export_config']),
  ...ops('delete', 'ansys.files', ['clear_aedt']),
];

const stdioRequires = [
  { key: 'command', kind: 'path', required: true, helpId: 'stdio.command' },
  { key: 'sha256', kind: 'text', required: true, helpId: 'stdio.digest' },
  { key: 'tools', kind: 'text', helpId: 'tools.allowlist' },
];
// The native worker snapshots tools/list once per connection and a call may
// last at most 45 s, so every template keeps the tool surface static and
// uses the ceiling for both timeouts.
const ENGINEERING_TIMEOUTS = { callTimeoutMs: 45000, initializeTimeoutMs: 45000 };
const ENGINEERING_GOTCHA = '单次工具调用最长 45 秒：长时间求解请在会话中异步提交，再轮询状态。';

/**
 * Every PyAnsys product server is built on ansys/pyansys-common-mcp: the same
 * PyAnsysBaseMCP CLI (--transport stdio|http), a persistent Python session and
 * guideline resources. That shared base is a library, not a runnable server,
 * so it has no card of its own; it is this one factory instead.
 */
function ansysProvider({ providerId, displayName, product, command, summary, operations, args = [] }) {
  return {
    providerId, displayName, category: 'engineering', transport: 'stdio', iconId: 'simulation',
    summaryId: `provider.${providerId}`, docsUrl: `https://github.com/ansys/${command.replace(/^ansys-(.*)-mcp$/, 'py$1-mcp')}`, summary,
    prerequisiteCopy: `需要本机已安装并获得许可的 ${product}，以及用 Python 3.12+ 安装的 ${command}（pip install ${command}）。Point 会自动在本机查找它。`,
    gotchaCopy: ENGINEERING_GOTCHA,
    auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
    requires: stdioRequires, operations,
    capabilities: [
      { plane: 'execution', name: 'python-session', availability: 'available' },
      { plane: 'execution', name: 'solver-session', availability: 'available' },
      // The same servers also speak streamable HTTP; Point connects over stdio.
      { plane: 'tool', name: 'remote-http', availability: 'gated' },
    ],
    stdioTemplate: { args: ['--transport', 'stdio', ...args], ...ENGINEERING_TIMEOUTS },
    discovery: { executables: [command] }, installHint: `uv tool install ${command}`, install: { kind: 'uv-tool', package: command },
    multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
  };
}

function engineeringDirectory() {
  const matlab = {
    category: 'engineering', transport: 'stdio',
    auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
    gotchaCopy: ENGINEERING_GOTCHA, capabilities: matlabCapabilities,
    installHint: 'https://github.com/matlab/matlab-mcp-server/releases/latest',
    install: { kind: 'github-release', repo: 'matlab/matlab-mcp-server', asset: 'matlab-mcp-server-macos-{arch}' },
    multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
  };
  // Point clears the environment, so the server cannot find MATLAB on PATH:
  // --matlab-root is required, and nodesktop keeps it from opening windows.
  const matlabArgs = ['--matlab-root=', '--matlab-display-mode=nodesktop', '--matlab-session-mode=new'];
  const matlabRequires = [...stdioRequires.slice(0, 2), { key: 'matlabRoot', kind: 'path', required: true, helpId: 'matlab.root' }, stdioRequires[2]];
  return [
    {
      ...matlab, providerId: 'matlab', displayName: 'MATLAB', iconId: 'signal', summaryId: 'provider.matlab',
      docsUrl: 'https://github.com/matlab/matlab-mcp-server',
      summary: '启停 MATLAB 会话、执行代码与测试并分析结果',
      prerequisiteCopy: '需要本机已安装并获得许可的 MATLAB，以及官方 matlab-mcp-server 可执行文件；Point 会自动查找 MATLAB 与服务程序。领域 Skills 来自 MATLAB Agentic Toolkit。',
      requires: matlabRequires, operations: matlabOperations,
      stdioTemplate: { args: matlabArgs, ...ENGINEERING_TIMEOUTS },
      discovery: { executables: ['matlab-mcp-server'], prefix: true, matlabRoot: true },
    },
    {
      ...matlab, providerId: 'simulink', displayName: 'Simulink', iconId: 'workflow', summaryId: 'provider.simulink',
      docsUrl: 'https://github.com/matlab/simulink-agentic-toolkit',
      summary: '读取、编辑、检查与测试 Simulink / Simscape / Stateflow 模型',
      prerequisiteCopy: '需要 MATLAB + Simulink、已安装的 Simulink Agentic Toolkit 工具箱，以及 matlab-mcp-server；Point 会自动查找三者。',
      requires: [...matlabRequires.slice(0, 3), { key: 'extensionFile', kind: 'path', required: true, helpId: 'simulink.extension' }, stdioRequires[2]],
      operations: simulinkOperations,
      stdioTemplate: { args: [...matlabArgs, '--extension-file='], ...ENGINEERING_TIMEOUTS },
      discovery: { executables: ['matlab-mcp-server'], prefix: true, matlabRoot: true, extensionFile: true },
    },
    ansysProvider({
      providerId: 'ansys-mechanical', displayName: 'Ansys Mechanical', product: 'Ansys Mechanical', command: 'ansys-mechanical-mcp',
      summary: '启动或连接 Mechanical，求解、后处理、截图与导出结果', operations: ansysMechanicalOperations,
      // Without it, solver tools stay hidden until connect and never reach the
      // worker's one-time tool snapshot.
      args: ['--static-tools'],
    }),
    ansysProvider({
      providerId: 'ansys-fluent', displayName: 'Ansys Fluent', product: 'Ansys Fluent', command: 'ansys-fluent-mcp',
      summary: '连接 Fluent 求解器，检查设置树、校验并执行代码、生成仿真报告', operations: ansysFluentOperations,
    }),
    ansysProvider({
      providerId: 'ansys-mapdl', displayName: 'Ansys MAPDL', product: 'Ansys MAPDL', command: 'ansys-mapdl-mcp',
      summary: '连接本地或远程 MAPDL，批量执行命令、绘图与结果文件管理', operations: ansysMapdlOperations,
      // MAPDL has no static-tools switch: only a startup connection exposes its
      // solver tools, so the template attaches to a running MAPDL gRPC server.
      args: ['--connect-on-startup', '--ip', '127.0.0.1', '--port', '50052'],
    }),
    ansysProvider({
      providerId: 'ansys-aedt', displayName: 'Ansys Electronics Desktop', product: 'Ansys Electronics Desktop (HFSS / Maxwell / Icepak 等)', command: 'ansys-aedt-mcp',
      summary: '发现与启动 AEDT，管理项目、设计、分析与结果（HFSS、Maxwell、Icepak 等）', operations: ansysAedtOperations,
      args: ['--include-context', '--non-graphical'],
    }),
  ];
}

const ENGINEERING_COMMANDS = new Map([
  ['ansys-mechanical-mcp', 'ansys-mechanical'], ['ansys-fluent-mcp', 'ansys-fluent'],
  ['ansys-mapdl-mcp', 'ansys-mapdl'], ['ansys-aedt-mcp', 'ansys-aedt'],
  ['galaxy-mcp', 'galaxy'], ['jupyter-mcp-server', 'jupyter'], ['jupyter-mcp', 'jupyter'], ['zotero-mcp', 'zotero'], ['freecad-mcp', 'freecad'], ['opcua-mcp-server', 'opc-ua'], ['biomcp', 'biomcp'], ['biocontext_kb', 'biocontext'],
]);
const argValue = (definition, flag, variable) => {
  const arg = (definition?.args ?? []).find(value => typeof value === 'string' && value.startsWith(`${flag}=`));
  if (arg) return arg.slice(flag.length + 1);
  const bound = definition?.env?.[variable];
  return typeof bound === 'string' ? bound : '';
};

/** Which engineering entry a stdio definition launches, recognised by its executable. */
function engineeringProviderId(definition) {
  const science = scienceProviderId(definition);
  if (science) return science;
  const name = String(definition?.command ?? '').split('/').pop();
  if (name === 'mlflow' && definition?.args?.[0] === 'mcp' && definition?.args?.[1] === 'run') return 'mlflow';
  if (name === 'Rscript' && definition?.args?.some((arg, index, args) => arg === '-e' && args[index + 1] === R_MCP_EXPRESSION)) return 'r-mcptools';
  if (ENGINEERING_COMMANDS.has(name)) return ENGINEERING_COMMANDS.get(name);
  if (Array.isArray(definition?.args)) {
    if (definition.args.some(arg => typeof arg === 'string' && /(?:^|\/)(?:point-feishu-workspace\.mjs|feishu-workspace\/server\.bundle\.mjs)$/.test(arg))) return 'feishu-workspace';
    if (definition.args.some(arg => typeof arg === 'string' && /(?:^|\/)fmu-runtime\/src\/mcp-server\.mjs$/.test(arg))) return 'fmu-runtime';
    if (definition.args.some(arg => typeof arg === 'string' && /(?:^|\/)elabftw-connector\/bin\/stdio\.mjs$/.test(arg))) return 'elabftw';
  }
  if (!name.startsWith('matlab-mcp-server')) return null;
  return /simulink-agentic-toolkit/.test(argValue(definition, '--extension-file', 'MW_MCP_SERVER_EXTENSION_FILE')) ? 'simulink' : 'matlab';
}

/** The directory Point ships. Every entry maps onto one native transport. */
export const pointDirectory = () => [
  {
    providerId: 'feishu-workspace', displayName: '飞书工作空间', category: 'productivity', transport: 'stdio', iconId: 'evidence',
    summaryId: 'provider.feishu-workspace', docsUrl: 'https://github.com/larksuite/cli',
    summary: '连接用户工作空间：资料读取、成果发布与会议知识提案', summaryEn: 'User workspace: source reads, deliverable publication, and meeting knowledge proposals',
    prerequisiteCopy: '安装官方 lark-cli，并在 point-readonly 配置中完成文档搜索与读取授权。Point 检测登录身份并绑定应用和用户；凭据由官方 CLI 的本机存储保管。',
    prerequisiteEn: 'Install official lark-cli and authorize document search and read in the point-readonly profile. Point verifies and binds the app and user; the official CLI keeps credentials locally.',
    gotchaCopy: '默认只允许文档读取；成果新建、日程和会议需额外用户授权与工具准入。外部写入在 Point 审阅确认；会议监听不补放离线事件。账号或 CLI 变化后须重新检测并保存。',
    gotchaEn: 'Reads only by default. Creation, calendar and meetings require extra user consent and tool admission. Review external writes in Point. Offline meeting events are not replayed. Detect and save again after account or CLI changes.',
    // User OAuth is delegated to lark-cli. No Point-native OAuth grant is stored.
    auth: { mode: 'none', registration: 'none', credentialHolder: 'lark-cli-local-store' },
    requires: [
      { key: 'command', kind: 'path', required: true }, { key: 'sha256', kind: 'text', required: true },
      { key: 'serverScript', kind: 'path', required: true }, { key: 'cliBinary', kind: 'path', required: true },
      { key: 'userBinding', kind: 'text', required: true },
    ],
    defaultTools: ['feishu_account_get', 'feishu_documents_search', 'feishu_document_get'],
    operations: [...ops('read', 'feishu.documents', ['feishu_account_get', 'feishu_documents_search', 'feishu_document_get', 'feishu_calendar_agenda', 'feishu_meeting_note_get', 'feishu_resources_browse', 'feishu_chats_list', 'feishu_chat_read', 'feishu_base_tables', 'feishu_base_fields']),
      ...ops('write', 'feishu.deliverables', ['feishu_document_create', 'feishu_meeting_events_poll', 'feishu_base_record_create'])],
    discovery: { executables: ['lark-cli'] }, stdioTemplate: { args: [], callTimeoutMs: 45000, initializeTimeoutMs: 45000 },
    installHint: 'https://github.com/larksuite/cli', deployment: 'local-process',
    capabilities: [{ plane: 'identity', name: 'user-oauth', availability: 'delegated' }, { plane: 'context', name: 'documents', availability: 'available' }],
    multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
  },
  {
    providerId: 'gitlab', displayName: 'GitLab', category: 'developer-tools', transport: 'gitlab',
    summaryId: 'provider.gitlab', docsUrl: 'https://docs.gitlab.com/api/rest/',
    summary: '仓库、Issue、Merge Request 与 CI 上下文的只读访问', brand: 'gitlab',
    prerequisiteCopy: '需要一个最小权限的 GitLab Access Token；令牌只写入系统 Keychain。',
    auth: {
      mode: 'shared-token', registration: 'none', credentialHolder: 'native-keychain',
      revokeUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    },
    requires: [
      { key: 'url', kind: 'url', required: true, helpId: 'gitlab.endpoint' },
      { key: 'token', kind: 'secretRef', required: true, helpId: 'gitlab.token' },
      { key: 'tools', kind: 'text', helpId: 'tools.allowlist' },
    ],
    operations: gitlabOperations, capabilities: gitlabCapabilities,
    multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
  },
  {
    providerId: 'github', displayName: 'GitHub', category: 'developer-tools', transport: 'github',
    summaryId: 'provider.github', docsUrl: 'https://docs.github.com/en/rest',
    summary: '仓库、Issue 与 Pull Request；发布须另行授权', brand: 'github',
    prerequisiteCopy: '读取使用只读令牌；发布需明确选择写入工具及仓库 Contents / Pull requests 写权限。令牌只存系统 Keychain。',
    auth: {
      mode: 'shared-token', registration: 'none', credentialHolder: 'native-keychain',
      revokeUrl: 'https://github.com/settings/personal-access-tokens',
    },
    requires: [
      { key: 'url', kind: 'url', required: true, helpId: 'github.endpoint' },
      { key: 'token', kind: 'secretRef', required: true, helpId: 'github.token' },
      { key: 'tools', kind: 'text', helpId: 'tools.allowlist' },
    ],
    operations: githubOperations, defaultTools: githubOperations.filter(operation => operation.effect === 'read').map(operation => operation.tool), multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
  },
  {
    providerId: 'linear', displayName: 'Linear', category: 'developer-tools', transport: 'linear',
    summaryId: 'provider.linear', docsUrl: 'https://linear.app/developers/graphql',
    summary: '团队与 Issue 的只读访问', brand: 'linear',
    prerequisiteCopy: '需要 Linear Personal API Key；密钥只写入系统 Keychain。',
    auth: { mode: 'shared-token', registration: 'none', credentialHolder: 'native-keychain', revokeUrl: 'https://linear.app/settings/api' },
    requires: [
      { key: 'url', kind: 'url', required: true, helpId: 'linear.endpoint' },
      { key: 'token', kind: 'secretRef', required: true, helpId: 'linear.token' },
      { key: 'tools', kind: 'text', helpId: 'tools.allowlist' },
    ],
    operations: linearOperations, multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
  },
  {
    providerId: 'gmail', displayName: 'Gmail', category: 'productivity', transport: 'gmail',
    summaryId: 'provider.gmail', docsUrl: 'https://developers.google.com/workspace/gmail/api/auth/scopes',
    summary: '只读邮件、昨日摘要与待办建议', summaryEn: 'Read mail, summarize yesterday and suggest next steps',
    prerequisiteCopy: '启用 Gmail API，创建自己的 Google 桌面 OAuth 客户端；客户端密钥与授权令牌保存在本机 Keychain。',
    prerequisiteEn: 'Enable Gmail API and register your own Google desktop OAuth client. Client secret and tokens stay in the local Keychain.',
    gotchaCopy: '仅请求 gmail.readonly；不能发送、归档、标记已读或改标签。Pulse 读取最多 40 封昨日邮件，正文最多 800 字符，邮件内容会交给当前模型处理。测试模式的 Google 授权可能需要定期重新连接。',
    gotchaEn: 'Requests gmail.readonly only. No sending, archiving, read-state or label changes. Pulse reads up to 40 messages from yesterday with at most 800 body characters each, passed to your selected model. Google testing grants may need reconnection.',
    auth: { mode: 'user-oauth', registration: 'preregistered', recommendedScopes: ['https://www.googleapis.com/auth/gmail.readonly'], credentialHolder: 'native-keychain', revokeUrl: 'https://myaccount.google.com/connections' },
    requires: [{ key: 'url', kind: 'url', required: true, helpId: 'gmail.endpoint' },
      { key: 'clientId', kind: 'text', required: true, helpId: 'gmail.clientId' },
      { key: 'redirectUri', kind: 'url', required: true, helpId: 'oauth.redirect' },
      { key: 'appSecret', kind: 'secretRef', required: true, helpId: 'gmail.clientSecret' },
      { key: 'tools', kind: 'text', helpId: 'tools.allowlist' }],
    operations: ['gmail_account_get','gmail_message_list','gmail_message_get','gmail_thread_get'].map(tool => ({ tool, effect: 'read', label: tool, scopes: ['https://www.googleapis.com/auth/gmail.readonly'] })),
    multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: true,
  },
  {
    providerId: 'microsoft-365', displayName: 'Microsoft 365', category: 'productivity', transport: 'microsoft365',
    summaryId: 'provider.microsoft-365', docsUrl: 'https://learn.microsoft.com/graph/permissions-reference',
    summary: '邮件、日历与文件的只读访问',
    prerequisiteCopy: '需要管理员预先注册的 Entra 公共客户端 ID 与本机回调地址。',
    auth: {
      mode: 'user-oauth', registration: 'preregistered',
      recommendedScopes: ['offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read', 'Files.Read'],
      credentialHolder: 'native-keychain', revokeUrl: 'https://myapps.microsoft.com/',
    },
    requires: [
      { key: 'url', kind: 'url', required: true, helpId: 'm365.endpoint' },
      { key: 'clientId', kind: 'text', required: true, helpId: 'm365.clientId' },
      { key: 'redirectUri', kind: 'url', required: true, helpId: 'm365.redirect' },
      { key: 'tools', kind: 'text', helpId: 'tools.allowlist' },
    ],
    operations: microsoft365Operations, verifiable: true, launchGatePassed: false, preregistered: true,
  },
  {
    providerId: 'figma', displayName: 'Figma', category: 'developer-tools', transport: 'http',
    summaryId: 'provider.figma', summary: '读取设计上下文并连接 Figma 工具', summaryEn: 'Read design context and connect Figma tools',
    docsUrl: 'https://developers.figma.com/docs/figma-mcp-server/', endpoint: 'https://mcp.figma.com/mcp', oauthIssuer: 'https://api.figma.com',
    auth: { mode: 'user-oauth', registration: 'dcr', recommendedScopes: ['mcp:connect'], credentialHolder: 'native-keychain', revokeUrl: 'https://www.figma.com/settings' },
    requires: [{ key: 'url', kind: 'url', required: true, helpId: 'http.endpoint' }, { key: 'redirectUri', kind: 'url', required: true, helpId: 'oauth.redirect' }, { key: 'tools', kind: 'text', helpId: 'tools.allowlist' }],
    prerequisiteCopy: '在浏览器选择 Figma 账户并批准连接；工具仍由 Point 白名单控制。', prerequisiteEn: 'Choose a Figma account and approve in the browser; Point retains the tool allowlist.',
    gotchaCopy: 'Figma 远程服务只接受目录内获准的 MCP 客户端；Point 的生产接入仍需服务商批准。', gotchaEn: 'Figma remote MCP accepts approved catalog clients; production access for Point requires vendor approval.',
    vendorApprovalPending: true, multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: false,
  },
  {
    providerId: 'notion', displayName: 'Notion', category: 'collaboration-docs', transport: 'http',
    summaryId: 'provider.notion', summary: '搜索 Notion 工作区并读取页面与数据库', brand: 'notion',
    docsUrl: 'https://developers.notion.com/docs/mcp', endpoint: 'https://mcp.notion.com/mcp', oauthIssuer: 'https://mcp.notion.com',
    auth: { mode: 'user-oauth', registration: 'dcr', recommendedScopes: ['default'], credentialHolder: 'native-keychain', revokeUrl: 'https://app.notion.com' },
    requires: [
      { key: 'url', kind: 'url', required: true, helpId: 'http.endpoint' },
      { key: 'redirectUri', kind: 'url', required: true, helpId: 'oauth.redirect' },
      { key: 'tools', kind: 'text', helpId: 'tools.allowlist' },
    ],
    prerequisiteCopy: '连接时需要在浏览器选择并批准一个 Notion 工作区。',
    gotchaCopy: 'Notion 使用一个合并授权，当前不能把读取与写入授权拆开。',
    multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: false,
  },
  {
    providerId: 'vercel', displayName: 'Vercel', category: 'developer-tools', transport: 'http',
    summaryId: 'provider.vercel', summary: '读取 Vercel 团队、项目与部署上下文', brand: 'vercel',
    docsUrl: 'https://vercel.com/docs/mcp/vercel-mcp', endpoint: 'https://mcp.vercel.com', oauthIssuer: 'https://vercel.com',
    auth: { mode: 'user-oauth', registration: 'dcr', recommendedScopes: [], credentialHolder: 'native-keychain', revokeUrl: 'https://vercel.com/account/settings/sign-in-with-vercel' },
    requires: [
      { key: 'url', kind: 'url', required: true, helpId: 'http.endpoint' },
      { key: 'redirectUri', kind: 'url', required: true, helpId: 'oauth.redirect' },
      { key: 'tools', kind: 'text', helpId: 'tools.allowlist' },
    ],
    prerequisiteCopy: '连接时需要在浏览器确认要授权的 Vercel 团队。',
    gotchaCopy: '批准前请核对团队；本机退出登录不会自动撤销服务商侧授权。',
    multipleConnections: true, verifiable: true, launchGatePassed: false, preregistered: false,
  },
  {
    providerId: 'remote-oauth', displayName: '远程 MCP 服务 · OAuth', category: 'custom', transport: 'http',
    summaryId: 'provider.remote-oauth', docsUrl: 'https://modelcontextprotocol.io/docs/concepts/transports',
    summary: '通过 OAuth 添加远程 MCP 服务', prerequisiteCopy: '服务端必须发布固定授权服务器元数据并支持 PKCE；动态注册还必须发布 registration_endpoint。',
    // Registration and identity answer different questions: whether an OAuth
    // client had to be registered says nothing about whether this user granted
    // anything, and nothing about which operations are permitted.
    auth: { mode: 'user-oauth', registration: 'dcr', credentialHolder: 'native-keychain' },
    requires: [
      { key: 'url', kind: 'url', required: true, helpId: 'http.endpoint' },
      { key: 'redirectUri', kind: 'url', required: true, helpId: 'oauth.redirect' },
      { key: 'tools', kind: 'text', helpId: 'tools.allowlist' },
    ],
    multipleConnections: true, verifiable: true, launchGatePassed: true,
  },
  {
    providerId: 'remote-token', displayName: '远程 MCP 服务 · 令牌', category: 'custom', transport: 'http',
    summaryId: 'provider.remote-token', docsUrl: 'https://modelcontextprotocol.io/docs/concepts/transports',
    summary: '使用密钥连接远程 MCP 服务', prerequisiteCopy: 'Authorization 等敏感 Header 必须使用 Keychain 引用，不能保存明文。',
    // A shared token lives in the configuration, so this card must never offer
    // a login or a logout: the way to remove it is to edit the header binding.
    auth: { mode: 'shared-token', registration: 'none', credentialHolder: 'native-keychain' },
    requires: [
      { key: 'url', kind: 'url', required: true, helpId: 'http.endpoint' },
      { key: 'tools', kind: 'text', helpId: 'tools.allowlist' },
    ],
    multipleConnections: true, verifiable: true, launchGatePassed: true,
  },
  {
    providerId: 'local-process', displayName: '本地进程 · stdio', category: 'custom', transport: 'stdio',
    summaryId: 'provider.local-process',
    summary: '从本地命令启动 stdio MCP 服务', prerequisiteCopy: '需要可执行文件的绝对路径与当前 SHA-256；Point 不会替你下载或安装它。',
    auth: { mode: 'none', registration: 'none', credentialHolder: 'native-keychain' },
    requires: [
      { key: 'command', kind: 'path', required: true, helpId: 'stdio.command' },
      { key: 'sha256', kind: 'text', required: true, helpId: 'stdio.digest' },
      { key: 'tools', kind: 'text', helpId: 'tools.allowlist' },
    ],
    multipleConnections: true, verifiable: true, launchGatePassed: true,
  },
  {
    providerId: 'point-builtin', displayName: 'Point 内置服务', category: 'builtin', transport: 'builtin',
    summaryId: 'provider.point-builtin',
    summary: 'Point 自带的本地工具与能力',
    auth: { mode: 'none', registration: 'none' },
    requires: [], operations: [], sealed: true, verifiable: true, launchGatePassed: true,
  },
  ...engineeringDirectory(),
  ...researchEngineeringDirectory(),
  ...channelDirectory(),
];

// Channels (WeChat, WeCom, Feishu) are messaging connectors with a shared
// turn pipeline, QR/token authentication and an inbound allowlist, not
// stateless tool connectors. They ship a distinct runtime (see
// ./channels/channel-runtime.mjs, and ./channels/<name>/ for the
// per-channel transport) instead of the MCP session every other transport
// uses, and are declared separately so that difference stays visible.
//
// `transport`/`requires`/`operations` below come from channel-fields.json, a
// file also embedded by go/harness/connectors (kept in sync by
// scripts/sync-connector-catalog.mjs): those three facts describe the fixed
// external WeChat/WeCom/Feishu protocol, so they must not drift between the
// two hosts. Everything else here (auth.credentialHolder, sealed, docsUrl,
// verifiable, ...) describes THIS host's own deployment — the Electron app
// backed by the native Keychain — and is deliberately not shared: the Go
// harness targets a different credential store and gating model.

function channelDirectory() {
  const bots = {
    slack: ['Slack', 'https://docs.slack.dev/apis/events-api/using-socket-mode/'],
    teams: ['Microsoft Teams', 'https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication'],
    discord: ['Discord', 'https://docs.discord.com/developers/events/gateway'],
    dingtalk: ['钉钉 (DingTalk)', 'https://opensource.dingtalk.com/developerpedia/docs/learn/stream/overview/'],
  };
  return [
    ...BOT_CHANNEL_IDS.map(providerId => ({
      providerId, displayName: bots[providerId][0], docsUrl: bots[providerId][1],
      category: 'messaging', summaryId: `provider.${providerId}`, transport: channelFields[providerId].transport,
      requires: channelFields[providerId].requires, operations: channelFields[providerId].operations,
      auth: { mode: 'shared-token', registration: 'preregistered', credentialHolder: 'native-keychain' },
      sealed: true, multipleConnections: true, verifiable: true, channel: true, launchGatePassed: false, preregistered: true,
    })),
    {
      providerId: 'wechat', displayName: '微信 (WeChat)', category: 'messaging', transport: channelFields.wechat.transport,
      summaryId: 'provider.wechat', docsUrl: 'https://github.com/phodal/point/blob/main/docs/adr/0070-personal-wechat-ilink-connector-and-replay.md',
      // QR confirmation is an interactive user authorization, but it is not
      // OAuth: no browser redirect or client registration exists in this flow.
      auth: { mode: 'user-qr', registration: 'none', credentialHolder: 'native-keychain' },
      requires: channelFields.wechat.requires, operations: channelFields.wechat.operations, multipleConnections: true, verifiable: true, channel: true,
      // Go's weixinProvider() ships both flags false, keeping it out of that
      // build's own listing until a real-account launch cycle completes —
      // but the Electron Channel page's QR flow already works end-to-end
      // (see the fix commits earlier this session), so gating it out of
      // this catalog's own listing the same way would hide a shipped,
      // working feature. preregistered:true keeps it visible here without
      // touching the Go side's separate, still-pending launch gate.
      launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'wecom', displayName: '企业微信 (WeCom)', category: 'messaging', transport: channelFields.wecom.transport,
      summaryId: 'provider.wecom', docsUrl: 'https://developer.work.weixin.qq.com/document/path/101039',
      // A shared bot credential serves every conversation the bot is added
      // to, so this is configured (botId/secret), not signed into.
      auth: { mode: 'shared-token', registration: 'preregistered', credentialHolder: 'native-keychain' },
      requires: channelFields.wecom.requires,
      operations: channelFields.wecom.operations, sealed: true, channel: true, launchGatePassed: false, preregistered: true,
    },
    {
      providerId: 'feishu', displayName: '飞书 (Feishu)', category: 'messaging', transport: channelFields.feishu.transport,
      summaryId: 'provider.feishu', docsUrl: 'https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case',
      auth: { mode: 'shared-token', registration: 'preregistered', credentialHolder: 'native-keychain' },
      requires: channelFields.feishu.requires,
      operations: channelFields.feishu.operations, sealed: true, multipleConnections: true, channel: true, launchGatePassed: false, preregistered: true,
    },
  ];
}


export { engineeringProviderId, argValue };
