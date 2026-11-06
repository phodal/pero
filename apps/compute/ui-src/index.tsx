import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppApi, useAppContext, useAppI18n, useAppObject, useNavigate } from '@pero/app-sdk';
import { AppFrame, Badge, Button, Card, EmptyIllustration, EmptyState, Feedback, ListRow, LoadingSkeleton, SkeletonText, Split, SplitPane, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import { ClusterDialog } from './cluster-dialog';
import { messages, type Cluster, type ClusterInput, type ClusterState } from './messages';
import './styles.css';

export default function Compute() {
  const api = useAppApi(), navigate = useNavigate(), { active } = useAppContext(), { t } = useAppI18n(messages);
  const [state, setState] = useState<ClusterState | null>(null), [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('jobs'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [failure, setFailure] = useState('loadFailed'), [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Cluster | null | undefined>(undefined);
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
    catch (cause) { setError(String(cause)); setFailure('navigationFailed'); }
  }
  useAppObject({ id: 'compute-workspace', kind: 'cluster-workspace', label: 'Compute',
    state: { loading, busy, clusters: state?.clusters ?? null, selectedClusterId: state?.selectedClusterId ?? null,
      jobs: null, jobsStatus: 'not_connected' } });

  return <Tabs value={tab} onValueChange={setTab} className="compute-root"><AppFrame label="Compute" tools={
    <TabsList aria-label={t('navigation')}><TabsTrigger value="jobs">{t('jobs')}</TabsTrigger><TabsTrigger value="clusters">{t('clusters')}</TabsTrigger></TabsList>
  } actions={<><Button disabled={busy || loading} onClick={() => void refresh()}>{t('refresh')}</Button>
    {tab === 'clusters' && Boolean(state?.clusters.length) ? <Button variant="primary" disabled={busy} onClick={() => edit(null)}>{t('add')}</Button> : null}</>}>
    {loading && state ? <p className="compute-status" role="status">{t('refreshing')}</p> : null}
    {notice ? <p className="compute-status" role="status">{notice}</p> : null}
    {error && editing === undefined ? <div className="compute-recovery"><Feedback kind="error" variant="block">{t(failure)} {state && failure === 'loadFailed' ? t('retained') : ''}</Feedback>
      {failure === 'loadFailed' ? <Button disabled={loading || busy} onClick={() => void refresh()}>{t('retry')}</Button> : null}
      <details className="compute-error-details"><summary>{t('details')}</summary><p>{error}</p></details></div> : null}
    {!state ? loading ? <LoadingSkeleton label={t('loading')} className="compute-loading"><SkeletonText /></LoadingSkeleton> : null : <>
      <TabsContent value="jobs" className="compute-panel">
        <EmptyState className="compute-empty" icon={<EmptyIllustration kind="compute" size="compact" />} heading={<h2>{t('jobsUnavailable')}</h2>}
          description={selected ? t('selectedJobsHelp', { name: selected.name }) : t('jobsHelp')}
          actions={<Button variant="primary" onClick={() => setTab('clusters')}>{t('manage')}</Button>} />
      </TabsContent>
      <TabsContent value="clusters" className="compute-panel">
        {!state.clusters.length ? <EmptyState className="compute-empty" icon={<EmptyIllustration kind="compute" size="compact" />} heading={<h2>{t('noClusters')}</h2>} description={t('noClustersHelp')}
          actions={<Button variant="primary" disabled={busy} onClick={() => edit(null)}>{t('add')}</Button>} />
          : <Split storageKey="pero.compute.cluster-width" collapseBelow={760} className="compute-split">
            <SplitPane id="compute-clusters" as="section" size={300} min={240} aria-label={t('clusters')} className="compute-list">
              <ul>{state.clusters.map(cluster => <li key={cluster.id}><ListRow title={cluster.name} meta={<>{cluster.host} · {t('notConnected')}</>}
                current={cluster.id === selected?.id} onOpen={() => { if (cluster.id !== selected?.id) void update('/api/selection', { clusterId: cluster.id }); }} /></li>)}</ul>
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
    <footer className="compute-settings"><span>{t('settingsHelp')}</span><nav aria-label={t('settings')}>
      <Button variant="ghost" onClick={() => void open('/workers')}>{t('workers')}</Button>
      <Button variant="ghost" onClick={() => void open('/apps/environments')}>{t('environments')}</Button>
    </nav></footer>
    {editing !== undefined ? <ClusterDialog cluster={editing} busy={busy} error={error} onClose={() => { if (!pending.current) { setEditing(undefined); setError(''); } }}
      onSave={(value: ClusterInput) => void update('/api/clusters', value, true)} /> : null}
  </AppFrame></Tabs>;
}
