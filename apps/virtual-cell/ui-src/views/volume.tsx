import React, { useState } from 'react';
import { Checkbox, Field, Select } from '@pero/app-sdk/ui';
import type { Volume } from '../science';
import { color, num, Pane } from '../components/plots';
import { SourceStamp } from '../components/source';
import { VolumeCanvas, VolumeSlice, type VolumeRenderMode } from '../components/volume-canvas';
import type { Translate } from '../messages';

function Slider({ label, value, min = 0, max = 1, step = .01, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange(n: number): void }) {
  const id = React.useId();
  return <label className="vc-slider" htmlFor={id}><span>{label}<output aria-hidden="true">{num(value)}</output></span><input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}/></label>;
}
export function VolumeView({ document, t, isExample = false }: { document: Volume; t: Translate; isExample?: boolean }) {
  const [visible, setVisible] = useState(document.channels.map(() => true)), [density, setDensity] = useState(3), [threshold, setThreshold] = useState(.08), [cut, setCut] = useState(1), [slices, setSlices] = useState([.5, .5, .5]);
  const [mode, setMode] = useState<VolumeRenderMode>(isExample ? 'surface' : 'volume'), [isoThreshold, setIsoThreshold] = useState(.25), [opacity, setOpacity] = useState(.55);
  const channelName = (name: string) => isExample ? t(name as any) : name;
  return <><SourceStamp source={document.source} t={t}/><div className="vc-workspace">
    <aside className="vc-sidebar"><Pane title={t('channels')}>{document.channels.map((c, i) => <label className="vc-check-row" key={c.name}><Checkbox checked={visible[i]} onCheckedChange={checked => setVisible(visible.map((v, j) => i === j ? !!checked : v))}/><i style={{ background: color([1, 5, 3][i]) }}/><span>{channelName(c.name)}</span></label>)}</Pane>
    <Pane title={t('rendering')}><Field label={t('renderMode')}>{control => <Select {...control} label={t('renderMode')} value={mode} onChange={value => setMode(value as VolumeRenderMode)} options={[{ value: 'surface', label: t('surfaceMode') }, { value: 'volume', label: t('volumeMode') }]}/>}</Field>
      {mode === 'surface' ? <><Slider label={t('opacity')} min={.1} value={opacity} onChange={setOpacity}/><Slider label={t('isoThreshold')} min={.01} max={.9} value={isoThreshold} onChange={setIsoThreshold}/></> : <><Slider label={t('density')} min={.1} max={8} value={density} onChange={setDensity}/><Slider label={t('threshold')} value={threshold} max={.9} onChange={setThreshold}/></>}<Slider label={t('clipping')} value={cut} min={.05} onChange={setCut}/></Pane></aside>
    <main className="vc-science-main"><Pane title={t(mode === 'surface' ? 'surfaceRender' : 'volumeRender')} note={t(mode === 'surface' ? 'surfaceControls' : 'volumeControls')}><VolumeCanvas document={document} visible={visible} density={density} threshold={mode === 'surface' ? isoThreshold : threshold} cut={cut} mode={mode} opacity={opacity} t={t}/></Pane>
      <Pane title={t('orthogonalSlices')}><div className="vc-slices">{[0, 1, 2].map(axis => <div key={axis}><strong>{['YZ', 'XZ', 'XY'][axis]}</strong><VolumeSlice document={document} axis={axis} fraction={slices[axis]} visible={visible} t={t}/><Slider label={`${'XYZ'[axis]} · ${t('slice')}`} max={document.dimensions[axis] - 1} step={1} value={Math.round(slices[axis] * (document.dimensions[axis] - 1))} onChange={v => setSlices(slices.map((n, i) => i === axis ? v / (document.dimensions[axis] - 1) : n))}/></div>)}</div></Pane></main>
    <aside className="vc-inspector"><Pane title={t('volumeInfo')}><dl className="vc-properties"><dt>{t('dimensions')}</dt><dd>{document.dimensions.join(' × ')}</dd><dt>{t('voxelSize')}</dt><dd>{document.spacing.join(' × ')} {document.unit}</dd><dt>{t('extent')}</dt><dd>{document.dimensions.map((n, i) => num(n * document.spacing[i])).join(' × ')} {document.unit}</dd><dt>{t('channels')}</dt><dd>{document.channels.length}</dd></dl></Pane>
      <Pane title={t('dataScope')}><p className="vc-muted">{document.source.kind === 'illustrative' ? t('phantomNote') : t('volumeNote')}</p></Pane></aside>
  </div></>;
}
