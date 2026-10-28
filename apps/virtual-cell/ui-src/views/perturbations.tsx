import React, { useState } from 'react';
import { Field, Input, Select } from '@pero/app-sdk/ui';
import type { Bundle } from '../science';
import { Bars, Heatmap, Lines, num, Pane } from '../components/plots';
import type { Translate } from '../messages';
import type { InputRevision, Output } from '../use-workbench';

export function PerturbationView({ bundle, input, output, t }: { bundle: Bundle; input: InputRevision; output: Output | null; t: Translate }) {
  const d = bundle.dataset, [search, setSearch] = useState(''), [part, setPart] = useState('all'), [chosen, setChosen] = useState(''), [delta, setDelta] = useState('delta');
  const rows = d.conditions.filter(c => c.id.toLowerCase().includes(search.toLowerCase()) && (part === 'all' || bundle.split.assignments[part]?.includes(c.id)));
  const selected = rows.find(c => c.id === chosen) ?? rows[0], ctrl = d.conditions.find(c => c.id === d.control)!;
  const genes = d.genes.slice(0, 24), visible = rows.slice(0, 48);
  const models = output?.inputId === input.id ? output?.result?.models : undefined;
  return <div className="vc-workspace">
    <aside className="vc-sidebar"><Pane title={t('conditions')}><Input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label={t('findCondition')} placeholder={t('findCondition')}/>
      <Field label={t('partition')}>{control => <Select {...control} label={t('partition')} value={part} onChange={setPart} options={['all', 'train', 'validation', 'test'].map(value => ({ value, label: value === 'all' ? t('all') : value }))}/>}</Field>
      <Field label={t('condition')}>{control => <Select {...control} label={t('condition')} value={selected?.id ?? ''} onChange={setChosen} options={rows.map(c => ({ value: c.id, label: c.id }))}/>}</Field>
      <dl className="vc-properties"><dt>{t('genes')}</dt><dd>{input.genes}</dd><dt>{t('conditions')}</dt><dd>{input.conditions}</dd><dt>{t('scale')}</dt><dd>{d.scale}</dd><dt>{t('control')}</dt><dd>{d.control}</dd></dl>
    </Pane><Pane title={t('support')}><Bars label={t('support')} rows={visible.map(c => ({ id: c.id, value: c.cells }))} selected={selected?.id} onSelect={setChosen}/></Pane></aside>
    <main className="vc-science-main"><Pane title={t('perturbationHeatmap')} actions={<Select label={t('readout')} value={delta} onChange={setDelta} options={[{ value: 'delta', label: t('vsControl') }, { value: 'mean', label: t('mean') }]}/>} note={`${visible.length}/${rows.length} ${t('conditions')} · ${genes.length}/${d.genes.length} ${t('genes')} · ${t('meansOnly')}`}>
      {visible.length ? <Heatmap label={t('perturbationHeatmap')} columns={genes} rows={visible.map(c => ({ id: c.id, values: genes.map((_, g) => c.mean[g] - (delta === 'delta' ? ctrl.mean[g] : 0)) }))} selected={selected?.id} onSelect={setChosen} diverging={delta === 'delta'}/> : <p>{t('noSelection')}</p>}
    </Pane>{selected && <Pane title={`${selected.id} · ${t('observedControl')}`} note={t('geneAxisNote')}><Lines label={t('observedControl')} xLabel={t('geneIndex')} yLabel={d.scale} series={[{ name: selected.id, points: genes.map((_, g) => [g + 1, selected.mean[g]]) }, { name: d.control, points: genes.map((_, g) => [g + 1, ctrl.mean[g]]) }]}/></Pane>}</main>
    <aside className="vc-inspector"><Pane title={t('selection')}><dl className="vc-properties"><dt>{t('condition')}</dt><dd>{selected?.id ?? '—'}</dd><dt>{t('cells')}</dt><dd>{selected?.cells ?? '—'}</dd><dt>{t('targetsLabel')}</dt><dd>{selected?.targets.join(' + ') || d.control}</dd></dl></Pane>
      {selected && <Pane title={t('geneResponse')}><Bars label={t('geneResponse')} rows={genes.map((id, g) => ({ id, value: selected.mean[g] - ctrl.mean[g] }))}/></Pane>}
      <Pane title={t('baselineError')} note={t('baselineNote')}>{models ? <Bars label={t('baselineError')} rows={models.filter((m: any) => Number.isFinite(m.delta_mse?.median)).map((m: any) => ({ id: m.model.id, value: m.delta_mse.median }))}/> : <p className="vc-muted">{t('runForMetrics')}</p>}</Pane>
    </aside>
  </div>;
}
