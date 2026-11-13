import React, { useEffect, useRef, useState } from 'react';
import {
  EMPTY_DRAFT, draftFromServer, draftIssue, endpoint, importServers, matchingServers, needsAttention,
  runtimeOf, serverFromDraft, withEnabled, withImported, withServer, withoutServer,
} from './custom-mcp-model.mjs';
import { loadCustomMcps, saveCustomMcps, type McpAgent, type McpServer, type McpSession, type McpSettingsView } from './custom-mcp-client';
import {
  Button, ContentSection, Dialog, EmptyIllustration, EmptyState, Feedback, Field, Input, ListRow, LoadingSkeleton,
  Select, SkeletonText, Textarea, ToggleGroup, ToggleGroupItem,
} from './ui';

type Draft = typeof EMPTY_DRAFT;
const ISSUES: Record<string, [string, string]> = {
  name: ['请填写服务器名称，不超过 128 个字符。', 'Enter a server name up to 128 characters.'],
  command: ['请填写命令的绝对路径。', 'Enter an absolute command path.'],
  args: ['参数必须为 JSON 字符串数组，例如 ["--port", "8080"]。', 'Arguments must be a JSON array of strings, for example ["--port", "8080"].'],
  url: ['请输入不含凭据、查询参数或片段的 HTTP(S) 地址。', 'Enter an HTTP(S) URL without credentials, a query, or a fragment.'],
  tools: ['工具规则必须是 JSON 对象，将工具名映射为 allow、ask 或 deny。', 'Tool rules must be a JSON object mapping tool names to allow, ask, or deny.'],
  import: ['连接器数组无效。请使用所示格式，不含额外字段。', 'Invalid connector array. Use the documented format without extra fields.'],
  conflict: ['配置已在其他位置更改。请先重新加载。', 'Configuration changed elsewhere. Reload and review the latest values.'],
  invalid: ['请检查名称、命令路径、HTTP 地址和工具规则。', 'Check the name, command path, HTTP URL, and tool rules.'],
  unavailable: ['无法加载此 Agent 的连接器。请重新加载。', 'Could not load this Agent’s connectors. Reload to retry.'],
  read_write: ['无法读取或保存配置。草稿已保留，请重试。', 'Could not read or save configuration. Your draft is kept; try again.'],
};

function reasonText(reason: string, locale: 'zh' | 'en') {
  const pair = ISSUES[reason];
  return pair ? pair[locale === 'zh' ? 0 : 1] : reason;
}

function runtimeText(server: McpServer, sessions: McpSession[], copy: (zh: string, en: string) => string) {
  const runtime = runtimeOf(server.name, sessions);
  if (!runtime) return copy('连接和工具：尚未观测', 'Connection and tools: not observed');
  if (runtime.status === 'unobservable') return copy('不可观测：此 Agent 未上报 MCP 运行状态', 'Unobservable: this Agent has not reported MCP runtime status');
  if (runtime.status === 'connecting') return copy('连接中…', 'Connecting…');
  if (runtime.status === 'connected') {
    const tools = runtime.tools ?? [];
    return tools.length ? copy(`已连接 · ${tools.join(', ')}`, `Connected · ${tools.join(', ')}`) : copy('已连接 · 未报告工具', 'Connected · no tools reported');
  }
  if (runtime.status === 'disconnected') return copy('已断开，等待 Agent 恢复', 'Disconnected; awaiting Agent recovery');
  if (runtime.status === 'closed') return copy('已关闭', 'Closed');
  return copy('连接失败；启动新会话以重试', 'Connection failed; start a new session to retry');
}

