import React, { useMemo, useState } from 'react';
import { downloadFile } from '@pero/app-sdk';
import { Button, Feedback, Field, Icon, Input, Select } from '@pero/app-sdk/ui';
import type { Mechanism } from '../science';
import { simulate } from '../science';
import { color, Lines, num, Pane } from '../components/plots';
import { SourceStamp } from '../components/source';
import type { Translate } from '../messages';

export function MechanismView({ document, t }: { document: Mechanism; t: Translate }) {
  const [model, setModel] = useState(document), [computed, setComputed] = useState(document), [selected, setSelected] = useState(document.species[0].id), [error, setError] = useState('');
  const result = useMemo(() => simulate(computed), [computed]);
  const marker = React.useId(), last = result.rows.at(-1)!;
  const position = (i: number) => model.species.length <= 4 ? [100 + i * 205, 170] : [85 + i % 4 * 190, 65 + Math.floor(i / 4) * 105];
  const node = (id: string) => position(model.species.findIndex(s => s.id === id));
  return <><SourceStamp source={model.source} t={t}/><div className="vc-workspace">
    <aside className="vc-sidebar"><Pane title={t('species')}><div className="vc-object-list">{model.species.map((s, i) => <Button key={s.id} variant="ghost" aria-pressed={selected === s.id} onClick={() => setSelected(s.id)}><i style={{ background: color(i) }}/>{s.id}</Button>)}</div></Pane><Pane title={t('simulation')}>
      <Field label={`${t('duration')} (${model.timeUnit})`}>{control => <Input {...control} type="number" min=".1" max="100" step=".1" value={model.duration} onChange={e => setModel({ ...model, duration: Number(e.target.value) })}/>}</Field>
      <Button variant="primary" onClick={() => { try { simulate(model); setComputed(model); setError(''); } catch { setError(t('modelInvalid')); } }}><Icon name="play"/>{t('simulate')}</Button>
      {model !== computed && <Feedback>{t('parametersChanged')}</Feedback>}{error && <Feedback kind="error">{error}</Feedback>}
      <Button onClick={() => downloadFile('virtual-cell-mechanism.json', JSON.stringify({ ...computed, simulation: result }, null, 2), 'application/json')}>{t('exportSimulation')}</Button>
    </Pane></aside>
    <main className="vc-science-main"><Pane title={t('reactionNetwork')} note={t('mechanismNote')}><svg className="vc-network" viewBox={`0 0 800 ${model.species.length <= 4 ? 340 : Math.ceil(model.species.length / 4) * 105 + 30}`} role="img" aria-label={t('reactionNetwork')}><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="var(--pero-text-secondary)"/></marker></defs>
      {model.reactions.map(r => { const [x1, y1] = node(r.from), [x2, y2] = node(r.to), sign = x2 >= x1 ? 1 : -1, bend = sign * -65, offset = sign * -10; return <g key={r.id}><path d={`M${x1 + sign * 35} ${y1 + offset} Q${(x1 + x2) / 2} ${(y1 + y2) / 2 + bend} ${x2 - sign * 38} ${y2 + offset}`} fill="none" className="vc-axis-path" markerEnd={`url(#${marker})`}/><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + bend / 2 + (sign > 0 ? -10 : 20)} textAnchor="middle" className="vc-axis">{r.id} · k={num(r.rate)}</text></g>; })}
      {model.species.map((s, i) => { const [x, y] = position(i); return <g key={s.id} onClick={() => setSelected(s.id)}><circle cx={x} cy={y} r="36" fill="var(--pero-surface)" stroke={color(i)} strokeWidth={s.id === selected ? 4 : 2}/><text x={x} y={y + 5} textAnchor="middle" className="vc-node-label">{s.id.length > 8 ? `${s.id.slice(0, 7)}…` : s.id}</text><text x={x} y={y + 62} textAnchor="middle" className="vc-axis">{num(s.initial)} {model.concentrationUnit}</text><title>{s.id}</title></g>; })}
    </svg></Pane><Pane title={t('timeCourse')} note={`${t('solver')}: Euler · Δt=${num(result.dt)} ${computed.timeUnit}`}><Lines label={t('timeCourse')} xLabel={`${t('time')} (${computed.timeUnit})`} yLabel={computed.concentrationUnit} series={computed.species.map((s, i) => ({ name: s.id, points: result.rows.map(r => [r.time, r.values[i]]) }))}/></Pane></main>
    <aside className="vc-inspector"><Pane title={t('initialState')}><Field label={t('species')}>{control => <Select {...control} label={t('species')} value={selected} onChange={setSelected} options={model.species.map(s => ({ value: s.id, label: s.id }))}/>}</Field>
      <Field label={`${t('initialConcentration')} (${model.concentrationUnit})`}>{control => <Input {...control} type="number" min="0" max="10000" step=".1" value={model.species.find(s => s.id === selected)!.initial} onChange={e => setModel({ ...model, species: model.species.map(s => s.id === selected ? { ...s, initial: Number(e.target.value) } : s) })}/>}</Field></Pane>
      <Pane title={t('rateConstants')}>{model.reactions.map(r => <Field key={r.id} label={`${r.id}: ${r.from} → ${r.to} (${model.timeUnit}⁻¹)`}>{control => <Input {...control} type="number" min="0" max="10" step=".01" value={r.rate} onChange={e => setModel({ ...model, reactions: model.reactions.map(row => row.id === r.id ? { ...row, rate: Number(e.target.value) } : row) })}/>}</Field>)}</Pane>
      <Pane title={t('finalState')}><dl className="vc-properties">{computed.species.map((s, i) => <React.Fragment key={s.id}><dt>{s.id}</dt><dd>{num(last.values[i])}</dd></React.Fragment>)}</dl></Pane>
    </aside>
  </div></>;
}
