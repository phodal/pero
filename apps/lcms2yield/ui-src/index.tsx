import { useCallback, useEffect, useState } from 'react';
import { useAppApi, useAppContext, useAppI18n, useNavigate } from '@pero/app-sdk';
import { AppFrame, Badge, Button, Card, Dialog, EnvironmentInspector, Feedback, FilePicker, Select, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import { seriesStyle } from '@pero/app-sdk/chart';
import { messages, type CaseState, type Reaction } from './messages';
import { detectColumns, readCsv, yieldPercent, uploadSmiles, matchingPredictions } from './plot';
import { YieldPlot } from './yield-plot';
import structures from './examples/structures.json';
import './styles.css';

const TYPES = ['Buchwald', 'SN2', 'amide_coupling', 'Suzuki'] as const;
const SHOWCASE_IDS = ['buchwald', 'sn2', 'suzuki', 'amide'] as const;
type Dataset = 'readme' | 'reactions' | 'upload' | (typeof SHOWCASE_IDS)[number];
type Task = 'predict' | 'train';
type Upload = { name: string; columns: string[]; count: number; smiles: string; yieldExp: string; yieldPred: string; nameColumn: string; smilesValues: string[] };

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
  const [selected, setSelected] = useState<number | null>(null);
  const [dataset, setDataset] = useState<Dataset>('reactions');
  const [task, setTask] = useState<Task>('predict');
  const [upload, setUpload] = useState<Upload | null>(null);
  const [exampleId, setExampleId] = useState('readme-1');
  const [panel, setPanel] = useState<'results' | 'log'>('results');
  const [confirming, setConfirming] = useState(false);
  const [structure, setStructure] = useState<{ svg: string | null; available: boolean } | null>(null);
  const showTable = task === 'predict' && dataset !== 'readme' && dataset !== 'upload';
  const scopedType = dataset === 'buchwald' ? 'Buchwald' : dataset === 'sn2' ? 'SN2' : dataset === 'amide' ? 'amide_coupling' : dataset === 'suzuki' ? 'Suzuki' : 'all';
  const visible = (state?.reactions ?? []).filter(item => scopedType === 'all' || item.reactionType === scopedType);
  const reaction = visible.find(item => item.index === selected) ?? visible[0] ?? null;
  const uploadPredictions = matchingPredictions(upload?.smilesValues, state?.custom?.predictions);
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
    if (dataset === 'upload') { setStructure(null); return; }
    const query = showTable ? `index=${reaction?.index}` : `example=${dataset === 'readme' ? exampleId : dataset}`;
    if (dataset === 'reactions' && !reaction) return;
    let cancelled = false;
    void api.get<{ index?: number; example?: string; svg: string | null; available: boolean }>(`/api/structure?${query}`)
      .then(value => { if (!cancelled) setStructure(value); })
      .catch(() => { if (!cancelled) setStructure(null); });
    return () => { cancelled = true; };
  }, [api, dataset, exampleId, reaction?.index]);

  async function post(path: string, value: unknown) {
    setBusy(true); setError('');
    try { const next = await api.post<CaseState>(path, value); setState(next); setConfirming(false); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  const verdictLabel = (value: string) =>
    value === 'PASS' ? t('matchesFactors') : value === 'FAIL' ? t('fail') : value === 'INCONCLUSIVE' ? t('inconclusive') : t('unrun');

  return <AppFrame label={t('title')} primary={state ? <Button className="yield-run" variant="primary" disabled={busy || task === 'train' || !state.checkout || (dataset === 'upload' && !upload?.smilesValues.length)} onClick={() => setConfirming(true)}>{task === 'train' ? t('runTrain') : t('runPrediction')}</Button> : undefined}>
    {!state ? <div className="yield-opening" role="status" aria-busy={loading || !error}>
      <div className="yield-opening-card">
        {error && !loading ? <>
          <h2>{t('loadFailed')}</h2>
          <p>{t('operationFailed')}</p>
          <Button onClick={() => void refresh()}>{t('retry')}</Button>
          <details><summary>{t('details')}</summary><p>{error}</p></details>
        </> : <>
          <span className="yield-spinner" aria-hidden="true" />
          <p className="yield-opening-lead">{t('loading')}</p>
        </>}
      </div>
    </div> : null}
    {state && error ? <div className="yield-recovery"><Feedback kind="error" variant="block">{t('operationFailed')}</Feedback><Button onClick={() => void refresh()}>{t('retry')}</Button><details><summary>{t('details')}</summary><p>{error}</p></details></div> : null}
    {state ? <div className="yield-shell">
      <aside className="yield-input">
        <Select label={t('task')} value={task} onChange={value => setTask(value as Task)} options={[{ value: 'predict', label: t('taskPredict') }, { value: 'train', label: t('taskTrain') }]} />
        <Select label={t('dataset')} value={dataset} onChange={value => setDataset(value as Dataset)} options={[
          { value: 'reactions', label: t('datasetAll', { count: state.population }) },
          { value: 'buchwald', label: `${t('Buchwald')} · ${state.typeCounts.Buchwald ?? 0}` },
          { value: 'sn2', label: `${t('SN2')} · ${state.typeCounts.SN2 ?? 0}` },
          { value: 'amide', label: `${t('amide_coupling')} · ${state.typeCounts.amide_coupling ?? 0}` },
          { value: 'suzuki', label: `${t('Suzuki')} · ${state.typeCounts.Suzuki ?? 0}` },
          { value: 'readme', label: t('officialExample') },
          ...(upload ? [{ value: 'upload', label: upload.name }] : []),
        ]} />
        <FilePicker label={t('upload')} emptyLabel={t('noFile')} accept=".csv,text/csv" disabled={busy} onFile={file => {
          void file.text().then(text => {
            const table = readCsv(text);
            const mapping = detectColumns(table.columns);
            const smilesValues = uploadSmiles(table, mapping.smiles);
            setUpload({
              name: file.name,
              columns: table.columns,
              count: table.rows.length,
              smilesValues,
              smiles: mapping.smiles,
              yieldExp: mapping.yieldExp,
              yieldPred: mapping.yieldPred,
              nameColumn: mapping.name,
            });
            setDataset('upload'); setError('');
          }).catch(cause => setError(String(cause)));
        }} />
        <p className="yield-help">{upload ? (upload.smiles || upload.yieldExp ? t('mappingReady', { smiles: upload.smiles || '—', yields: [upload.yieldExp, upload.yieldPred].filter(Boolean).join(', ') || '—' }) : t('mappingNeeded')) : t('detectedPredict')}</p>
        <details className="yield-advanced"><summary>{t('advanced')}</summary><p className="yield-help">{t('advancedBody')} {t('uploadHint')}</p></details>
        {busy ? <p role="status">{t('running')}</p> : null}
        {!state.checkout ? <p className="yield-help">{t('releaseMissing')}</p> : null}
        <nav className="yield-links">
          <Badge>{t('notConnected')}</Badge>
          <Button variant="ghost" onClick={() => void navigate(state.links.environments)}>{t('openEnvironments')}</Button>
          <Button variant="ghost" onClick={() => void navigate(state.links.compute)}>{t('openCompute')}</Button>
          <Button variant="ghost" onClick={() => void navigate(state.links.workers)}>{t('workers')}</Button>
        </nav>
      </aside>
      <Tabs className="yield-tabs" value={panel} onValueChange={value => setPanel(value as 'results' | 'log')}>
        <TabsList variant="content" aria-label={t('results')}>
          <TabsTrigger value="results">{t('results')}</TabsTrigger>
          <TabsTrigger value="log">{t('log')}</TabsTrigger>
        </TabsList>
        <TabsContent value="log" className="yield-panel">
          <p className="yield-help">{state.examples.status === 'UNRUN' ? t('outputEmpty') : `${t('officialExample')}: ${verdictLabel(state.examples.status)}`}</p>
          <IdentityNote t={t} identity={state.identity} />
          <div className="yield-block"><h2>{t('environment')}</h2><EnvironmentInspector targets={['lcms2yield.inference']} /></div>
          <p className="yield-help">{t('computeHelp')}</p>
        </TabsContent>
        <TabsContent value="results" className="yield-panel">
          {task === 'train' ? <p className="yield-help">{t('detectedTrain')}</p> : <>
            {showTable ? <section className="yield-facts" aria-label={t('yieldTable')}>
              <ul>
                <li><Badge tone={tone(state.verdicts.yieldTable)}>{state.verdicts.yieldTable === 'PASS' ? t('pass') : t('fail')}</Badge><span>{t('mae', { value: Number(state.yieldMaePercentagePoints).toFixed(2) })}</span><span>{t('population', { count: state.population, products: state.uniqueProducts })}</span></li>
                <li><Badge tone={tone(scopedType === 'all' ? state.verdicts.prediction : state.predictionByType[scopedType])}>{verdictLabel(scopedType === 'all' ? state.verdicts.prediction : state.predictionByType[scopedType])}</Badge><span>{t('prediction')}</span></li>
                <li><Badge tone="warning">{t('inconclusive')}</Badge><span>{t('paper')}</span></li>
              </ul>
              <p>{t('paperBody')}</p>
            </section> : null}
            <section className="yield-main">
              {dataset === 'upload' ? <Card className="yield-detail"><h2>{upload?.name ?? t('upload')}</h2><p role="status">{uploadPredictions.length ? '' : t('unrun')}</p><ul className="yield-rows">{uploadPredictions.map(item => <li key={item.smiles}>{item.smiles} · {item.predicted}</li>)}</ul></Card> : <>
                {showTable ? <div className="yield-chart-wrap">
                  <div className="yield-plot-frame"><YieldPlot label={t('chart')} selected={reaction?.index ?? null} onSelect={index => { setSelected(index); }} points={visible.map(item => ({ index: item.index, reactionType: item.reactionType, x: yieldPercent(item.yieldExp), y: yieldPercent(item.yieldPred) }))} /></div>
                  <p className="yield-axis">{t('axisExp')} · {t('axisPred')}</p>
                  <p className="yield-help">{t('chartHelp')}</p>
                  <ul className="yield-legend">{TYPES.map((type, index) => <li key={type}><span className="swatch" style={{ background: seriesStyle(index).stroke }} />{t(type)} · {state.typeCounts[type] ?? 0}</li>)}</ul>
                  <dl className="yield-metrics"><div><dt>{t('r2')}</dt><dd>{Number(state.fit.r2).toFixed(3)}</dd></div><div><dt>{t('rmse')}</dt><dd>{Number(state.fit.rmse).toFixed(2)}</dd></div><div><dt>{t('pearson')}</dt><dd>{Number(state.fit.pearson).toFixed(3)}</dd></div></dl>
                </div> : null}
                <Card className="yield-detail">
                  <ul className="yield-rows" aria-label={t('reactions')}>{visible.slice(0, 8).map(item => <li key={item.index}><button type="button" aria-current={item.index === reaction?.index} onClick={() => { setSelected(item.index); }}><span className="swatch" style={{ background: seriesStyle(TYPES.indexOf(item.reactionType)).stroke }} />{item.name}</button></li>)}</ul>
                  <h2>{dataset === 'reactions' || showTable ? t('selected') : t('exampleOutput')}</h2>
                  {dataset === 'reactions' || showTable ? <ReactionInput t={t} reaction={reaction} structure={structure} drawing={drawingFor(reaction?.productSmiles)} /> : <ExampleOutput t={t} item={activeExample(state, dataset, exampleId)} structure={structure} drawing={structures[(dataset === 'readme' ? exampleId : dataset) as keyof typeof structures]} />}
                </Card>
              </>}
            </section>
          </>}
        </TabsContent>
      </Tabs>
    </div> : null}
    {confirming ? <Dialog title={t('confirmTitle')} closeLabel={t('cancel')} onClose={() => setConfirming(false)} footer={<><Button onClick={() => setConfirming(false)}>{t('cancel')}</Button><Button variant="primary" busy={busy} onClick={() => void post(dataset === 'upload' ? '/api/predict' : dataset === 'readme' ? '/api/examples' : '/api/rerun', dataset === 'upload' ? { confirm: true, smiles: upload?.smilesValues ?? [] } : dataset === 'readme' ? { confirm: true, set: 'readme' } : { confirm: true, reactionType: scopedType })}>{t('confirm')}</Button></>}><p>{t('confirmBody')}</p></Dialog> : null}
  </AppFrame>;
}

function drawingFor(smiles?: string) {
  if (!smiles) return undefined;
  const hit = (['buchwald', 'sn2', 'suzuki', 'amide', 'readme-1', 'readme-2'] as const).find(id => structures[id] && smilesOf(id) === smiles);
  return hit ? structures[hit] : undefined;
}

function smilesOf(id: string) {
  return id === 'buchwald' ? 'CC(=O)Nc1cccc(F)c1'
    : id === 'sn2' ? 'O=C(O)c1cn(Cc2ccc(F)cc2)c2ccccc12'
    : id === 'suzuki' ? 'O=Cc1ccc(-c2ccncc2)cc1'
    : id === 'amide' ? 'O=C1CCN(C(=O)c2ccccc2)CC1'
    : id === 'readme-1' ? 'CN(N=C1)C=C1CC2(CC(F)(F)C2)NC(CC3=CC(C=C(Br)C=N4)=C4C=C3)C5=C(O)C=CC=N5'
    : 'Nc1[nH]c(=O)nc[c:1]1[N:1]1CSC[C@H]1C(=O)O';
}

function activeExample(state: CaseState, dataset: Dataset, exampleId: string) {
  if (dataset === 'readme') return state.examples.items.find(item => item.id === exampleId) ?? null;
  if (dataset === 'reactions') return null;
  return state.showcase.items.find(item => item.id === dataset) ?? null;
}
function ExampleOutput({ t, item, structure, drawing }: { t: (key: string, values?: Record<string, string | number>) => string; item: CaseState['examples']['items'][number] | null; structure: { svg: string | null; available: boolean } | null; drawing?: string }) {
  if (!item) return <p className="yield-help">{t('noSelection')}</p>;
  const svg = drawing || (structure?.available ? structure.svg : null);
  return <div className="yield-detail">
    <p className="yield-smiles">{item.smiles}</p>
    <dl>
      <div><dt>{t('publishedCf')}</dt><dd>{item.published}</dd></div>
      <div><dt>{t('cfRerun')}</dt><dd>{item.predicted ?? '—'}</dd></div>
    </dl>
    <h3>{t('structure')}</h3>
    {svg ? <div className="yield-structure" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="yield-help">{t('structureMissing')}</p>}
    <p className="yield-help">{t('outputLimit')}</p>
  </div>;
}

function ReactionInput({ t, reaction, structure, drawing }: { t: (key: string, values?: Record<string, string | number>) => string; reaction: Reaction | null; structure: { svg: string | null; available: boolean } | null; drawing?: string }) {
  if (!reaction) return <p className="yield-help">{t('noSelection')}</p>;
  const svg = drawing || (structure?.available ? structure.svg : null);
  return <div className="yield-detail">
    <p>{reaction.name} · {t(reaction.reactionType)}</p>
    <dl>
      <div className="yield-smiles"><dt>{t('product')}</dt><dd>{reaction.productSmiles}</dd></div>
      <div><dt>{t('yieldExp')}</dt><dd>{percent(reaction.yieldExp)}</dd></div>
      <div><dt>{t('cfExp')}</dt><dd>{reaction.cfExp}</dd></div>
      {reaction.cfRerun !== null ? <div><dt>{t('cfRerun')}</dt><dd>{reaction.cfRerun}</dd></div> : null}
    </dl>
    <h3>{t('structure')}</h3>
    {svg ? <div className="yield-structure" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="yield-help">{t('structureMissing')}</p>}
  </div>;
}

function percent(value: string) {
  return `${yieldPercent(value).toFixed(2)}%`;
}

const TRAINING = new Set(['pretrain', 'fine_tuning']);

function IdentityNote({ t, identity }: { t: (key: string, values?: Record<string, string | number>) => string; identity: CaseState['identity'] }) {
  if (identity.status !== 'RECORDED') return <p className="yield-help">{identity.reason || t('identityUnrun')}</p>;
  const shared = identity.shared ?? [];
  const train = shared.find(item => item.left === 'pretrain' && item.right === 'fine_tuning');
  const leaks = shared.filter(item => TRAINING.has(item.left) && !TRAINING.has(item.right) && item.shared > 0);
  const amongEval = shared.filter(item => !TRAINING.has(item.left) && item.shared > 0);
  const label = (name: string) => t(name);
  return <section className="yield-identity-note">
    <p>{t('identityTrain', { count: train?.shared ?? 0 })} {leaks.length === 0 ? t('identityClean') : leaks.map(item => t('identityPair', { left: label(item.left), right: label(item.right), count: item.shared })).join(' ')}</p>
    {amongEval.map(item => <p key={`${item.left}/${item.right}`}>{t('identityPair', { left: label(item.left), right: label(item.right), count: item.shared })}</p>)}
    <details>
      <summary>{t('identityAll')}</summary>
      <ul className="yield-identity">{shared.map(item => <li key={`${item.left}/${item.right}`}>{label(item.left)} / {label(item.right)}: {item.shared}</li>)}</ul>
    </details>
  </section>;
}
