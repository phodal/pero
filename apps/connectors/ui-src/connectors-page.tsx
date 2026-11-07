import React, { useEffect, useMemo, useRef, useState } from 'react';
import './connectors-page.css';
import { validateResearchSettings } from './connector-definition.mjs';
import { matchesProvider } from './shared/catalog-search.mjs';
import { useConnectorDetail } from './use-connector-detail.ts';
import { useInstallRecords } from './use-install-records.ts';
import { useConnectorsSnapshot } from './use-connectors-snapshot';
import { ConnectorDetailDialog, PROVIDER_NAMES_EN, StatusDot } from './connector-detail-dialog.tsx';
import { JsonEditor, jsonProblem } from './connector-editor.tsx';
import type { DirectoryEntry, ConnectionView, Reply, ImportDraft } from './connector-types.ts';
import { PROVIDER_SUMMARIES_EN, PROVIDER_SUMMARIES, AUTH_MODE_TEXT_EN, ProviderIcon, IMPORT_EXAMPLES } from './connectors-catalog.tsx';
import {
  ACTION_LABELS, ACTION_LABELS_EN, AUTH_MODE_TEXT, BADGE_LABELS, BADGE_LABELS_EN,
  STATE_LABELS, STATE_LABELS_EN, LIFECYCLE_HINTS, LIFECYCLE_HINTS_EN, cardTitle, errorText, explain, summaryLine,
} from './shared/connection-copy.mjs';
import { importConnectorJSON } from './shared/import-json.mjs';
import { CAPABILITY_GUIDES, capabilityGuides, visibleCapabilityGuides } from './capability-guides.mjs';

import { connectorSections, connectorShelf, connectorShelfLabels } from './connector-categories.mjs';
import { CustomMcps } from './custom-mcps';
import { errorMessage } from './error-message.ts';
import type { PointBrowserOpener, PointBrowserRequest } from './bridge.ts';
import { Button, Card, Dialog, EmptyIllustration, EmptyState, Icon, IconButton, InfoTip, LoadingSkeleton, RadioGroup, RadioGroupItem, SearchField, Select, SkeletonCards, SkeletonText, Tabs, TabsContent, TabsList, TabsTrigger, ToggleGroup, ToggleGroupItem, Toolbar } from './ui';


const ATTENTION = new Set(['needs-attention', 'needs-authorization', 'needs-configuration', 'not-verified']);
const READY = new Set(['connected', 'verified']);

export { connectorRequest as connectorsRequest } from './bridge';
import { connectorRequest as connectorsRequest } from './bridge';

/** Client-side pre-check before `put` — mirrors app.mjs's `$('editor').onsubmit`.
 *  The native service re-validates everything regardless; this only turns an
 *  obvious mistake into an inline message instead of a round trip. */
function validateDraft(connectorId: string, definition: any, locale = 'zh'): { field?: string; message: string } | null {
  const copy = (zh: string, en: string) => locale === 'zh' ? zh : en;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(connectorId)) return { field: 'id', message: copy('请输入 1–128 位 ID，以字母或数字开头，仅使用字母、数字、点、下划线或连字符。', 'Enter a 1–128 character ID starting with a letter or digit. Use letters, digits, dots, underscores or hyphens.') };
  if (!['http', 'gitlab', 'github', 'linear', 'microsoft365', 'gmail', 'stdio'].includes(definition.transport)) return { field: 'json', message: copy('请选择 HTTP、GitLab、GitHub、Linear、Microsoft 365、Gmail 或 stdio 传输方式。', 'Choose HTTP, GitLab, GitHub, Linear, Microsoft 365, Gmail, or stdio transport.') };
  if (['http', 'gitlab', 'github', 'linear', 'microsoft365', 'gmail'].includes(definition.transport)) {
    try {
      const url = new URL(definition.url);
      const bad = definition.transport === 'gmail' ? url.href !== 'https://gmail.googleapis.com/gmail/v1/users/me/' : definition.transport === 'microsoft365' ? url.href !== 'https://graph.microsoft.com/v1.0/'
        : definition.transport === 'gitlab' ? url.protocol !== 'https:' || !url.pathname.endsWith('/api/v4/')
        : definition.transport === 'github' ? url.href !== 'https://api.github.com/'
        : definition.transport === 'linear' ? url.href !== 'https://api.linear.app/graphql'
        : url.protocol !== 'https:' && !(definition.allowLoopbackHttp === true && url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname));
      if (bad || url.username || url.password || url.hash) throw new Error();
    } catch {
      return {
        field: 'endpoint', message: definition.transport === 'gmail' ? copy('Gmail 地址必须是 https://gmail.googleapis.com/gmail/v1/users/me/。', 'Gmail requires https://gmail.googleapis.com/gmail/v1/users/me/.') : definition.transport === 'microsoft365' ? copy('Microsoft 365 P0 仅允许 https://graph.microsoft.com/v1.0/。', 'Microsoft 365 requires https://graph.microsoft.com/v1.0/.')
          : definition.transport === 'gitlab' ? copy('GitLab 地址必须使用 HTTPS，并以 /api/v4/ 结尾。', 'The GitLab URL must use HTTPS and end in /api/v4/.')
          : definition.transport === 'github' ? copy('GitHub P0 仅允许 https://api.github.com/。', 'GitHub requires https://api.github.com/.')
          : definition.transport === 'linear' ? copy('Linear P0 仅允许 https://api.linear.app/graphql。', 'Linear requires https://api.linear.app/graphql.')
          : copy('请输入有效的 HTTPS 服务地址，不含用户名、密码或片段。本地 HTTP 需在 JSON 中设置 allowLoopbackHttp。', 'Enter a valid HTTPS URL without credentials or fragments. Local HTTP requires allowLoopbackHttp in JSON.'),
      };
    }
  }
  if (definition.transport === 'stdio') {
    if (typeof definition.command !== 'string' || !definition.command.startsWith('/')) return { field: 'command', message: copy('请填写可执行文件的绝对路径。', 'Enter the absolute path of the executable.') };
    if (typeof definition.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(definition.sha256)) return { field: 'sha256', message: copy('请填写 64 位 SHA-256 摘要。', 'Enter a 64-character SHA-256 digest.') };
  }
  if (!Array.isArray(definition.tools) || definition.tools.length > 128 || definition.tools.some((t: any) => typeof t !== 'string' || !t.trim() || t.length > 128) || new Set(definition.tools).size !== definition.tools.length) {
    return { field: 'tools', message: copy('最多 128 个不重复的工具名，每个不超过 128 字符。留空表示暂不允许任何工具。', 'Use up to 128 unique tool names, at most 128 characters each. An empty list allows no tools.') };
  }
  return null;
}

