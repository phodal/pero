import React, { useRef, useState } from 'react';
import { downloadFile, useAppI18n, useTheme } from '@pero/app-sdk';
import { Button, Disclosure, EmptyState, Feedback, Icon, Select, Tabs, TabsContent, TabsList, TabsTrigger, Toolbar } from '@pero/app-sdk/ui';
import { Results } from './components';
import { messages } from './messages';
import { useWorkbench } from './use-workbench';
import { parseDisplay, type Atlas, type Mechanism, type Volume } from './science';
import { mechanismExample, volumeExample } from './demo';
import pbmc from './pbmc-atlas.json';
import { CellView } from './views/cells';
import { PerturbationView } from './views/perturbations';
import { MechanismView } from './views/mechanism';
import { VolumeView } from './views/volume';
import css from './styles.css';
import { legacyThemeStyle } from './theme';

export default function VirtualCell() {
  const theme = useTheme();
  const { t } = useAppI18n(messages), lab = useWorkbench(t), file = useRef<HTMLInputElement>(null);
  const [view, setView] = useState('cells'), [mode, setMode] = useState('atlas'), [displayError, setDisplayError] = useState('');
  const [epochs, setEpochs] = useState({ cells: 0, mechanism: 0, volume: 0 });
  const [volumeIsExample, setVolumeIsExample] = useState(true);
  const [atlas, setAtlas] = useState<Atlas>(() => parseDisplay(pbmc) as Atlas), [mechanism, setMechanism] = useState<Mechanism>(mechanismExample), [volume, setVolume] = useState<Volume>(() => volumeExample());
  const current = view === 'cells' ? atlas : view === 'mechanism' ? mechanism : volume;
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
      await lab.importFiles(files); setView('cells'); setMode('perturbation');
    } catch (e: any) { setDisplayError(e.message || String(e)); }
  }
  const identity = (document: { source: { id: string; revision: string } }, slot: keyof typeof epochs) => `${document.source.id}:${document.source.revision}:${epochs[slot]}`;
  return <section className="virtual-cell" style={legacyThemeStyle(theme.mode === 'dark')} data-app-object="virtual-cell" aria-label="Virtual Cell" aria-busy={lab.busy}><style>{css}</style>
    <input className="vc-file" ref={file} type="file" multiple accept=".json,application/json" aria-label={t('import')} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) void importFiles(files); }}/>
    {(lab.error || displayError) && <Feedback kind="error">{lab.error || displayError} <Button disabled={lab.busy} onClick={() => { setDisplayError(''); void lab.refresh(); }}>{t('retry')}</Button></Feedback>}
    {lab.busy && <Feedback>{t('busy')}</Feedback>}
    <Tabs value={view} onValueChange={setView} className="vc-view-tabs">
      <Toolbar className="vc-navigation" actions={<>
        <Button disabled={lab.busy} onClick={() => file.current?.click()}><Icon name="plus"/>{t('import')}</Button>
        <Button disabled={lab.busy} onClick={() => { void lab.example(); setView('cells'); setMode('perturbation'); }}>{t('example')}</Button>
        <Button disabled={lab.busy} onClick={lab.refresh}><Icon name="refresh"/>{t('refresh')}</Button>
      </>}>
        <TabsList aria-label={t('scienceViews')}>
          <TabsTrigger value="cells"><Icon name="app"/>{t('cellsView')}</TabsTrigger>
          <TabsTrigger value="mechanism"><Icon name="nodes"/>{t('mechanismView')}</TabsTrigger>
          <TabsTrigger value="volume"><Icon family="shell" name="models"/>{t('volumeView')}</TabsTrigger>
        </TabsList>
      </Toolbar>
      <TabsContent value="cells" forceMount><div className="vc-data-toolbar"><Select label={t('dataMode')} value={mode} onChange={setMode} options={[{ value: 'atlas', label: t('atlasMode') }, { value: 'perturbation', label: t('perturbationMode') }]}/>{mode === 'atlas' ? <Button onClick={() => downloadFile('virtual-cell-atlas.json', JSON.stringify(atlas), 'application/json')}>{t('exportView')}</Button> : <>{!!lab.items.length && <Select label={t('inputs')} disabled={lab.busy} value={lab.selected} options={lab.items.map(i => ({ value: i.id, label: `${i.source.id} · ${i.id.slice(0, 8)}` }))} onChange={lab.choose}/>}<Button disabled={lab.busy || !lab.input} onClick={lab.exportInputs}>{t('template')}</Button></>}</div>
        {mode === 'atlas' ? <CellView key={identity(atlas, 'cells')} atlas={atlas} t={t}/> : <>
          {lab.input?.source.id.startsWith('synthetic') && <Feedback>{t('sample')}</Feedback>}
          <Toolbar>{['evaluate', 'split', 'queries', 'candidates'].map(operation => <Button key={operation} variant={operation === 'evaluate' ? 'primary' : 'secondary'} disabled={lab.busy || !lab.input || (operation === 'candidates' && !lab.input.hasPlan)} onClick={() => lab.run(operation)}>{t(operation as any)}</Button>)}</Toolbar>
          {lab.input && lab.bundle ? <PerturbationView key={lab.input.id} input={lab.input} bundle={lab.bundle} output={lab.output} t={t}/> : <EmptyState heading={lab.input ? t('busy') : t('empty')} description={t('format')}/>}
          {lab.input && !lab.input.hasPlan && <p className="vc-muted">{t('needPlan')}</p>}
        </>}
      </TabsContent>
      <TabsContent value="mechanism" forceMount><div className="vc-data-toolbar"><span>{t('firstOrder')}</span></div><MechanismView key={identity(mechanism, 'mechanism')} document={mechanism} t={t}/></TabsContent>
      <TabsContent value="volume" forceMount><div className="vc-data-toolbar"><span>{t('localVolume')}</span><Button onClick={() => downloadFile('virtual-cell-volume.json', JSON.stringify(volume), 'application/json')}>{t('exportView')}</Button></div><VolumeView key={identity(volume, 'volume')} document={volume} isExample={volumeIsExample} t={t}/></TabsContent>
    </Tabs>
    <div className="vc-evidence"><span className="vc-tag">{t('local')}</span><Disclosure summary={t('method')}>
      <p>{t('displayImport')}</p><p>{t('methodBody')}</p><p>{t('format')}</p><p>{t('limits')}</p>
      {lab.input && <dl className="vc-properties"><dt>{t('inputs')}</dt><dd>{lab.input.id}</dd><dt>SHA-256</dt><dd>{lab.input.datasetDigest}</dd></dl>}
      <Toolbar><Button disabled={lab.busy} onClick={() => lab.evidence()}>{t('evidence')}</Button><Button disabled={lab.busy} onClick={() => lab.evidence(true)}>{t('qc')}</Button></Toolbar>
    </Disclosure></div>
    {lab.output && <><div className="vc-results-heading"><h2>{t('result')}</h2><Button disabled={lab.busy} onClick={lab.exportOutput}>{t('export')}</Button></div>{lab.output.operation === 'evidence' && <Feedback>{t('reference')}</Feedback>}<Results output={lab.output} t={t}/><p className="vc-muted">{t('gaps')}</p></>}
  </section>;
}
