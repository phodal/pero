import React, { useMemo, useState } from 'react';
import { Button, Checkbox, Field, Input, Select } from '@pero/app-sdk/ui';
import type { Atlas } from '../science';
import { groupMeans } from '../science';
import { Bars, color, Heatmap, Legend, num, Pane, ZoomTools } from '../components/plots';
import { SourceStamp } from '../components/source';
import type { Translate } from '../messages';

export function CellView({ atlas, t }: { atlas: Atlas; t: Translate }) {
  const groups = useMemo(() => [...new Set(atlas.cells.map(c => c.group))], [atlas]);
  const [excluded, setExcluded] = useState<string[]>([]), [gene, setGene] = useState(''), [search, setSearch] = useState(''), [cellId, setCellId] = useState(''), [zoom, setZoom] = useState(1);
  const selectedGene = atlas.genes.includes(gene) ? gene : atlas.genes[0], g = atlas.genes.indexOf(selectedGene);
  const [byGene, setByGene] = useState(false);
  const visibleGroups = groups.filter(group => !excluded.includes(group)), visible = atlas.cells.map((c, i) => ({ ...c, xy: atlas.embedding.coordinates[i] })).filter(c => visibleGroups.includes(c.group));
  const selected = visible.find(c => c.id === cellId) ?? visible[0];
  const coordinates = atlas.embedding.coordinates, xs = coordinates.map(p => p[0]), ys = coordinates.map(p => p[1]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys), maxExpression = Math.max(.001, ...atlas.cells.map(c => c.expression[g]));
  const plotId = React.useId();
  const heatmapGenes = atlas.genes.length > 24 ? [...atlas.genes.slice(0, 23), ...(atlas.genes.indexOf(selectedGene) >= 23 ? [selectedGene] : [atlas.genes[23]])] : atlas.genes;
  const p = (v: number, min: number, max: number, size: number) => ((v - min) / (max - min || 1) - .5) * size * zoom + size / 2;
  return <><SourceStamp source={atlas.source} t={t}/><div className="vc-workspace">
    <aside className="vc-sidebar"><Pane title={t('cellGroups')} actions={<Button onClick={() => setExcluded([])}>{t('reset')}</Button>}>
      {groups.map((group, i) => <label className="vc-check-row" key={group}><Checkbox checked={!excluded.includes(group)} onCheckedChange={v => setExcluded(prev => v ? prev.filter(p => p !== group) : [...prev, group])}/><i style={{ background: color(i) }}/><span>{group}</span><small>{atlas.cells.filter(c => c.group === group).length}</small></label>)}
    </Pane><Pane title={t('genes')}><Input type="search" aria-label={t('findGene')} placeholder={t('findGene')} value={search} onChange={e => setSearch(e.target.value)}/><div className="vc-gene-list">{atlas.genes.filter(g => g.toLowerCase().includes(search.toLowerCase())).map(name => <Button key={name} variant="ghost" aria-pressed={name === selectedGene} onClick={() => { setGene(name); setByGene(true); }}>{name}</Button>)}</div></Pane></aside>
    <main className="vc-science-main"><Pane title={`${atlas.embedding.method} · ${t('cellMap')}`} className="vc-map-pane" actions={<><Button aria-pressed={!byGene} onClick={() => setByGene(false)}>{t('cellGroups')}</Button><Button aria-pressed={byGene} onClick={() => setByGene(true)}>{selectedGene}</Button></>} note={`${visible.length} / ${atlas.cells.length} ${t('cells')} · ${t('embeddingNote')}`}>
      <div className="vc-scatter-wrap"><svg viewBox="0 0 680 390" role="img" aria-label={`${atlas.embedding.method} · ${visible.length} ${t('cells')} · ${selectedGene}`}><defs><clipPath id={plotId}><rect x="30" y="10" width="620" height="350"/></clipPath></defs><g clipPath={`url(#${plotId})`}>{visible.map((cell, i) => <circle key={cell.id} cx={p(cell.xy[0], xmin, xmax, 570) + 55} cy={350 - p(cell.xy[1], ymin, ymax, 300)} r={cell.id === selected?.id ? 5 : 2.9} opacity={byGene ? Math.max(.15, cell.expression[g] / maxExpression) : .82} fill={color(byGene ? 1 : groups.indexOf(cell.group))} stroke={cell.id === selected?.id ? 'var(--pero-text)' : 'none'} onClick={() => setCellId(cell.id)}><title>{`${cell.id} · ${cell.group} · ${selectedGene}: ${num(cell.expression[g])}`}</title></circle>)}</g><path d="M35 300v55h55" className="vc-axis-path"/><text x="35" y="377" className="vc-axis">{atlas.embedding.method} 1</text><text transform="translate(20 350) rotate(-90)" className="vc-axis">{atlas.embedding.method} 2</text></svg><ZoomTools zoom={zoom} onZoom={setZoom} t={t}/></div>
      <Legend items={byGene ? [{ name: `${selectedGene} · ${atlas.scale}`, color: color(1) }] : visibleGroups.map(group => ({ name: group, color: color(groups.indexOf(group)) }))}/>
    </Pane><Pane title={`${t('expressionHeatmap')} · ${atlas.scale}`} note={`${heatmapGenes.length}/${atlas.genes.length} ${t('genes')} · ${t('groupMeansNote')}`}><Heatmap label={t('expressionHeatmap')} columns={heatmapGenes} rows={groupMeans(atlas, visibleGroups).map(row => ({ ...row, values: heatmapGenes.map(g => row.values[atlas.genes.indexOf(g)]) }))} /></Pane></main>
    <aside className="vc-inspector"><Pane title={t('selection')}><Field label={t('cell')}>{control => <Select {...control} label={t('cell')} value={selected?.id ?? ''} onChange={setCellId} options={visible.map(c => ({ value: c.id, label: c.id }))}/>}</Field>{selected ? <dl className="vc-properties"><dt>{t('cellGroups')}</dt><dd>{selected.group}</dd><dt>{selectedGene}</dt><dd>{num(selected.expression[g])}</dd><dt>{t('scale')}</dt><dd>{atlas.scale}</dd></dl> : <p>{t('noSelection')}</p>}</Pane>
    <Pane title={t('groupSizes')}><Bars label={t('groupSizes')} rows={groups.map((id, i) => ({ id, value: atlas.cells.filter(c => c.group === id).length, color: color(i) }))} onSelect={id => setExcluded(groups.filter(g => g !== id))}/></Pane>
    <Pane title={`${selectedGene} · ${t('groupMean')}`}><Bars label={selectedGene} rows={groupMeans(atlas, visibleGroups).map(r => ({ id: r.id, value: r.values[g] }))}/></Pane></aside>
  </div></>;
}
