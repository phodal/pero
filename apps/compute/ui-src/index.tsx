import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppApi, useAppContext, useAppI18n, useAppObject, useNavigate } from '@pero/app-sdk';
import { Disclosure, AppFrame, Badge, Button, ContentPane, ContentSection, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyIllustration, EmptyState, Feedback, Icon, IconButton, InspectorHeader, ListRow, LoadingSkeleton, MetadataList, SkeletonText, Split, SplitPane, Tabs, TabsContent, TabsList, TabsTrigger, contentLayout, type MetadataItem } from '@pero/app-sdk/ui';
import { ClusterDialog } from './cluster-dialog';
import { TaskReport } from './task-report';
import { RemoteExecution } from './remote-execution';
import { messages, type Cluster, type ClusterInput, type ClusterState, type ExecutionReceipt } from './messages';
import './styles.css';

export default function Compute() {
  const api = useAppApi(), navigate = useNavigate(), { active } = useAppContext(), { t } = useAppI18n(messages);
  const [state, setState] = useState<ClusterState | null>(null), [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('jobs'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [failure, setFailure] = useState('loadFailed'), [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Cluster | null | undefined>(undefined);
  const [opened, setOpened] = useState<string | null>(null);
  const pending = useRef(false), request = useRef(0);
  const selected = state?.clusters.find(cluster => cluster.id === state.selectedClusterId) ?? null;
  const refresh = useCallback(async () => {
    if (pending.current) return;
    const attempt = ++request.current;
    setLoading(true);
    try {
      const result = await api.get<ClusterState>('/api/state');
      if (attempt === request.current) { setState(result); setError(''); }
    } catch (cause) {
      if (attempt === request.current) { setError(String(cause)); setFailure('loadFailed'); }
    } finally { if (attempt === request.current) setLoading(false); }
  }, [api]);
  useEffect(() => { if (active) void refresh(); }, [active, refresh]);

  async function update(path: string, value: unknown, saved = false) {
    if (pending.current) return;
    pending.current = true; request.current += 1; setLoading(false); setBusy(true); setError(''); setNotice('');
    try {
      setState(await api.post<ClusterState>(path, value));
      if (saved) { setEditing(undefined); setNotice(t('saved')); }
    } catch (cause) { setError(String(cause)); setFailure('actionFailed'); }
    finally { pending.current = false; setBusy(false); }
  }
  function edit(cluster: Cluster | null) { setError(''); setNotice(''); setEditing(cluster); }
  async function open(path: string) {
    setError('');
    try { await navigate(path); }
    catch (cause) { setError(String(cause)); setFailure(path === '/apps/environments' ? 'environmentUnavailable' : 'navigationFailed'); }
  }
  const executions = state?.executions ?? [];
  const executionKey = (item: ExecutionReceipt) => item.jobId != null
    ? `${item.operation}:${item.cluster}:${item.jobId}:${item.submitTime}`
    : `${item.operation}:${item.host}:${item.started}:${item.payloadSha256}`;
  const openedExecution = executions.find(item => executionKey(item) === opened) ?? executions[0] ?? null;
  useAppObject({ id: 'compute-workspace', kind: 'cluster-workspace', label: 'Compute',
    state: { loading, busy, clusters: state?.clusters ?? null, selectedClusterId: state?.selectedClusterId ?? null,
      jobs: null, jobsStatus: 'not_connected', executionsStatus: state?.executionsStatus ?? null } });

  return <Tabs value={tab} onValueChange={setTab} className="compute-root"><AppFrame label="Compute" scope={
    <TabsList variant="navigation" aria-label={t('navigation')}><TabsTrigger value="jobs">{t('jobs')}</TabsTrigger><TabsTrigger value="reports">{t('reports')}</TabsTrigger><TabsTrigger value="clusters">{t('clusters')}</TabsTrigger><TabsTrigger value="remote">{t('remote')}</TabsTrigger></TabsList>
  } utilities={<IconButton label={t('refresh')} disabled={busy || loading} onClick={() => void refresh()}><Icon name="refresh" /></IconButton>}
    commands={<DropdownMenu>
      <DropdownMenuTrigger aria-label={t('settings')}><Icon name="dots" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void open('/workers')}>{t('workers')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void open('/apps/environments')}>{t('environments')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>}
    primary={tab === 'clusters' ? <Button variant="primary" disabled={busy} onClick={() => edit(null)}>{t('add')}</Button> : null}>
    {loading && state ? <p className="compute-status" role="status">{t('refreshing')}</p> : null}
    {busy && editing === undefined ? <p className="compute-status" role="status">{t('selecting')}</p> : null}
    {notice ? <p className="compute-status" role="status">{notice}</p> : null}
    {error && editing === undefined ? <div className="compute-recovery"><Feedback kind="error" variant="block">{t(failure)} {state && failure === 'loadFailed' ? t('retained') : ''}</Feedback>
      {failure === 'loadFailed' ? <Button disabled={loading || busy} onClick={() => void refresh()}>{t('retry')}</Button> : null}
      {failure === 'environmentUnavailable' ? <Button onClick={() => void open('/apps')}>{t('manageApps')}</Button> : null}
      <Disclosure variant="inline" className="compute-error-details" summary={<>{t('details')}</>}><p>{error}</p></Disclosure></div> : null}
    {!state ? loading ? <LoadingSkeleton label={t('loading')} className="compute-loading"><SkeletonText /></LoadingSkeleton> : null : <>
      <TabsContent value="reports" className="compute-panel"><TaskReport /></TabsContent>
      <TabsContent value="remote" className="compute-panel"><RemoteExecution active={active && tab === 'remote'} clusters={state.clusters} selectedClusterId={state.selectedClusterId} onManage={() => setTab('clusters')} /></TabsContent>
      <TabsContent value="jobs" className="compute-panel">
        {state.executionsStatus === 'unreadable' ? <div className="compute-recovery"><Feedback kind="error" variant="block">{t('executionsUnreadable')}</Feedback>
          <Button disabled={loading || busy} onClick={() => void refresh()}>{t('retry')}</Button>
          {state.executionsError ? <Disclosure variant="inline" className="compute-error-details" summary={<>{t('details')}</>}><p>{state.executionsError}</p></Disclosure> : null}</div> : null}
        {openedExecution ? <Split storageKey="pero.compute.execution-width" collapseBelow={contentLayout.collapseBelow} className="compute-split">
          <SplitPane id="compute-executions" as="section" size={contentLayout.listSize} min={contentLayout.listMin} aria-label={t('jobs')} className="compute-list">
            <ContentPane id="compute-execution-list" label={t('jobs')} as="div" surface="list" inset="compact" scroll="pane">
              <p className="compute-help compute-queue-note">{selected ? t('selectedJobsHelp', { name: selected.name }) : t('recordedHelp')}</p>
              <ul>{executions.map(item => <li key={executionKey(item)}><ListRow title={item.entry || item.operation}
                meta={item.jobId != null ? <>{item.cluster} · {t('externalJob')} {item.jobId}</> : <>{item.host}</>} time={item.submitTime} current={item === openedExecution}
                onOpen={() => setOpened(executionKey(item))} /></li>)}</ul>
            </ContentPane>
          </SplitPane>
          <SplitPane id="compute-execution" as="section" min={contentLayout.mainMin} className="compute-detail">
            <ContentPane id="compute-execution-detail" label={openedExecution.operation} as="div" surface="reading" inset="compact" scroll="pane"
              header={<InspectorHeader title={openedExecution.operation} status={<Badge>{openedExecution.scheduler ? openedExecution.scheduler.states.join(', ') : openedExecution.jobId != null ? t('submittedOnly') : processStatus(openedExecution, t)}</Badge>} />}>
              <ContentSection id="compute-execution-facts" title={t('jobs')}>
                <MetadataList items={executionFacts(openedExecution, t)} />
              </ContentSection>
              <ContentSection id="compute-reproduce" title={t('reproduce')} actions={<Button onClick={() => void navigator.clipboard.writeText(reproduceDraft(openedExecution, t)).then(() => setNotice(t('draftCopied')), () => setNotice(t('draftCopyFailed')))}>{t('reproduce')}</Button>}>
                <p className="compute-help">{t('reproduceHelp')}</p>
                <pre className="compute-draft">{reproduceDraft(openedExecution, t)}</pre>
              </ContentSection>
            </ContentPane>
          </SplitPane>
        </Split> : state.executionsStatus === 'unreadable' ? null : <EmptyState className="compute-empty" icon={<EmptyIllustration kind="compute" size="compact" />} heading={<h2>{t('jobsUnavailable')}</h2>}
          description={selected ? t('selectedJobsHelp', { name: selected.name }) : t('jobsHelp')}
          actions={<Button onClick={() => setTab('clusters')}>{t('manage')}</Button>} />}
      </TabsContent>
      <TabsContent value="clusters" className="compute-panel">
        <p className="compute-help">{t('settingsHelp')}</p>
        {!state.clusters.length ? <EmptyState className="compute-empty" icon={<EmptyIllustration kind="compute" size="compact" />} heading={<h2>{t('noClusters')}</h2>} description={t('noClustersHelp')} />
          : <Split storageKey="pero.compute.cluster-width" collapseBelow={contentLayout.collapseBelow} className="compute-split">
            <SplitPane id="compute-clusters" as="section" size={contentLayout.listSize} min={contentLayout.listMin} aria-label={t('clusters')} className="compute-list">
              <ContentPane id="compute-cluster-list" label={t('clusters')} as="div" surface="list" inset="none" scroll="pane">
                <fieldset className="compute-cluster-choices" disabled={busy} aria-label={t('clusters')}><ul>{state.clusters.map(cluster => <li key={cluster.id}><ListRow title={cluster.name} meta={<>{cluster.host} · {t('notConnected')}</>}
                  current={cluster.id === selected?.id} onOpen={() => { if (cluster.id !== selected?.id) void update('/api/selection', { clusterId: cluster.id }); }} /></li>)}</ul></fieldset>
              </ContentPane>
            </SplitPane>
            <SplitPane id="compute-cluster-detail" as="section" min={contentLayout.inspectorMin} className="compute-detail">
              {selected ? <ContentPane id="compute-cluster-inspector" label={selected.name} as="div" surface="reading" inset="compact" scroll="pane"
                header={<InspectorHeader title={selected.name} status={<Badge>{t('notConnected')}</Badge>} actions={<Button disabled={busy} onClick={() => edit(selected)}>{t('edit')}</Button>} />}>
                <ContentSection id="compute-cluster-facts" title={t('clusters')}>
                  <MetadataList items={(['host', 'account', 'partition', 'workdir'] as const).map(name => ({ id: name, label: t(name), value: selected[name] || t('notSet'), format: name === 'host' || name === 'workdir' ? 'code' as const : 'text' as const }))} />
                </ContentSection>
                <p className="compute-help">{t('draftHelp')}</p>
              </ContentPane> : null}
            </SplitPane>
          </Split>}
      </TabsContent>
    </>}
    {editing !== undefined ? <ClusterDialog cluster={editing} busy={busy} error={error} onClose={() => { if (!pending.current) { setEditing(undefined); setError(''); } }}
      onSave={(value: ClusterInput) => void update('/api/clusters', value, true)} /> : null}
  </AppFrame></Tabs>;
}

function executionFacts(item: ExecutionReceipt, t: (key: string, values?: Record<string, string | number>) => string): MetadataItem[] {
  const facts: MetadataItem[] = [];
  if (item.jobId != null) facts.push({ id: 'job', label: t('externalJob'), value: item.jobId, format: 'code' });
  if (item.cluster) facts.push({ id: 'cluster', label: t('receiptCluster'), value: item.cluster });
  if (item.host) facts.push({ id: 'host', label: t('processHost'), value: item.host, format: 'code' });
  facts.push({ id: 'payload', label: t('payload'), value: item.payloadSha256, format: 'code' });
  if (item.constraints) facts.push({ id: 'requested', label: t('requested'), value: t('requestedValue', { partition: item.constraints.partition, cpus: item.constraints.cpus, memory: item.constraints.memoryMib, wall: item.constraints.walltimeSeconds }) });
  if (item.entry) facts.push({ id: 'entry', label: t('entryLabel'), value: item.entry, format: 'code' });
  if (item.snapshotSha256) facts.push({ id: 'snapshot', label: t('snapshot'), value: item.snapshotSha256, format: 'code' });
  if (item.scheduler?.nodes) facts.push({ id: 'nodes', label: t('recordedNodes'), value: item.scheduler.nodes });
  if (item.scheduler?.startTime != null) facts.push({ id: 'start', label: t('recordedStart'), value: item.scheduler.startTime });
  if (item.scheduler?.endTime != null) facts.push({ id: 'end', label: t('recordedEnd'), value: item.scheduler.endTime });
  if (item.scheduler?.wallSeconds != null) facts.push({ id: 'span', label: t('recordedSpan'), value: t('recordedSeconds', { seconds: item.scheduler.wallSeconds }) });
  if (item.exitCode != null) facts.push({ id: 'exit', label: t('processExit'), value: item.exitCode });
  if (item.wallMilliseconds != null) facts.push({ id: 'wall', label: t('recordedSpan'), value: item.wallMilliseconds });
  if (item.logs.length) facts.push({ id: 'logs', label: t('logsLabel'), value: item.logs.join(', '), format: 'code' });
  if (item.outputs.length) facts.push({ id: 'outputs', label: t('outputsLabel'), value: item.outputs.map(output => output.path).join(', '), format: 'code' });
  return facts;
}

function processStatus(item: ExecutionReceipt, t: (key: string, values?: Record<string, string | number>) => string) {
  if (item.unconfirmed) return t('processUnconfirmed');
  if (item.exitCode != null) return t('processExitValue', { code: item.exitCode });
  return t('processOpen');
}

function reproduceDraft(item: ExecutionReceipt, t: (key: string, values?: Record<string, string | number>) => string) {
  const lines = [t('reproduceHelp')];
  if (item.jobId != null && item.constraints && item.cluster) {
    lines.push(t('keepJob', { jobId: item.jobId }), `${t('operation')}: ${item.operation}`,
      `${t('receiptCluster')}: ${item.cluster}`, `${t('externalJob')}: ${item.jobId}`, `${t('payload')}: ${item.payloadSha256}`,
      `${t('requested')}: ${t('requestedValue', { partition: item.constraints.partition, cpus: item.constraints.cpus, memory: item.constraints.memoryMib, wall: item.constraints.walltimeSeconds })}`);
  } else {
    lines.push(t('noExternalJob'), `${t('operation')}: ${item.operation}`, `${t('processHost')}: ${item.host ?? ''}`, `${t('payload')}: ${item.payloadSha256}`, t('processFact'));
    if (item.unconfirmed) lines.push(t('processUnconfirmed'));
    else if (item.exitCode != null) lines.push(`${t('processExit')}: ${item.exitCode}`);
    else lines.push(t('processOpen'));
  }
  if (item.entry) lines.push(`${t('entryLabel')}: ${item.entry}`);
  if (item.snapshotSha256) lines.push(`${t('snapshot')}: ${item.snapshotSha256}`);
  if (item.scheduler) {
    lines.push(`${t('scheduler')}: ${item.scheduler.states.join(', ')}`);
    if (item.scheduler.nodes) lines.push(`${t('recordedNodes')}: ${item.scheduler.nodes}`);
    if (item.scheduler.wallSeconds != null) lines.push(`${t('recordedSpan')}: ${t('recordedSeconds', { seconds: item.scheduler.wallSeconds })}`);
  } else if (item.jobId != null) lines.push(t('noScheduler'));
  if (item.logs.length) lines.push(`${t('logsLabel')}: ${item.logs.join(', ')}`);
  if (item.outputs.length) lines.push(`${t('outputsLabel')}: ${item.outputs.map(output => `${output.path} ${output.sha256}`).join(', ')}`);
  return lines.join('\n');
}
