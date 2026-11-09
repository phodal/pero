import { useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Feedback, Field, Input, NativeSelect } from '@pero/app-sdk/ui';
import { assignPlate, createPlate, plateRectangle, plateRowLabel, plateSnapshot, plateTraversal, plateWellIndex, plateWellName, type PlateDirection } from '@pero/notebook/science-plate';
import { scienceMessages, type SciencePanelProps } from './science-tools-shared';

export function PlatePanel({ onSnapshot }: SciencePanelProps) {
  const { t } = useAppI18n(scienceMessages);
  const [layout, setLayout] = useState(() => createPlate(8, 12)), [selected, setSelected] = useState([0]), [anchor, setAnchor] = useState(0);
  const [direction, setDirection] = useState<PlateDirection>('rows'), [group, setGroup] = useState(''), [additive, setAdditive] = useState(false), [range, setRange] = useState('A1:B3'), [error, setError] = useState('');
  const order = plateTraversal(selected, layout.size, direction);
  const act = (action: () => void) => { try { action(); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  return <div className="notebook-science-panel">
    <p className="notebook-note">{t('plateHint')}</p>
    <div className="notebook-science-fields">
      <Field label={t('size')} description={t('resize')}>{control => <NativeSelect {...control} value={`${layout.size.rows}x${layout.size.columns}`} onChange={event => {
        const [rows, columns] = event.target.value.split('x').map(Number); setLayout(createPlate(rows, columns)); setSelected([0]); setAnchor(0); setError('');
      }}>{[[4, 6], [8, 12], [16, 24], [32, 48]].map(([rows, cols]) => <option key={rows} value={`${rows}x${cols}`}>{rows * cols} ({rows} × {cols})</option>)}</NativeSelect>}</Field>
      <Field label={t('direction')}>{control => <NativeSelect {...control} value={direction} onChange={event => setDirection(event.target.value as PlateDirection)}><option value="rows">{t('across')}</option><option value="columns">{t('down')}</option></NativeSelect>}</Field>
      <Field label={t('group')}>{control => <Input {...control} maxLength={64} value={group} onChange={event => setGroup(event.target.value)} />}</Field>
      <Field label={t('range')}>{control => <Input {...control} value={range} onChange={event => setRange(event.target.value)} />}</Field>
    </div>
    <label><Checkbox checked={additive} onCheckedChange={value => setAdditive(value === true)} /> {t('additive')}</label>
    <div className="notebook-science-actions">
      <Button onClick={() => act(() => { const parts = range.split(':'); if (parts.length > 2) throw new Error('Use a single well or start:end.'); const first = plateWellIndex(parts[0], layout.size); setSelected(plateRectangle(first, plateWellIndex(parts[1] ?? parts[0], layout.size), layout.size)); setAnchor(first); })}>{t('selectRange')}</Button>
      <Button onClick={() => setSelected(Array.from({ length: layout.size.rows * layout.size.columns }, (_, index) => index))}>{t('selectAll')}</Button>
      <Button onClick={() => setSelected([])}>{t('clearSelection')}</Button>
      <Button disabled={!selected.length || !group.trim()} onClick={() => act(() => setLayout(assignPlate(layout, order, group, additive ? 'add' : 'replace')))}>{t('assign')}</Button>
      <Button disabled={!selected.length} onClick={() => act(() => setLayout(assignPlate(layout, order, '', 'clear')))}>{t('clearWells')}</Button>
    </div>
    {error && <Feedback kind="error">{error}</Feedback>}
    <div className="notebook-science-plate-scroll" role="region" aria-label={t('plate')} tabIndex={0}>
      <div className="notebook-science-plate" style={{ gridTemplateColumns: `2rem repeat(${layout.size.columns}, 2.8rem)` }}>
        <span />{Array.from({ length: layout.size.columns }, (_, c) => <span key={`column-${c}`}>{c + 1}</span>)}
        {Array.from({ length: layout.size.rows }, (_, r) => <div className="notebook-science-plate-row" key={r}>
          <span>{plateRowLabel(r)}</span>
          {Array.from({ length: layout.size.columns }, (_, c) => {
            const index = r * layout.size.columns + c, name = plateWellName(index, layout.size), groups = layout.groups[name] ?? [];
            const tones = ['--pero-tint-blue-soft', '--pero-accent-soft', '--pero-warning-bg', '--pero-success-bg', '--pero-tint-apricot-soft', '--pero-info-bg'];
            const stripes = groups.map((group, i) => { const tone = tones[[...group].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length]; return `var(${tone}) ${100 * i / groups.length}% ${100 * (i + 1) / groups.length}%`; });
            return <Button key={index} variant="ghost" aria-label={name} aria-pressed={selected.includes(index)} title={`${name}: ${groups.join(' + ') || '∅'}`} data-occupied={groups.length > 0 || undefined} style={stripes.length ? { background: `linear-gradient(135deg, ${stripes.length === 1 ? `${stripes[0]}, ${stripes[0]}` : stripes.join(', ')})`, color: 'var(--pero-text)' } : undefined} onClick={event => {
              if (event.shiftKey) setSelected(plateRectangle(anchor, index, layout.size));
              else if (event.metaKey || event.ctrlKey) { setSelected(previous => previous.includes(index) ? previous.filter(i => i !== index) : [...previous, index]); setAnchor(index); }
              else { setSelected([index]); setAnchor(index); }
            }}>{groups.length ? <><span>{groups[0].slice(0, 3)}</span><small>{groups.length > 1 ? `+${groups.length - 1}` : ''}</small></> : '·'}</Button>;
          })}
        </div>)}
      </div>
    </div>
    <p className="notebook-note" role="status">{order.length}: {order.slice(0, 96).map(i => plateWellName(i, layout.size)).join(' → ')}{order.length > 96 ? ' …' : ''}</p>
    <Button variant="primary" onClick={() => { const snapshot = plateSnapshot(layout, order, direction); onSnapshot(t('plate'), snapshot, snapshot.wells.map(well => [well.well, well.groups.join(' + '), well.order === null ? '' : String(well.order)])); }}>{t('insert')}</Button>
  </div>;
}
