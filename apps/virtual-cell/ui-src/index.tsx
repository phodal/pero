import React, { useState } from 'react';
import { appObjectProps, downloadFile, useAppI18n, useAppObject, useAppChat, useAppDataChanged, useTheme } from '@pero/app-sdk';
import { AppBar, Button, ContentPane, ContentSection, FilePicker, Disclosure, EmptyState, Feedback, Icon, IconButton, MetadataList, Select, Tabs, TabsContent, TabsList, TabsTrigger, Toolbar } from '@pero/app-sdk/ui';
import { Results } from './components';
import { messages } from './messages';
import { useWorkbench } from './use-workbench';
import { useComparison, useDatasetDownload } from './use-comparison';
import { comparisonActive } from './comparison';
import { parseDisplay, type Atlas, type Mechanism, type Volume } from './science';
import { mechanismExample, volumeExample } from './demo';
import pbmc from './pbmc-atlas.json';
import { CellView } from './views/cells';
import { PerturbationView } from './views/perturbations';
import { ComparisonView } from './views/comparison';
import { MechanismView } from './views/mechanism';
import { VolumeView } from './views/volume';
import css from './styles.css';
import { legacyThemeStyle } from './theme';

export default function VirtualCell() {
  const theme = useTheme();
  const { t } = useAppI18n(messages), lab = useWorkbench(t);
  const [view, setView] = useState('cells'), [mode, setMode] = useState('atlas'), [displayError, setDisplayError] = useState('');
  const isComparison = view === 'cells' && mode === 'comparison', comparison = useComparison(isComparison, t);
  const download = useDatasetDownload(isComparison, t);
  const [epochs, setEpochs] = useState({ cells: 0, mechanism: 0, volume: 0 });
  const [volumeIsExample, setVolumeIsExample] = useState(true);
  const [atlas, setAtlas] = useState<Atlas>(() => parseDisplay(pbmc) as Atlas), [mechanism, setMechanism] = useState<Mechanism>(mechanismExample), [volume, setVolume] = useState<Volume>(() => volumeExample());
  const current = view === 'cells' ? atlas : view === 'mechanism' ? mechanism : volume;
  const comparisonRecord = comparison.run ?? comparison.items.find(run => run.id === comparison.selected);
  const comparisonSource = comparison.selected
    ? comparison.input?.value.dataset.source.id ?? lab.items.find(input => input.id === comparisonRecord?.inputId)?.source.id ?? null
    : lab.input?.source.id ?? null;
  async function importFiles(files: File[]) {
    setDisplayError('');
    try {
      if (files.reduce((n, f) => n + f.size, 0) > 16 * 1024 * 1024) throw new Error(t('fileLimit'));
      if (files.length === 1) {
        const document = JSON.parse(await files[0].text());
        if (['point.virtual-cell.atlas.v1', 'point.virtual-cell.mechanism.v1', 'point.virtual-cell.volume.v1'].includes(document.schema)) {
          const parsed = parseDisplay(document);
          const slot = parsed.schema === 'point.virtual-cell.atlas.v1' ? 'cells' : parsed.schema === 'point.virtual-cell.mechanism.v1' ? 'mechanism' : 'volume';
          setEpochs(prev => ({ ...prev, [slot]: prev[slot] + 1 }));
          if (parsed.schema === 'point.virtual-cell.atlas.v1') { setAtlas(parsed); setView('cells'); setMode('atlas'); }
          if (parsed.schema === 'point.virtual-cell.mechanism.v1') { setMechanism(parsed); setView('mechanism'); }
          if (parsed.schema === 'point.virtual-cell.volume.v1') { setVolume(parsed); setVolumeIsExample(false); setView('volume'); }
          return;
        }
      }
      await lab.importFiles(files); setView('cells'); setMode(mode === 'comparison' ? 'comparison' : 'perturbation');
    } catch (e: any) { setDisplayError(e.message || String(e)); }
  }
  const chat=useAppChat();
  useAppDataChanged(()=>{ void lab.refresh(); comparison.refresh(); download.refresh(); });
  useAppObject({ id: 'virtual-cell', kind: 'perturbation-workbench', label: 'Virtual Cell', state: {
    view, mode, displaySource: isComparison ? comparisonSource : view === 'cells' && mode === 'perturbation' ? lab.input?.source.id ?? null : current.source.id,
    status: isComparison ? comparison.error ? 'error' : comparisonRecord?.status ?? 'ready' : lab.busy ? 'running' : lab.error || displayError ? 'error' : lab.output ? 'done' : 'ready',
    inputId: isComparison ? comparison.selected ? comparisonRecord?.inputId ?? null : lab.input?.id ?? null : lab.input?.id ?? null,
    artifactId: isComparison ? comparisonRecord?.outputId ?? null : lab.output?.id ?? null, operation: isComparison ? 'compare' : lab.output?.operation ?? null,
    comparisonRunId: isComparison ? comparison.selected || null : null,
    rawDataset: isComparison && download.dataset ? { status: download.dataset.status, receivedBytes: download.dataset.receivedBytes, verifiedBytes: download.dataset.verifiedBytes, prepared: download.dataset.prepared, path: download.dataset.status === 'ready' ? download.dataset.path : null } : null,
    isolation: 'unverified', acceptance: 'not_reviewed',
  }, actions: { select_view: {
    description: 'Select an existing science view',
    parameters: { type: 'object', properties: { view: { type: 'string', enum: ['cells', 'mechanism', 'volume'] } }, required: ['view'], additionalProperties: false },
    run: ({ view }) => { setView(view as 'cells' | 'mechanism' | 'volume'); },
  }, import_file:{
    description:'Import a selected perturbation input document from the conversation into the App',
    parameters:{type:'object',properties:{file:{type:'string',format:'pero-file-ref'}},required:['file'],additionalProperties:false},
    run:async({file})=>{const response=await fetch(file as string);if(!response.ok)throw new Error('The App input grant expired');const content=await response.text();const revision=await lab.importDocuments([content]);setView('cells');setMode('perturbation');return {inputId:revision.id};},
  } } });
  const identity = (document: { source: { id: string; revision: string } }, slot: keyof typeof epochs) => `${document.source.id}:${document.source.revision}:${epochs[slot]}`;
  return <section className="virtual-cell" style={legacyThemeStyle(theme.mode === 'dark')} {...appObjectProps('virtual-cell')} aria-label="Virtual Cell" aria-busy={lab.busy || (isComparison && !!comparison.run && comparisonActive(comparison.run.status))}><style>{css}</style>
    {(lab.error || displayError) && <Feedback kind="error">{lab.error || displayError} <Button disabled={lab.busy} onClick={() => { setDisplayError(''); void lab.refresh(); }}>{t('retry')}</Button></Feedback>}
    {lab.busy && <Feedback>{t('busy')}</Feedback>}
    <Tabs value={view} onValueChange={setView} className="vc-view-tabs">
      <AppBar className="vc-navigation" scope={<TabsList variant="navigation" aria-label={t('scienceViews')}>
          <TabsTrigger value="cells"><Icon name="app"/>{t('cellsView')}</TabsTrigger>
          <TabsTrigger value="mechanism"><Icon name="nodes"/>{t('mechanismView')}</TabsTrigger>
          <TabsTrigger value="volume"><Icon name="models"/>{t('volumeView')}</TabsTrigger>
        </TabsList>}
        utilities={<IconButton label={t('refresh')} disabled={lab.busy} onClick={() => { void lab.refresh(); comparison.refresh(); download.refresh(); }}><Icon name="refresh"/></IconButton>}
        commands={<>
          {!isComparison && <Button variant="ghost" disabled={lab.busy} onClick={() => { void lab.example(); setView('cells'); setMode('perturbation'); }}>{t('example')}</Button>}
          {view === 'cells' && mode === 'perturbation' && !isComparison && lab.input && ['split', 'queries', 'candidates'].map(operation => <Button key={operation} variant="ghost" disabled={lab.busy || (operation === 'candidates' && !lab.input.hasPlan)} onClick={() => lab.run(operation)}>{t(operation as 'split')}</Button>)}
          {(isComparison && lab.input || view === 'cells' && mode === 'perturbation' && !isComparison && lab.input) && <FilePicker compact multiple variant="ghost" accept=".json,application/json" label={isComparison ? t('comparisonImport') : t('import')} emptyLabel="" disabled={lab.busy} onFiles={files => void importFiles(files)}/>}
          <Button variant="ghost" onClick={()=>{void chat.open({attachments:[chat.objectReference('virtual-cell')]}).catch(error=>setDisplayError(String(error)));}}>{t('discussContext')}</Button>
          <Button variant="ghost" onClick={()=>{void chat.open({capture:true}).catch(error=>setDisplayError(String(error)));}}>{t('captureContext')}</Button>
          <Button variant="ghost" onClick={()=>{void chat.open().catch(error=>setDisplayError(String(error)));}}>{t('openChat')}</Button>
        </>}
        primary={isComparison && lab.input
          ? <Button variant="primary" disabled={!comparison.canStart} onClick={() => void comparison.start(lab.input.id)}>{comparison.pending === 'start' ? t('comparison_starting') : t('comparisonStart')}</Button>
          : view === 'cells' && mode === 'perturbation' && !isComparison && lab.input
            ? <Button variant="primary" disabled={lab.busy} onClick={() => lab.run('evaluate')}>{t('evaluate')}</Button>
            : <FilePicker compact multiple variant="primary" accept=".json,application/json" label={isComparison ? t('comparisonImport') : t('import')} emptyLabel="" disabled={lab.busy} onFiles={files => void importFiles(files)}/>} />
      <TabsContent value="cells" forceMount><ContentPane id="virtual-cell-cells" label={t('cellsView')} as="div" surface="workspace" inset="none" scroll="content"
        toolbar={<div className="vc-data-toolbar"><Select label={t('dataMode')} value={mode} onChange={setMode} options={[{ value: 'atlas', label: t('atlasMode') }, { value: 'perturbation', label: t('perturbationMode') }, { value: 'comparison', label: t('comparisonMode') }]}/>{mode === 'atlas' ? <Button onClick={() => downloadFile('virtual-cell-atlas.json', JSON.stringify(atlas), 'application/json')}>{t('exportView')}</Button> : <>{!!lab.items.length && <Select label={t('inputs')} disabled={lab.busy} value={lab.selected} options={lab.items.map(i => ({ value: i.id, label: `${i.source.id} — ${i.source.revision} (${i.id.slice(0, 8)})` }))} onChange={lab.choose}/>}{mode !== 'comparison' && <Button disabled={lab.busy || !lab.input} onClick={lab.exportInputs}>{t('template')}</Button>}</>}</div>}>
        <div className="vc-view-body">{mode === 'atlas' ? <CellView key={identity(atlas, 'cells')} atlas={atlas} t={t}/> : mode === 'comparison' ? <ComparisonView key={comparison.selected || 'new'} comparison={comparison} download={download} input={lab.input} inputs={lab.items} t={t}/> : <>
          {lab.input?.source.id.startsWith('synthetic') && <Feedback>{t('sample')}</Feedback>}
          {lab.input && lab.bundle ? <PerturbationView key={lab.input.id} input={lab.input} bundle={lab.bundle} output={lab.output} t={t}/> : <EmptyState heading={lab.input ? t('busy') : t('empty')} description={t('format')}/>}
          {lab.input && !lab.input.hasPlan && <p className="vc-muted">{t('needPlan')}</p>}
        </>}</div>
      </ContentPane></TabsContent>
      <TabsContent value="mechanism" forceMount><ContentPane id="virtual-cell-mechanism" label={t('mechanismView')} as="div" surface="workspace" inset="none" scroll="content" toolbar={<div className="vc-data-toolbar"><span>{t('firstOrder')}</span></div>}><MechanismView key={identity(mechanism, 'mechanism')} document={mechanism} t={t}/></ContentPane></TabsContent>
      <TabsContent value="volume" forceMount><ContentPane id="virtual-cell-volume" label={t('volumeView')} as="div" surface="workspace" inset="none" scroll="content" toolbar={<div className="vc-data-toolbar"><span>{t('localVolume')}</span><Button onClick={() => downloadFile('virtual-cell-volume.json', JSON.stringify(volume), 'application/json')}>{t('exportView')}</Button></div>}><VolumeView key={identity(volume, 'volume')} document={volume} isExample={volumeIsExample} t={t}/></ContentPane></TabsContent>
    </Tabs>
    {!isComparison && <div className="vc-evidence"><span className="vc-tag">{t('local')}</span><Disclosure summary={t('method')}>
      <p>{t('displayImport')}</p><p>{t('methodBody')}</p><p>{t('format')}</p><p>{t('limits')}</p>
      {lab.input && <MetadataList layout="stacked" items={[{ id: 'input', label: t('inputs'), value: lab.input.id, format: 'code' }, { id: 'digest', label: 'SHA-256', value: lab.input.datasetDigest, format: 'code' }]} />}
      <Toolbar><Button disabled={lab.busy} onClick={() => lab.evidence()}>{t('evidence')}</Button><Button disabled={lab.busy} onClick={() => lab.evidence(true)}>{t('qc')}</Button></Toolbar>
    </Disclosure></div>}
    {!isComparison && lab.output && <ContentSection id="virtual-cell-result" title={t('result')} actions={<Button disabled={lab.busy} onClick={lab.exportOutput}>{t('export')}</Button>}>{lab.output.operation === 'evidence' && <Feedback>{t('reference')}</Feedback>}<Results output={lab.output} t={t}/><p className="vc-muted">{t('gaps')}</p></ContentSection>}
  </section>;
}
