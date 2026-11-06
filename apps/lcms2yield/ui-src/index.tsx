import { useCallback, useEffect, useState } from 'react';
import { useAppApi, useAppContext, useAppI18n, useNavigate } from '@pero/app-sdk';
import { AppFrame, Badge, Button, Card, Dialog, EnvironmentInspector, Feedback, LoadingSkeleton, Select, SkeletonText } from '@pero/app-sdk/ui';
import { messages, type CaseState, type Reaction } from './messages';
import { showsRerun, yieldPercent } from './plot';
import { YieldPlot } from './yield-plot';
import './styles.css';

const TYPES = ['Buchwald', 'SN2', 'amide_coupling', 'Suzuki'] as const;

function tone(verdict: string) {
  if (verdict === 'PASS') return 'success' as const;
  if (verdict === 'FAIL') return 'error' as const;
  if (verdict === 'INCONCLUSIVE') return 'warning' as const;
  return 'neutral' as const;
}

export default function Lcms2Yield() {
  const api = useAppApi(), navigate = useNavigate(), { active } = useAppContext(), { t } = useAppI18n(messages);
  const [state, setState] = useState<CaseState | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null), [filter, setFilter] = useState('all');
  const [confirming, setConfirming] = useState(false);
  const [structure, setStructure] = useState<{ index: number; svg: string | null; available: boolean } | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.get<CaseState>('/api/state');
      setState(next); setError('');
      setSelected(current => current ?? next.reactions[0]?.index ?? null);
    } catch (cause) { setError(String(cause)); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  useEffect(() => {
    if (selected === null) return;
    let cancelled = false;
    void api.get<{ index: number; svg: string | null; available: boolean }>(`/api/structure?index=${selected}`)
      .then(value => { if (!cancelled) setStructure(value); })
      .catch(() => { if (!cancelled) setStructure(null); });
    return () => { cancelled = true; };
  }, [api, selected]);

  async function post(path: string, value: unknown) {
    setBusy(true); setError('');
    try { const next = await api.post<CaseState>(path, value); setState(next); setConfirming(false); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  const reaction = state?.reactions.find(item => item.index === selected) ?? null;
  const visible = (state?.reactions ?? []).filter(item => filter === 'all' || item.reactionType === filter);
  const verdictLabel = (name: 'yieldTable' | 'prediction' | 'paper', value: string) =>
    value === 'PASS' ? t('pass') : value === 'FAIL' ? t('fail') : value === 'INCONCLUSIVE' ? t('inconclusive') : t('unrun');

  return <AppFrame label={t('title')} actions={<Button disabled={loading || busy} onClick={() => void refresh()}>{t('retry')}</Button>}>
    {loading && !state ? <LoadingSkeleton label={t('loading')}><SkeletonText /></LoadingSkeleton> : null}
    {error ? <div className="yield-recovery"><Feedback kind="error" variant="block">{t('loadFailed')}</Feedback><details><summary>{t('details')}</summary><p>{error}</p></details></div> : null}
    {state ? <div className="yield-layout">
      <section className="yield-verdicts" aria-label={t('title')}>
        <Card><h2>{t('yieldTable')}</h2><Badge tone={tone(state.verdicts.yieldTable)}>{verdictLabel('yieldTable', state.verdicts.yieldTable)}</Badge>
          <p>{t('mae', { value: Number(state.yieldMaePercentagePoints).toFixed(2) })}</p>
          <p>{t('population', { count: state.population, products: state.uniqueProducts })}</p>
          {state.identity.status === 'RECORDED'
            ? <><p>{t('identityRecorded')}</p><ul className="yield-identity">{(state.identity.shared ?? []).map(item => <li key={`${item.left}/${item.right}`}>{item.left} / {item.right}: {item.shared}</li>)}</ul></>
            : <p>{state.identity.reason || t('identityUnrun')}</p>}</Card>
        <Card><h2>{t('prediction')}</h2><Badge tone={tone(state.verdicts.prediction)}>{verdictLabel('prediction', state.verdicts.prediction)}</Badge><p>{t('rerunHelp')}</p></Card>
        <Card><h2>{t('paper')}</h2><Badge tone="warning">{t('inconclusive')}</Badge><p>{state.paperReason}</p></Card>
      </section>
      <section className="yield-main">
        <div className="yield-chart-wrap">
          <h2>{t('chart')}</h2>
          <YieldPlot label={t('chart')} selected={selected} onSelect={setSelected} points={visible.map(item => ({ index: item.index, reactionType: item.reactionType, x: yieldPercent(item.yieldExp), y: yieldPercent(item.yieldPred) }))} />
          <p className="yield-help">{t('chartHelp')}</p>
          <ul className="yield-legend">{TYPES.map(type => <li key={type}><span className={`swatch swatch-${type}`} />{t(type)} · {state.typeCounts[type] ?? 0}</li>)}</ul>
        </div>
        <aside className="yield-side">
          <Select label={t('filter')} value={filter} onChange={setFilter} options={[{ value: 'all', label: t('allTypes') }, ...TYPES.map(type => ({ value: type, label: t(type) }))]} />
          <ul className="yield-rows" aria-label={t('reactions')}>{visible.map(item => <li key={item.index}><button type="button" aria-current={item.index === selected} onClick={() => setSelected(item.index)}>{item.name}</button></li>)}</ul>
          <ReactionDetail t={t} reaction={reaction} structure={structure} showRerun={showsRerun(state.verdicts.prediction)} />
        </aside>
      </section>
      <section className="yield-environment">
        <div>
          <h2>{t('environment')}</h2>
          <p className="yield-help">{t('environmentHelp')}</p>
          <EnvironmentInspector targets={['lcms2yield.inference']} />
        </div>
        <div>
          <h2>{t('release')}</h2>
          <p className="yield-help">{state.checkout ? t('releaseReady') : t('releaseMissing')}</p>
        </div>
        <div>
          <h2>{t('prediction')}</h2>
          <p className="yield-help">{t('rerunHelp')}</p>
          <Button variant="primary" disabled={busy || !state.checkout} onClick={() => setConfirming(true)}>{t('rerun')}</Button>
          {busy ? <p role="status">{t('running')}</p> : null}
        </div>
        <div>
          <h2>Compute</h2>
          <Badge>{t('notConnected')}</Badge>
          <p className="yield-help">{t('computeHelp')}</p>
        </div>
      </section>
    </div> : null}
    <footer className="yield-links"><span>{t('settings')}</span><nav>
      <Button variant="ghost" onClick={() => void navigate(state?.links.environments ?? '/apps/environments')}>{t('openEnvironments')}</Button>
      <Button variant="ghost" onClick={() => void navigate(state?.links.compute ?? '/apps/compute')}>{t('openCompute')}</Button>
      <Button variant="ghost" onClick={() => void navigate(state?.links.workers ?? '/workers')}>{t('workers')}</Button>
    </nav></footer>
    {confirming ? <Dialog title={t('confirmTitle')} closeLabel={t('cancel')} onClose={() => setConfirming(false)} footer={<><Button onClick={() => setConfirming(false)}>{t('cancel')}</Button><Button variant="primary" busy={busy} onClick={() => void post('/api/rerun', { confirm: true })}>{t('confirm')}</Button></>}><p>{t('confirmBody')}</p></Dialog> : null}
  </AppFrame>;
}

function ReactionDetail({ t, reaction, structure, showRerun }: { t: (key: string) => string; reaction: Reaction | null; structure: { index: number; svg: string | null; available: boolean } | null; showRerun: boolean }) {
  if (!reaction) return <p>{t('noSelection')}</p>;
  const percent = (value: string) => `${yieldPercent(value).toFixed(2)}%`;
  return <Card>
    <h2>{t('selected')}</h2>
    <p>{reaction.name} · {t(reaction.reactionType)}</p>
    <dl>
      <div><dt>{t('yieldExp')}</dt><dd>{percent(reaction.yieldExp)}</dd></div>
      <div><dt>{t('yieldPred')}</dt><dd>{percent(reaction.yieldPred)}</dd></div>
      <div><dt>{t('cfExp')}</dt><dd>{reaction.cfExp}</dd></div>
      <div><dt>{t('cfPred')}</dt><dd>{reaction.cfPred}</dd></div>
      {showRerun && reaction.cfRerun ? <div><dt>{t('cfRerun')}</dt><dd>{reaction.cfRerun}</dd></div> : null}
      <div><dt>{t('product')}</dt><dd className="yield-smiles">{reaction.productSmiles}</dd></div>
    </dl>
    <h3>{t('structure')}</h3>
    {structure?.index === reaction.index && structure.available && structure.svg
      ? <div className="yield-structure" dangerouslySetInnerHTML={{ __html: structure.svg }} />
      : <p className="yield-help">{t('structureMissing')}</p>}
  </Card>;
}