type CapabilityGuide = (typeof CAPABILITY_GUIDES)[number];

/**
 * The Connectors page. With `openProvider` it renders only that provider's
 * configuration dialog (its connection when one exists, else the install
 * form) and calls `onClosed` when the dialog closes — how Pulse connects
 * GitHub or Linear in place instead of sending the person to this page.
 */
type ConnectorMode = 'catalog' | 'manage' | 'custom';
export function ConnectorsPage({ onTry, onOpenUrl, openProvider, onClosed, openConnection, settingsOnly = false, initialMode = 'catalog', onModeChange, locale = 'zh' }: { locale?: 'zh' | 'en'; initialMode?: ConnectorMode; onOpenUrl?: PointBrowserOpener; onModeChange?: (mode: ConnectorMode) => void; onTry?: (prompt: string) => void | Promise<void>; openProvider?: string; openConnection?: string; settingsOnly?: boolean; onClosed?: () => void } = {}) {
  const categoryLabels = connectorShelfLabels(locale);
  const copy = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const { directory, connections, entries, error, loading, refreshing, reload } = useConnectorsSnapshot(locale);
  const dialogOnly = !!openProvider;
  const openedFor = useRef('');
  const [mode, updateMode] = useState<ConnectorMode>(initialMode);
  const setMode = (next: ConnectorMode) => { updateMode(next); onModeChange?.(next); };
  useEffect(() => updateMode(initialMode), [initialMode]);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [removeTarget, setRemoveTarget] = useState<ConnectionView | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [stateFilter, setStateFilter] = useState<'all' | 'attention' | 'ready' | 'paused'>('all');
  const [guideId, setGuideId] = useState<string | null>(null);
  const [exampleId, setExampleId] = useState<string | null>(null);
  const [guideError, setGuideError] = useState('');
  const [trying, setTrying] = useState(false);

  const [toolSelection, setToolSelection] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const mutationBusy = useRef(false);
  const say = (text: string, isError = false) => { setNotice(text); setNoticeError(isError); };
  const docsRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { docsRequest.current?.abort(); }, []);
  // Provider docs open in Pero's own browser pane when the host offers it;
  // the Host link (system browser, confirmed) remains the fallback.
  const openDocs = (providerId?: string) => {
    if (!providerId) return;
    void connectorsRequest({ operation: 'link', providerId, kind: 'docs' })
      .then(reply => { if (!reply.ok) say(errorText(reply.code, locale), true); })
      .catch(error => say(errorMessage(error), true));
  };
  const detail = useConnectorDetail({ directory, connections, entries, locale, settingsOnly, isBusy: () => mutationBusy.current,
    request: connectorsRequest, say, openDocs, onClosed: () => { if (dialogOnly) onClosed?.(); },
  });
  const { detailOpen, detailConnectorId, connectorIdField, setConnectorIdField, definitionText, setDefinitionText,
    setEditMode, secretReference, secretValue, setSecretValue, setFieldError, provider, view, isDirty,
    openDetail, closeDetail } = detail;
  const [configurationRequest, setConfigurationRequest] = useState({ connectionId: '', revision: 0 });
  const installRecords = useInstallRecords(connectorsRequest, mode === 'catalog' && !dialogOnly && !detailOpen);

  // Falls back to 'all' once the directory loads if the selected category
  // turns out not to exist in it (or, transiently, while directory is still
  // empty during the first load).
  const resolvedCategory = category !== 'all' && !directory.some(d => connectorShelf(d) === category) ? 'all' : category;
  useEffect(() => { if (category !== resolvedCategory) setCategory(resolvedCategory); }, [resolvedCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dialog-only mode opens its provider once the directory has loaded.
  useEffect(() => {
    if (!openProvider || openedFor.current === openProvider || loading || !directory.length) return;
    openedFor.current = openProvider;
    const existing = connections.find(c => c.connectionId === openConnection && c.providerId === openProvider) ?? connections.find(c => c.providerId === openProvider && c.enabled) ?? connections.find(c => c.providerId === openProvider);
    openDetail(existing?.connectionId ?? null, openProvider);
  }, [openProvider, loading, directory, connections]); // eslint-disable-line react-hooks/exhaustive-deps

  const importPreview = useMemo((): { draft?: ImportDraft; error?: string } => {
    if (!importText.trim() || jsonProblem(importText)) return {};
    try { return { draft: importConnectorJSON(importText, locale) as ImportDraft }; } catch (e: any) { return { error: e.message }; }
  }, [importText, locale]);
  const openImport = () => { setImportText(''); setImportOpen(true); say(''); };
  const pasteClipboard = async () => {
    try { setImportText(await navigator.clipboard.readText()); }
    catch { say(copy('无法读取剪贴板，请直接在编辑器里粘贴（⌘V）。', 'Could not read the clipboard. Paste into the editor directly (⌘V).'), true); }
  };
  const continueImport = () => {
    if (!importPreview.draft) return;
    setImportOpen(false);
    openDetail(null, null, importPreview.draft);
  };

  const requestRemove = (target: ConnectionView) => setRemoveTarget(target);

  // Returns `{ result }` on success (result may itself be null/undefined —
  // that must not read as failure) or `null` on failure/already-busy, so a
  // caller can tell "nothing came back" apart from "this didn't happen".
  const run = async (label: string, fn: () => Promise<Reply>, message?: string): Promise<{ result: any } | null> => {
    if (mutationBusy.current) return null;
    mutationBusy.current = true;
    setBusy(label); say(message ?? copy('正在处理…', 'Working…'));
    try {
      const reply = await fn();
      if (!reply.ok) throw reply;
      await reload();
      return { result: reply.result ?? null };
    } catch (e: any) {
      say(errorText(e?.code, locale) ?? errorMessage(e), true);
      return null;
    } finally { mutationBusy.current = false; setBusy(''); }
  };

  const confirmRemove = () => {
    const target = removeTarget;
    if (!target || busy) return;
    const bound = { connectorId: target.connectionId, expectedRevision: target.revision };
    void run('remove', () => connectorsRequest({ operation: 'remove', ...bound }), copy('正在删除连接配置…', 'Removing connection…'))
      .then(outcome => {
        if (!outcome) return;
        setRemoveTarget(null);
        if (detailConnectorId === target.connectionId) closeDetail(true);
      });
  };

  const save = () => {
    setFieldError(null);
    let definition: any;
    try { definition = JSON.parse(definitionText); if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error(); }
    catch { setFieldError({ field: 'json', message: copy('配置不是有效 JSON 对象。请检查括号、引号和逗号。', 'Enter a valid JSON object. Check brackets, quotes, and commas.') }); return; }
    const problem = validateResearchSettings(provider?.providerId, definition, locale) ?? validateDraft(connectorIdField, definition, locale);
    if (problem) { setFieldError(problem); if (problem.field === 'json') setEditMode('json'); return; }
    const savedId = connectorIdField, savedText = definitionText, generation = detail.generation;
    // Reload already refreshed `connections`/`entries`, but this closure still
    // holds the pre-reload state — mark the connector "now existing" via
    // state instead of re-deriving from (stale) directory/connections here;
    // the next render resolves `view`/`raw` fresh from the reloaded state.
    void run('put', () => connectorsRequest({ operation: 'put', connectorId: savedId, definition, ...(view ? { expectedRevision: view.revision } : {}) }), copy('正在保存配置…', 'Saving configuration…'))
      .then(outcome => { if (outcome) { detail.markSaved(savedId, savedText, generation); setMode('manage'); say(copy('配置已保存。', 'Configuration saved.')) } });
  };

  const importPasted = () => {
    setFieldError(null);
    let draft;
    try { draft = importConnectorJSON(definitionText, locale); }
    catch (e: any) { setFieldError({ field: 'json', message: e.message }); return; }
    setDefinitionText(JSON.stringify(draft.definition, null, 2));
    if (draft.connectorId && !view && !connectorIdField) setConnectorIdField(draft.connectorId);
    say(draft.notes.length ? copy(`已导入，还有几项需要补全：${draft.notes.join(' ')}`, `Imported. A few items still need attention: ${draft.notes.join(' ')}`) : copy('已导入。', 'Imported.'));
  };

  // Takes an explicit target so the manage list's per-row primary button can
  // act on that row directly, the way app.mjs's cards do, instead of every
  // action requiring a detour through the open detail panel first.
  const perform = (action: string, target: ConnectionView | null = view) => {
    if (!target) return;
    if (action === 'configure') {
      if (mutationBusy.current) return;
      if (!detailOpen || detailConnectorId !== target.connectionId) openDetail(target.connectionId);
      setConfigurationRequest(previous => ({ connectionId: target.connectionId, revision: previous.revision + 1 }));
      return;
    }
    const bound = { connectorId: target.connectionId, expectedRevision: target.revision };
    if (action === 'connect' || action === 'reauthorize') {
      void run('connect.begin', () => connectorsRequest({ operation: 'connect.begin', connectorId: target.connectionId, intent: action === 'reauthorize' ? 'reauthorize' : 'first-connect' }),
        copy('正在开始授权，请在浏览器登录…', 'Starting authorization. Sign in through your browser…'))
        .then(outcome => { if (outcome) say(copy('授权已开始。可离开页面，或取消连接。', 'Authorization started. You can leave this page or cancel the connection.')); });
      return;
    }
    if (action === 'cancel-attempt') {
      const attemptId = target.attempt?.attemptId;
      if (!attemptId) { say(copy('这次授权已结束。', 'This authorization has ended.'), true); return; }
      void run('connect.cancel', () => connectorsRequest({ operation: 'connect.cancel', connectorId: target.connectionId, attemptId }), copy('正在取消…', 'Cancelling…'));
      return;
    }
    if (action === 'verify' || action === 'retry') {
      if (detailConnectorId === target.connectionId && isDirty) { say(copy('请先保存或撤销草稿，再验证连接。', 'Save or discard the draft before verifying.'), true); return; }
      void run('verify', () => connectorsRequest({ operation: 'verify', connectorId: target.connectionId }), copy('正在验证…', 'Verifying…'))
        .then(outcome => { if (outcome) say(copy(`验证通过：${outcome.result.toolCount} 个工具；测试连接已释放。`, `Verified ${outcome.result.toolCount} tools; the probe connection was released.`)); });
      return;
    }
    if (action === 'enable' || action === 'disable') { void run('enable', () => connectorsRequest({ operation: 'enable', ...bound, enabled: action === 'enable' })); return; }
    if (action === 'disconnect-runtime') { void run('disconnect', () => connectorsRequest({ operation: 'disconnect', connectorId: target.connectionId }), copy('正在关闭运行连接…', 'Closing the runtime connection…')); return; }
    if (action === 'logout') { void run('logout', () => connectorsRequest({ operation: 'logout', ...bound }), copy('正在清除本机授权记录…', 'Clearing local authorization…')); return; }
    if (action === 'remove') { requestRemove(target); return; }
    if (action === 'open-docs') { openDocs(target.providerId ?? provider?.providerId); return; }
    if (action === 'revoke-at-provider') {
      void connectorsRequest({ operation: 'link', providerId: target.providerId, kind: 'revoke' }).then(reply => say(reply.ok ? copy('已打开服务商页面，需在该页面撤销授权。', 'Provider page opened. Revoke consent there.') : errorText(reply.code, locale), !reply.ok));
      return;
    }
  };

  const saveSecret = () => {
    const value = secretValue; setSecretValue('');
    void run('secret.set', () => connectorsRequest({ operation: 'secret.set', reference: secretReference, value }), copy('正在保存密钥…', 'Saving secret…')).then(result => { if (result) say(copy('密钥已保存。', 'Secret saved.')); });
  };
  const deleteSecret = () => void run('secret.delete', () => connectorsRequest({ operation: 'secret.delete', reference: secretReference }), copy('正在删除密钥…', 'Deleting secret…')).then(result => { if (result) say(copy('密钥已删除。', 'Secret deleted.')); });

  const saveTools = () => {
    if (!view) return;
    void run('tools.set', () => connectorsRequest({ operation: 'tools.set', connectorId: view.connectionId, tools: [...toolSelection], expectedRevision: view.revision }), copy('正在保存工具权限…', 'Saving tool access…'));
  };
  useEffect(() => {
    if (!view) return;
    setToolSelection(new Set([...view.tools.usable, ...view.tools.blocked.filter(item => item.reason !== 'not-host-allowed').map(item => item.name)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.connectionId, view?.revision]);

  const catalogDirectory = directory.filter(entry => connectorShelf(entry));
  const matchesCatalog = catalogDirectory.filter(entry => (category === 'all' || connectorShelf(entry) === category) &&
    matchesProvider(entry, search, [PROVIDER_NAMES_EN[entry.providerId] ?? '']));
  const categoriesAvailable = ['all', ...connectorSections(directory, locale).map(section => section.id)];
  const catalogSections = connectorSections(matchesCatalog, locale);
  const matchesManage = connections.filter(view => (view.connectionId.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || view.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || view.origin.toLocaleLowerCase().includes(search.toLocaleLowerCase())) &&
    (stateFilter === 'all' || (stateFilter === 'attention' ? ATTENTION.has(view.state) : stateFilter === 'ready' ? READY.has(view.state) : !view.enabled)));

  const guides = mode === 'catalog' ? visibleCapabilityGuides(search, category, locale) : [];
  const guide = capabilityGuides(locale).find(item => item.id === guideId) ?? null;
  const openGuide = (item: CapabilityGuide) => {
    setGuideId(item.id);
    setExampleId(item.examples[0]?.id ?? null);
    setGuideError('');
  };
  const tryGuide = async () => {
    if (!guide) return;
    const example = guide.examples.find(item => item.id === exampleId) ?? guide.examples[0];
    if (!example) return;
    if (!onTry) {
      setGuideError(copy('试用还没接到当前对话。', 'Try it is not connected to the current conversation yet.'));
      return;
    }
    setGuideError('');
    setTrying(true);
    try {
      await onTry(example.prompt);
      setGuideId(null);
    } catch (e) {
      setGuideError(errorMessage(e));
    } finally {
      setTrying(false);
    }
  };

  return <Tabs value={mode} onValueChange={next => { if (next === 'catalog' || next === 'manage' || next === 'custom') { setMode(next); setSearch(''); } }}><section className={dialogOnly ? 'point-connectors-dialog-only' : 'point-page point-connectors-page'} aria-label={copy('连接器', 'Connectors')}>
    {error && mode !== 'custom' && <div role="alert"><p className="point-error">{error} {directory.length || connections.length ? copy('当前显示上次读取的结果。', 'Showing the last loaded results.') : ''}</p><Button onClick={() => void reload()} disabled={refreshing}>{copy('重新加载', 'Reload')}</Button></div>}
    {loading && dialogOnly && <p className="point-page-note" role="status">{copy('正在加载…', 'Loading…')}</p>}
    {!dialogOnly && <>

    <Toolbar className="point-page-toolbar point-connectors-toolbar">
      <TabsList variant="navigation" aria-label={copy('视图', 'View')}>
        <TabsTrigger value="catalog">{copy('服务目录', 'Service catalog')}</TabsTrigger>
        <TabsTrigger value="manage">{copy('已安装连接', 'Installed connections')}{connections.length ? ` ${connections.length}` : ''}</TabsTrigger>
        <TabsTrigger value="custom">{copy('自定义 MCPs', 'Custom MCPs')}</TabsTrigger>
      </TabsList>
      {mode !== 'custom' && <div className="point-page-actions"><IconButton label={copy('刷新', 'Refresh')} disabled={refreshing} onClick={() => void reload()}><Icon name="refresh" /></IconButton><Button onClick={openImport} disabled={!!error || loading}><Icon name="plus" />{copy('自定义 MCP', 'Custom MCP')}</Button></div>}
    </Toolbar>

    <div className="point-connectors-search-tools"><SearchField placeholder={mode === 'custom' ? copy('搜索自定义 MCP', 'Search custom MCPs') : mode === 'manage' ? copy('搜索已安装连接', 'Search installed connections') : copy('搜索服务与能力', 'Search services and capabilities')} value={search} onChange={e => setSearch(e.target.value)} aria-label={copy('搜索', 'Search')} />
      {mode === 'catalog' && <Select label={copy('服务分类', 'Service category')} value={category} onChange={setCategory}
        options={categoriesAvailable.map(key => ({ value: key, label: key === 'all' ? copy('全部服务', 'All services') : categoryLabels[key] ?? key }))} />}
    </div>

    {refreshing && !loading && mode !== 'custom' && <p className="point-page-note" role="status">{copy('正在刷新，保留上次连接状态…', 'Refreshing; previous connection states remain visible…')}</p>}
    {notice && mode !== 'custom' && !detailOpen && !importOpen && <p className={noticeError ? 'point-error' : 'point-connectors-notice'} role={noticeError ? 'alert' : 'status'}>{notice}</p>}

    {mode === 'catalog' && <TabsContent value="catalog" className="point-connectors-catalog">
      {guides.length > 0 && <section className="point-connectors-capabilities" aria-label={copy('内置能力', 'Built-in capabilities')}>
        <h2 className="point-connectors-section-title">{copy('内置能力', 'Built-in capabilities')}</h2>
        <div className="point-connectors-guides">{guides.map(item => <Button key={item.id} variant="ghost" className="point-connectors-guide" aria-label={item.title} aria-describedby={`capability-${item.id}`} onClick={() => openGuide(item)}>
          {item.id === 'computer-use' ? <Icon family="shell" name="computer" size={20} /> : <Icon name="app" size={20} />}
          <span className="point-connectors-guide-copy">
            <span className="point-connectors-guide-title">{item.title}</span>
            <span className="point-connectors-guide-summary" id={`capability-${item.id}`}>{item.summary}</span>
          </span>
          <Icon name="chevron-right" />
        </Button>)}</div>
      </section>}
      {loading && !directory.length && <LoadingSkeleton label={copy('正在加载服务目录…', 'Loading the service catalog…')}><SkeletonCards count={3} /></LoadingSkeleton>}
      {/* One section per tab, in tab order, so the catalog reads as sections instead of one long mixed grid. */}
      {catalogSections.map(section => <section key={section.id} className="point-connectors-section" aria-label={section.label}>
        <h2 className="point-connectors-section-title">{section.label}<span>{section.entries.length}</span></h2>
        <div className="point-connectors-grid">
          {section.entries.map((entry: DirectoryEntry) => {
            const installed = connections.filter(c => c.providerId === entry.providerId);
            const record = installed.length ? undefined : installRecords[entry.providerId];
            const summary = (locale === 'en' ? entry.summaryEn ?? PROVIDER_SUMMARIES_EN[entry.providerId] : entry.summary) ?? entry.summary ?? PROVIDER_SUMMARIES[entry.providerId] ?? copy('按配置的工具范围连接服务', 'Connect using the configured tools');
            const prerequisite = (locale === 'en' ? entry.prerequisiteEn : entry.prerequisiteCopy) ?? entry.prerequisiteCopy;
            const stage = ({ tenant: copy('需账号或机构权限', 'Account or organization access'), review: copy('待适配验证', 'Compatibility review'), vendor: copy('需供应商开通', 'Vendor access required'), upcoming: copy('尚未发布', 'Announced'), planned: copy('待封装适配器', 'Adapter planned') } as Record<string, string>)[entry.catalogStage ?? ''];
            const auth = entry.providerId === 'feishu-workspace' ? copy('CLI 用户授权', 'CLI user authorization') : (locale === 'zh' ? AUTH_MODE_TEXT : AUTH_MODE_TEXT_EN)[entry.auth?.mode ?? 'none'];
            return <Card key={entry.providerId} asChild><article className="point-connectors-tile" data-installed={installed.length > 0}>
              <div className="point-connectors-card-head">
                <span className="point-connectors-symbol"><ProviderIcon entry={entry} /></span>
                <div className="point-connectors-tile-heading">
                  <h3 className="point-connectors-card-title">{locale === 'en' ? PROVIDER_NAMES_EN[entry.providerId] ?? entry.displayName : entry.displayName}</h3>
                  <div className="point-connectors-card-meta">{installed.length ? copy(`已安装 · ${installed.length} 个连接`, `Installed · ${installed.length} connections`) : record === 'running' ? copy('正在后台安装…', 'Installing in the background…') : record ? copy('服务已安装 · 未添加', 'Server installed · Not added') : stage ?? (entry.transport === 'stdio' ? copy('需本机软件', 'Local software required') : auth)}</div>
                </div>
              </div>
              <p className="point-connectors-summary">{summary}</p>
              <div className="point-connectors-card-actions">
                {prerequisite && <InfoTip label={copy('使用要求', 'Requirements')} text={prerequisite} />}
                {installed.length
                  ? <Button className="point-connectors-tile-action" onClick={() => { if (installed.length === 1) openDetail(installed[0].connectionId); else { setMode('manage'); setSearch(entry.displayName); } }}>{copy('管理', 'Manage')}</Button>
                  : entry.listed ? <Button className="point-connectors-tile-action" title={prerequisite} onClick={() => openDocs(entry.providerId)}>{copy('查看文档', 'View docs')}</Button>
                  : <Button className="point-connectors-tile-action" disabled={!!entry.sealed} title={entry.sealed ? copy('内置服务由应用提供，不能新建实例', 'Built-in services are provided by the app') : copy('查看要求并配置连接', 'Review requirements and configure a connection')} onClick={() => openDetail(null, entry.providerId)}>{entry.sealed ? copy('内置', 'Built-in') : copy('添加连接', 'Add connection')}</Button>}
              </div>
            </article></Card>;
          })}
        </div>
      </section>)}
      {!matchesCatalog.length && (!guides.length || !catalogDirectory.length) && !loading && !error && (catalogDirectory.length ? <EmptyState icon={<EmptyIllustration kind="search" size="compact" />}
        heading={copy('没有匹配的服务', 'No matching services')} description={copy('换个关键词，或清除分类筛选。', 'Try another search or clear the category filter.')}
        actions={<Button onClick={() => { setSearch(''); setCategory('all'); }}>{copy('清除筛选', 'Clear filters')}</Button>} />
        : <EmptyState icon={<EmptyIllustration kind="connections" />} heading={copy('服务目录暂无内容', 'No services available')}
          description={copy('重新加载目录，或添加自定义 MCP。', 'Reload the service catalog or add a custom MCP.')}
          actions={<><Button onClick={() => void reload()} disabled={refreshing}>{copy('重新加载', 'Reload')}</Button><Button onClick={openImport}>{copy('添加自定义 MCP', 'Add custom MCP')}</Button></>} />)}
    </TabsContent>}

    {mode === 'manage' && <TabsContent value="manage" className="point-connectors-manage">
      <ToggleGroup className="point-page-filters point-connectors-categories" type="single" value={stateFilter} aria-label={copy('筛选', 'Filter')} onValueChange={next => { if (next === 'all' || next === 'attention' || next === 'ready' || next === 'paused') setStateFilter(next); }}>
        {([['all', copy('全部', 'All')], ['attention', copy('需处理', 'Needs attention')], ['ready', copy('正常', 'Ready')], ['paused', copy('已停用', 'Paused')]] as const).map(([key, label]) =>
          <ToggleGroupItem key={key} value={key}>{label} {key === 'all' ? connections.length : key === 'attention' ? connections.filter(c => ATTENTION.has(c.state)).length : key === 'ready' ? connections.filter(c => READY.has(c.state)).length : connections.filter(c => !c.enabled).length}</ToggleGroupItem>)}
      </ToggleGroup>
      {loading && !connections.length && <LoadingSkeleton label={copy('正在加载已安装连接…', 'Loading installed connections…')}><SkeletonText /></LoadingSkeleton>}
      {matchesManage.length > 0 && <div className="point-page-list">
        {matchesManage.map(view => <article key={view.connectionId} className="point-page-row point-connectors-row-card" data-state={view.state}>
          <span className="point-connectors-symbol"><StatusDot state={view.state} /></span>
          <div className="point-connectors-row-copy">
            <div className="point-connectors-row-title">
              <Button variant="link" className="point-connectors-link" onClick={() => openDetail(view.connectionId)}>{cardTitle(view)}</Button>
              <span className="point-connectors-pill" data-state={view.state}>{(locale === 'en' ? STATE_LABELS_EN : STATE_LABELS)[view.state] ?? view.state}</span>
              {view.badges.filter(b => ['lease-held', 'probe-released', 'source-builtin'].includes(b)).map(b => <span key={b} className="point-connectors-badge">{(locale === 'en' ? BADGE_LABELS_EN : BADGE_LABELS)[b] ?? b}</span>)}
            </div>
            <div className="point-connectors-row-meta">{summaryLine(view)}</div>
          </div>
          <div className="point-page-row-actions">
            <Button disabled={!!busy} title={(locale === 'en' ? LIFECYCLE_HINTS_EN : LIFECYCLE_HINTS)[view.primary] ?? ''} onClick={() => perform(view.primary, view)}>{(locale === 'en' ? ACTION_LABELS_EN : ACTION_LABELS)[view.primary] ?? view.primary}</Button>
            <Button aria-label={`${copy('详情', 'Details')} ${cardTitle(view)}`} onClick={() => openDetail(view.connectionId)}>{copy('详情', 'Details')}</Button>
            {view.lifecycle.includes('remove') && <Button variant="danger" disabled={!!busy}
              aria-label={`${copy('删除', 'Remove')} ${cardTitle(view)}`} title={(locale === 'en' ? LIFECYCLE_HINTS_EN : LIFECYCLE_HINTS).remove ?? ''} onClick={() => requestRemove(view)}>{copy('删除', 'Remove')}</Button>}
          </div>
        </article>)}
      </div>}
      {!matchesManage.length && !loading && !error && (connections.length ? <EmptyState icon={<EmptyIllustration kind="search" size="compact" />}
        heading={copy('没有匹配的连接', 'No matching connections')} description={copy('换个关键词，或清除状态筛选。', 'Try another search or clear the state filter.')}
        actions={<Button onClick={() => { setSearch(''); setStateFilter('all'); }}>{copy('清除筛选', 'Clear filters')}</Button>} />
        : <EmptyState icon={<EmptyIllustration kind="connections" />} heading={copy('尚未添加连接', 'No connections yet')}
          description={copy('从服务目录安装一个连接，或添加自定义 MCP。', 'Install a connection from the service catalog or add a custom MCP.')}
          actions={<><Button variant="primary" onClick={() => { setMode('catalog'); setSearch(''); setCategory('all'); }}>{copy('查看服务目录', 'Browse service catalog')}</Button><Button onClick={openImport}>{copy('添加自定义 MCP', 'Add custom MCP')}</Button></>} />)}
    </TabsContent>}

    {mode === 'custom' && <TabsContent value="custom" className="point-connectors-manage"><CustomMcps locale={locale} query={search} /></TabsContent>}
    </>}

    {importOpen && <Dialog title={copy('添加自定义 MCP', 'Add custom MCP')} size="lg" closeLabel={copy('关闭', 'Close')} dismissOnBackdrop initialFocus="#connector-import-json" onClose={() => setImportOpen(false)}
      footerStart={<Button variant="ghost" onClick={() => { setImportOpen(false); openDetail(null, null); }}>{copy('改用表单填写', 'Use the form instead')}</Button>}
      footer={<><Button onClick={() => setImportOpen(false)}>{copy('取消', 'Cancel')}</Button><Button variant="primary" disabled={!importPreview.draft} onClick={continueImport}>{copy('导入并继续', 'Import and continue')}</Button></>}>
        <p className="point-connectors-hint">{copy('粘贴 MCP 服务 README 或其他客户端（Claude、VS Code、Cursor、Codex）里的配置 JSON。支持 ', 'Paste the configuration JSON from an MCP server README or another client (Claude, VS Code, Cursor, Codex). Accepts ')}<code>mcpServers</code>{copy('、', ', ')}<code>servers</code>{copy(' 包装、单个服务对象，以及本应用自己的连接定义。', ' wrappers, a single server object, or this app’s own connection definition.')}</p>
        <div className="point-connectors-actions">
          <Button onClick={() => void pasteClipboard()}>{copy('从剪贴板粘贴', 'Paste from clipboard')}</Button>
          <Button onClick={() => setImportText(IMPORT_EXAMPLES.stdio)}>{copy('本地进程示例', 'Local process example')}</Button>
          <Button onClick={() => setImportText(IMPORT_EXAMPLES.http)}>{copy('远程 HTTP 示例', 'Remote HTTP example')}</Button>
          <Button onClick={() => setImportText(IMPORT_EXAMPLES.oauth)}>{copy('远程 OAuth 示例', 'Remote OAuth example')}</Button>
        </div>
        <JsonEditor locale={locale} id="connector-import-json" value={importText} onChange={setImportText} rows={10} invalid={!!importPreview.error}
          placeholder={IMPORT_EXAMPLES.stdio} />
        {notice && noticeError && <p className="point-error" role="alert">{notice}</p>}
        {importPreview.error && <p className="point-error" role="alert">{importPreview.error}</p>}
        {importPreview.draft && <div className="point-connectors-import-preview" role="status">
          <div><strong>{importPreview.draft.connectorId || copy('（需要另起连接 ID）', '(Choose a connection ID)')}</strong>
            <span className="point-connectors-pill">{importPreview.draft.definition.transport === 'stdio' ? copy('本地进程 · stdio', 'Local process · stdio') : copy('远程 MCP · HTTP', 'Remote MCP · HTTP')}</span></div>
          <div className="point-connectors-row-meta">{importPreview.draft.definition.transport === 'stdio'
            ? [importPreview.draft.definition.command, ...(importPreview.draft.definition.args ?? [])].join(' ')
            : importPreview.draft.definition.url}</div>
          {importPreview.draft.notes.length > 0 && <ul>{importPreview.draft.notes.map(note => <li key={note}>{note}</li>)}</ul>}
        </div>}
    </Dialog>}

    {detailOpen && <ConnectorDetailDialog configurationRequest={configurationRequest.connectionId === detailConnectorId ? configurationRequest.revision : 0} detail={detail} locale={locale} activity={{ busy, notice, noticeError }}
      toolSelection={toolSelection} setToolSelection={setToolSelection}
      actions={{ save, importPasted, saveSecret, deleteSecret, saveTools, perform,
        onDocs: openDocs }} />}

    {guide && <Dialog className="point-connectors-guide-dialog" title={guide.title} size="md" closeLabel={copy('关闭', 'Close')} dismissOnBackdrop onClose={() => { if (!trying) setGuideId(null); }}
      footerStart={<span className="point-connectors-hint">{copy('试用只把这句话放进输入框，不会直接发送。', 'Try it fills the composer without sending the message.')}</span>}
      footer={<><Button disabled={trying} onClick={() => setGuideId(null)}>{copy('关闭', 'Close')}</Button>
        <Button variant="primary" disabled={trying} onClick={() => void tryGuide()}>{trying ? copy('正在放入…', 'Adding…') : copy('试用', 'Try it')}</Button></>}>
      <p>{guide.lead}</p>
      <div>
        <div className="point-connectors-guide-kicker">{copy('可以做', 'What it can do')}</div>
        <ul className="point-connectors-guide-list">{guide.can.map(line => <li key={line}>{line}</li>)}</ul>
      </div>
      <div>
        <div className="point-connectors-guide-kicker">{copy('边界', 'Boundaries')}</div>
        <ul className="point-connectors-guide-list">{guide.bounds.map(line => <li key={line}>{line}</li>)}</ul>
      </div>
      <div className="point-connectors-guide-kicker">{copy('试一句', 'Try a prompt')}</div>
      <RadioGroup className="point-connectors-examples" value={exampleId} onValueChange={setExampleId} aria-label={copy('试一句', 'Try a prompt')}>
        {guide.examples.map(example => <label key={example.id} className="point-connectors-example">
          <RadioGroupItem value={example.id} />
          <span><strong>{example.label}</strong><span className="point-connectors-guide-prompt">{example.prompt}</span></span>
        </label>)}
      </RadioGroup>
      {guideError && <p className="point-error" role="alert">{guideError}</p>}
    </Dialog>}

    {removeTarget && <Dialog title={copy('删除连接器', 'Remove connector')} closeLabel={copy('关闭', 'Close')} dismissOnBackdrop size="sm" onClose={() => { if (!busy) setRemoveTarget(null); }}
      footer={<><Button disabled={!!busy} onClick={() => setRemoveTarget(null)}>{copy('取消', 'Cancel')}</Button>
        <Button variant="danger" disabled={!!busy} onClick={confirmRemove}>{busy === 'remove' ? copy('正在删除…', 'Removing…') : copy('确认删除', 'Confirm removal')}</Button></>}>
      <p>{copy('确定要删除', 'Remove')} <strong>{cardTitle(removeTarget)}</strong>{copy('吗？这将删除这个连接的配置与本机授权记录。', '? This removes its configuration and local consent records.')}</p>
    </Dialog>}
  </section></Tabs>;
}