export type CustomMcpBar = { locked: boolean; busy: boolean; loading: boolean; add: () => void; importJson: () => void; refresh: () => void };
export function CustomMcps({ locale, query, onBar }: { locale: 'zh' | 'en'; query: string; onBar?: (bar: CustomMcpBar | null) => void }) {
  const copy = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [agents, setAgents] = useState<McpAgent[]>([]);
  const [agentId, setAgentId] = useState('');
  const [revision, setRevision] = useState(0);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [sessions, setSessions] = useState<McpSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [editor, setEditor] = useState<{ index: number | null; draft: Draft } | null>(null);
  const [issue, setIssue] = useState('');
  const [confirm, setConfirm] = useState<{ index: number; enable: boolean } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const ticket = useRef(0);

  const apply = (view: McpSettingsView) => {
    setAgents(view.agents ?? []);
    setAgentId(view.agent_id ?? '');
    setRevision(view.revision ?? 0);
    setServers(view.servers ?? []);
    setSessions(view.sessions ?? []);
    setNeedsReload(false);
    setError('');
  };
  const reload = (agent = agentId) => {
    const current = ++ticket.current;
    setLoading(true);
    setSaved(false);
    return loadCustomMcps(agent).then(view => {
      if (current === ticket.current) apply(view);
    }, failure => {
      if (current === ticket.current) setError(failure instanceof Error ? failure.message : 'unavailable');
    }).finally(() => { if (current === ticket.current) setLoading(false); });
  };
  useEffect(() => { void reload(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: McpServer[]) => {
    setBusy(true);
    setError('');
    setSaved(false);
    return saveCustomMcps(agentId, revision, next).then(view => {
      apply(view);
      setEditor(null);
      setConfirm(null);
      setImportOpen(false);
      setSaved(true);
    }, failure => {
      const reason = failure instanceof Error ? failure.message : 'unavailable';
      setError(reason);
      if (reason === 'conflict' || reason === 'unavailable') setNeedsReload(true);
    }).finally(() => setBusy(false));
  };
  const locked = busy || needsReload || !agentId;
  const actions = useRef<Pick<CustomMcpBar, 'add' | 'importJson' | 'refresh'>>({ add() {}, importJson() {}, refresh() {} });
  actions.current = {
    add: () => openEditor(null),
    importJson: () => { setImportText(''); setImportOpen(true); setError(''); },
    refresh: () => { void reload(); },
  };
  useEffect(() => {
    onBar?.({ locked, busy, loading, add: () => actions.current.add(), importJson: () => actions.current.importJson(), refresh: () => actions.current.refresh() });
  }, [locked, busy, loading, onBar]);
  useEffect(() => () => onBar?.(null), [onBar]);
  const visible = matchingServers(servers, query) as McpServer[];
  const attention = visible.filter(server => needsAttention(server, sessions));
  const enabled = visible.filter(server => !needsAttention(server, sessions));
  const openEditor = (index: number | null) => {
    setIssue('');
    setEditor({ index, draft: index == null ? { ...EMPTY_DRAFT } : draftFromServer(servers[index]) });
  };
  const saveEditor = () => {
    if (!editor) return;
    const found = draftIssue(editor.draft);
    if (found) { setIssue(found); return; }
    void commit(withServer(servers, editor.index, serverFromDraft(editor.draft)));
  };
  const saveImport = () => {
    try { void commit(withImported(servers, importServers(importText))); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'import'); }
  };

  const row = (server: McpServer) => {
    const index = servers.findIndex(item => item.name === server.name);
    const dot = !server.enabled ? 'needs-attention' : runtimeOf(server.name, sessions)?.status === 'connected' ? 'connected' : runtimeOf(server.name, sessions)?.status === 'connecting' ? 'connecting' : runtimeOf(server.name, sessions)?.status === 'error' ? 'needs-attention' : '';
    return <ListRow key={`${server.name}-${index}`} className="point-connectors-row" icon={<span className="point-connectors-dot" data-state={dot} />} title={server.name}
      badge={<><span className="point-connectors-pill">{server.enabled ? copy('已启用', 'Enabled') : copy('已停用', 'Disabled')}</span><span className="point-connectors-badge">{server.transport.type === 'http' ? 'HTTP' : 'stdio'}</span></>}
      meta={<>{endpoint(server)} · {runtimeText(server, sessions, copy)}</>}
      onOpen={locked ? undefined : () => openEditor(index)}
      trailing={<div className="point-page-row-actions">
        <Button disabled={locked} onClick={() => openEditor(index)}>{copy('编辑', 'Edit')}</Button>
        <Button disabled={locked} onClick={() => server.enabled ? void commit(withEnabled(servers, index, false)) : setConfirm({ index, enable: true })}>{server.enabled ? copy('停用', 'Disable') : copy('启用…', 'Enable…')}</Button>
        <Button variant="danger" disabled={locked} onClick={() => setConfirm({ index, enable: false })}>{copy('移除', 'Remove')}</Button>
      </div>} />;
  };
  const section = (id: string, title: string, items: McpServer[]) => items.length ? <ContentSection id={`custom-mcp-${id}`} title={title} actions={<span className="point-connectors-section-count">{items.length}</span>}>
    <div className="point-page-list">{items.map(row)}</div>
  </ContentSection> : null;
  const policyServer = confirm?.enable ? servers[confirm.index] : undefined;

  return <div className="point-custom-mcps">
    {agents.length > 0 && <div className="point-connectors-actions">
      <Select label={copy('本地 Agent', 'Local Agent')} value={agentId} disabled={busy || loading} onChange={id => { setAgentId(id); void reload(id); }}
        options={agents.map(agent => ({ value: agent.id, label: agent.name }))} />
    </div>}
    {error && <Feedback kind="error" variant="block">{reasonText(error, locale)}</Feedback>}
    {saved && <Feedback kind="success" variant="block">{copy('已保存。新建会话后生效。', 'Saved. Start a new session to apply.')}</Feedback>}
    {loading && !servers.length ? <LoadingSkeleton label={copy('正在加载连接器…', 'Loading connectors…')}><SkeletonText /></LoadingSkeleton>
      : error && !agentId ? null
      : !agentId ? <EmptyState icon={<EmptyIllustration kind="connections" />} heading={copy('没有本地 Agent', 'No local Agents')} description={copy('安装本地 Agent 后即可添加 MCP 连接器。', 'Install a local Agent before adding MCP connectors.')} />
      : !visible.length && !error ? (servers.length
        ? <EmptyState icon={<EmptyIllustration kind="search" size="compact" />} heading={copy('没有匹配的连接器', 'No matching connectors')} description={copy('换个关键词。', 'Try another search.')} />
        : <EmptyState icon={<EmptyIllustration kind="connections" />} heading={copy('尚未配置连接器', 'No connectors configured')} description={copy('使用页面上的添加服务器，或导入 JSON 数组。新服务器会先停用，启用前需要确认授权。', 'Use Add server on this page, or import a JSON array. New servers stay disabled until you confirm access.')} />)
      : <>
        {section('attention', copy('需要处理', 'Needs attention'), attention)}
        {section('enabled', copy('已启用', 'Enabled'), enabled)}
      </>}
    {editor && <Dialog title={editor.index == null ? copy('添加服务器', 'Add server') : copy('编辑服务器', 'Edit server')} size="md" closeLabel={copy('关闭', 'Close')} dismissOnBackdrop onClose={() => { if (!busy) setEditor(null); }}
      footer={<><Button disabled={busy} onClick={() => setEditor(null)}>{copy('取消', 'Cancel')}</Button><Button variant="primary" disabled={busy} onClick={saveEditor}>{copy('保存为停用', 'Save disabled')}</Button></>}>
      <div className="point-custom-mcps-form">
        <p className="point-connectors-hint">{copy('保存会新增或重置为停用。启用前需要单独确认授权。', 'Saving adds the server, or resets it to disabled. Enabling asks for a separate grant.')}</p>
        <Field label={copy('服务器名称', 'Server name')}>{control => <Input {...control} value={editor.draft.name} disabled={busy} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, name: event.target.value } })} />}</Field>
        <ToggleGroup type="single" value={editor.draft.transport} aria-label={copy('传输方式', 'Transport')} onValueChange={transport => { if (transport === 'stdio' || transport === 'http') setEditor({ ...editor, draft: { ...editor.draft, transport } }); }}>
          <ToggleGroupItem value="stdio">stdio</ToggleGroupItem>
          <ToggleGroupItem value="http">HTTP</ToggleGroupItem>
        </ToggleGroup>
        {editor.draft.transport === 'http'
          ? <Field label={copy('HTTP 地址（不含凭据或查询参数）', 'HTTP URL (no credentials or query)')}>{control => <Input {...control} value={editor.draft.url} disabled={busy} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, url: event.target.value } })} />}</Field>
          : <>
            <Field label={copy('命令绝对路径', 'Absolute command path')}>{control => <Input {...control} value={editor.draft.command} disabled={busy} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, command: event.target.value } })} />}</Field>
            <Field label={copy('参数（JSON 字符串数组）', 'Arguments (JSON string array)')}>{control => <Textarea {...control} rows={3} value={editor.draft.argsText} disabled={busy} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, argsText: event.target.value } })} />}</Field>
          </>}
        <Select label={copy('默认工具权限', 'Default tool permission')} value={editor.draft.policy} disabled={busy} onChange={policy => setEditor({ ...editor, draft: { ...editor.draft, policy } })}
          options={[{ value: 'legacy', label: copy('沿用服务器授权', 'Legacy server grant') }, { value: 'allow', label: copy('允许', 'Allow') }, { value: 'ask', label: copy('每次询问', 'Ask each time') }, { value: 'deny', label: copy('拒绝', 'Deny') }]} />
        {editor.draft.policy !== 'legacy' && <Field label={copy('工具规则（JSON 对象）', 'Tool rules (JSON object)')} description={copy('例如 {"search":"allow","delete":"deny"}。未列出的工具使用默认权限。', 'For example {"search":"allow","delete":"deny"}. Unlisted tools use the default.')}>{control => <Textarea {...control} rows={4} value={editor.draft.toolsText} disabled={busy} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, toolsText: event.target.value } })} />}</Field>}
        {issue && <Feedback kind="error">{reasonText(issue, locale)}</Feedback>}
      </div>
    </Dialog>}
    {confirm && <Dialog title={confirm.enable ? copy('启用服务器', 'Enable server') : copy('移除连接器', 'Remove connector')} size="sm" closeLabel={copy('关闭', 'Close')} dismissOnBackdrop onClose={() => { if (!busy) setConfirm(null); }}
      footer={<><Button disabled={busy} onClick={() => setConfirm(null)}>{copy('取消', 'Cancel')}</Button>
        <Button variant={confirm.enable ? 'primary' : 'danger'} disabled={busy} onClick={() => void commit(confirm.enable ? withEnabled(servers, confirm.index, true) : withoutServer(servers, confirm.index))}>{confirm.enable ? (policyServer?.tool_policy ? copy('按工具规则启用', 'Enable with tool rules') : copy('授权全部工具并启用', 'Grant all tools and enable')) : copy('移除', 'Remove')}</Button></>}>
      <p>{confirm.enable
        ? (policyServer?.tool_policy
          ? copy('是否按已保存的默认权限和工具规则启用服务器？询问会要求每次调用获得批准。', 'Enable this server with the saved default and tool rules? Ask requires approval for every call.')
          : copy('启用将授权 Agent 使用此服务器的全部工具，不会逐项审批。请只启用可信服务器。', 'Enabling grants the Agent access to every tool from this server. Tools are not approved individually. Only enable servers you trust.'))
        : copy('从后续会话中移除此连接器？现有会话不受影响。', 'Remove this connector from future sessions? Existing sessions are not changed.')}</p>
    </Dialog>}
    {importOpen && <Dialog title={copy('导入 JSON', 'Import JSON')} size="lg" closeLabel={copy('关闭', 'Close')} dismissOnBackdrop onClose={() => { if (!busy) setImportOpen(false); }}
      footer={<><Button disabled={busy} onClick={() => setImportOpen(false)}>{copy('取消', 'Cancel')}</Button><Button variant="primary" disabled={busy || !importText.trim()} onClick={saveImport}>{copy('导入为停用', 'Import as disabled')}</Button></>}>
      <p className="point-connectors-hint">{copy('追加 JSON 连接器数组，所有导入项均为停用。不接受 env、headers 等额外字段。请勿粘贴密钥。', 'Append a JSON array of connectors. Every imported server is disabled. Unknown fields, including env and headers, are rejected. Do not paste secrets.')}</p>
      <Textarea aria-label={copy('导入 JSON', 'Import JSON')} rows={8} value={importText} disabled={busy} onChange={event => setImportText(event.target.value)}
        placeholder={'[{"name":"example","transport":{"type":"http","url":"https://example.com/mcp"}}]'} />
    </Dialog>}
  </div>;
}
