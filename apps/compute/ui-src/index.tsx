import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppApi, useAppContext, useAppI18n, useAppObject, useNavigate } from '@pero/app-sdk';
import { Disclosure, AppFrame, Badge, Button, Card, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyIllustration, EmptyState, Feedback, Icon, IconButton, ListRow, LoadingSkeleton, SkeletonText, Split, SplitPane, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import { ClusterDialog } from './cluster-dialog';
import { TaskReport } from './task-report';
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
    <TabsList aria-label={t('navigation')}><TabsTrigger value="jobs">{t('jobs')}</TabsTrigger><TabsTrigger value="reports">{t('reports')}</TabsTrigger><TabsTrigger value="clusters">{t('clusters')}</TabsTrigger></TabsList>
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
      <TabsContent value="jobs" className="compute-panel">
        {state.executionsStatus === 'unreadable' ? <div className="compute-recovery"><Feedback kind="error" variant="block">{t('executionsUnreadable')}</Feedback>
          <Button disabled={loading || busy} onClick={() => void refresh()}>{t('retry')}</Button>
          {state.executionsError ? <Disclosure variant="inline" className="compute-error-details" summary={<>{t('details')}</>}><p>{state.executionsError}</p></Disclosure> : null}</div> : null}
        {openedExecution ? <Split storageKey="pero.compute.execution-width" collapseBelow={760} className="compute-split">
          <SplitPane id="compute-executions" as="section" size={320} min={240} aria-label={t('jobs')} className="compute-list">
            <p className="compute-help compute-queue-note">{selected ? t('selectedJobsHelp', { name: selected.name }) : t('recordedHelp')}</p>
            <ul>{executions.map(item => <li key={executionKey(item)}><ListRow title={item.entry || item.operation}
              meta={item.jobId != null ? <>{item.cluster} · {t('externalJob')} {item.jobId}</> : <>{item.host}</>} time={item.submitTime} current={item === openedExecution}
              onOpen={() => setOpened(executionKey(item))} /></li>)}</ul>
          </SplitPane>
          <SplitPane id="compute-execution" as="section" min={320} className="compute-detail">
            <Card tone="blue" variant="soft"><header className="compute-detail-header"><h2>{openedExecution.operation}</h2>
              <Badge>{openedExecution.scheduler ? openedExecution.scheduler.states.join(', ') : openedExecution.jobId != null ? t('submittedOnly') : processStatus(openedExecution, t)}</Badge></header>
              <dl className="compute-facts">
                {openedExecution.jobId != null ? <div><dt>{t('externalJob')}</dt><dd>{openedExecution.jobId}</dd></div> : null}
                {openedExecution.cluster ? <div><dt>{t('receiptCluster')}</dt><dd>{openedExecution.cluster}</dd></div> : null}
                {openedExecution.host ? <div><dt>{t('processHost')}</dt><dd>{openedExecution.host}</dd></div> : null}
                <div><dt>{t('payload')}</dt><dd>{openedExecution.payloadSha256}</dd></div>
                {openedExecution.constraints ? <div><dt>{t('requested')}</dt><dd>{t('requestedValue', { partition: openedExecution.constraints.partition, cpus: openedExecution.constraints.cpus, memory: openedExecution.constraints.memoryMib, wall: openedExecution.constraints.walltimeSeconds })}</dd></div> : null}
                {openedExecution.entry ? <div><dt>{t('entryLabel')}</dt><dd>{openedExecution.entry}</dd></div> : null}
                {openedExecution.snapshotSha256 ? <div><dt>{t('snapshot')}</dt><dd>{openedExecution.snapshotSha256}</dd></div> : null}
                {openedExecution.scheduler?.nodes ? <div><dt>{t('recordedNodes')}</dt><dd>{openedExecution.scheduler.nodes}</dd></div> : null}
                {openedExecution.scheduler?.startTime != null ? <div><dt>{t('recordedStart')}</dt><dd>{openedExecution.scheduler.startTime}</dd></div> : null}
                {openedExecution.scheduler?.endTime != null ? <div><dt>{t('recordedEnd')}</dt><dd>{openedExecution.scheduler.endTime}</dd></div> : null}
                {openedExecution.scheduler?.wallSeconds != null ? <div><dt>{t('recordedSpan')}</dt><dd>{t('recordedSeconds', { seconds: openedExecution.scheduler.wallSeconds })}</dd></div> : null}
                {openedExecution.exitCode != null ? <div><dt>{t('processExit')}</dt><dd>{openedExecution.exitCode}</dd></div> : null}
                {openedExecution.wallMilliseconds != null ? <div><dt>{t('recordedSpan')}</dt><dd>{openedExecution.wallMilliseconds}</dd></div> : null}
                {openedExecution.logs.length ? <div><dt>{t('logsLabel')}</dt><dd>{openedExecution.logs.join(', ')}</dd></div> : null}
                {openedExecution.outputs.length ? <div><dt>{t('outputsLabel')}</dt><dd>{openedExecution.outputs.map(item => item.path).join(', ')}</dd></div> : null}
              </dl>
              <h3 className="compute-draft-title">{t('reproduce')}</h3>
              <p className="compute-help">{t('reproduceHelp')}</p>
              <pre className="compute-draft">{reproduceDraft(openedExecution, t)}</pre>
              <Button onClick={() => void navigator.clipboard.writeText(reproduceDraft(openedExecution, t)).then(() => setNotice(t('draftCopied')), () => setNotice(t('draftCopyFailed')))}>{t('reproduce')}</Button>
            </Card>
          </SplitPane>
        </Split> : state.executionsStatus === 'unreadable' ? null : <EmptyState className="compute-empty" icon={<EmptyIllustration kind="compute" size="compact" />} heading={<h2>{t('jobsUnavailable')}</h2>}
          description={selected ? t('selectedJobsHelp', { name: selected.name }) : t('jobsHelp')}
          actions={<Button variant="primary" onClick={() => setTab('clusters')}>{t('manage')}</Button>} />}
      </TabsContent>
      <TabsContent value="clusters" className="compute-panel">
        <p className="compute-help">{t('settingsHelp')}</p>
        {!state.clusters.length ? <EmptyState className="compute-empty" icon={<EmptyIllustration kind="compute" size="compact" />} heading={<h2>{t('noClusters')}</h2>} description={t('noClustersHelp')} />
          : <Split storageKey="pero.compute.cluster-width" collapseBelow={760} className="compute-split">
            <SplitPane id="compute-clusters" as="section" size={300} min={240} aria-label={t('clusters')} className="compute-list">
              <fieldset className="compute-cluster-choices" disabled={busy} aria-label={t('clusters')}><ul>{state.clusters.map(cluster => <li key={cluster.id}><ListRow title={cluster.name} meta={<>{cluster.host} · {t('notConnected')}</>}
                current={cluster.id === selected?.id} onOpen={() => { if (cluster.id !== selected?.id) void update('/api/selection', { clusterId: cluster.id }); }} /></li>)}</ul></fieldset>
            </SplitPane>
            <SplitPane id="compute-cluster-detail" as="section" min={320} className="compute-detail">
              {selected ? <Card tone="blue" variant="soft"><header className="compute-detail-header"><h2>{selected.name}</h2><Badge>{t('notConnected')}</Badge>
                <Button disabled={busy} onClick={() => edit(selected)}>{t('edit')}</Button></header>
                <dl className="compute-facts">{(['host', 'account', 'partition', 'workdir'] as const).map(name => <div key={name}><dt>{t(name)}</dt><dd>{selected[name] || t('notSet')}</dd></div>)}</dl>
                <p className="compute-help">{t('draftHelp')}</p></Card> : null}
            </SplitPane>
          </Split>}
      </TabsContent>
    </>}
    {editing !== undefined ? <ClusterDialog cluster={editing} busy={busy} error={error} onClose={() => { if (!pending.current) { setEditing(undefined); setError(''); } }}
      onSave={(value: ClusterInput) => void update('/api/clusters', value, true)} /> : null}
  </AppFrame></Tabs>;
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
