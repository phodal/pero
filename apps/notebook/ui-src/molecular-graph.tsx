import { useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, Input, NativeSelect } from '@pero/app-sdk/ui';
import { chemicalElements, parseMolecularGraph, removeChemicalAtom, setChemicalBond, type ChemicalElement, type MolecularGraph } from '../../../packages/notebook/src/scientific-designs';
import { scientificMessages } from './scientific-ui-shared';

export function MolecularDrawing({ graph, onSelect, onAdd, selected = '', partner = '' }: {
  graph: MolecularGraph; onSelect?: (id: string) => void; onAdd?: (x: number, y: number) => void; selected?: string; partner?: string;
}) {
  const { t } = useAppI18n(scientificMessages);
  return <svg viewBox="0 0 600 320" preserveAspectRatio="none" role={onSelect ? "group" : "img"} aria-label={t('drawing')} style={{ width: '100%', maxHeight: 320, background: 'var(--pero-surface)', border: '1px solid var(--pero-border)', borderRadius: 8 }} onClick={onAdd ? event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width && rect.height) onAdd(Math.round((event.clientX - rect.left) / rect.width * 600), Math.round((event.clientY - rect.top) / rect.height * 320));
  } : undefined}>
    <title>{t('drawing')}</title>
    {graph.bonds.map(bond => {
      const start = graph.atoms.find(atom => atom.id === bond.from)!, end = graph.atoms.find(atom => atom.id === bond.to)!;
      const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy) || 1;
      return <g key={bond.id}>{Array.from({ length: bond.order }, (_, index) => {
        const offset = (index - (bond.order - 1) / 2) * 5;
        return <line key={index} x1={start.x - dy / length * offset} y1={start.y + dx / length * offset} x2={end.x - dy / length * offset} y2={end.y + dx / length * offset} stroke="var(--pero-text)" strokeWidth={2} />;
      })}</g>;
    })}
    {graph.atoms.map((atom, index) => <g key={atom.id} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={`${atom.element} ${index + 1}`} aria-pressed={onSelect ? atom.id === selected || atom.id === partner : undefined}
      onClick={event => { event.stopPropagation(); onSelect?.(atom.id); }} onKeyDown={event => { if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(atom.id); } }}>
      <circle cx={atom.x} cy={atom.y} r={16} fill={atom.id === selected || atom.id === partner ? 'var(--pero-accent-soft)' : 'var(--pero-surface)'} stroke={atom.id === selected ? 'var(--pero-action)' : 'var(--pero-border)'} strokeWidth={2} />
      <text x={atom.x} y={atom.y + 5} textAnchor="middle" fontSize={14} fill="var(--pero-text)">{atom.element}{atom.charge ? <tspan baselineShift="super" fontSize={10}>{Math.abs(atom.charge) === 1 ? '' : Math.abs(atom.charge)}{atom.charge > 0 ? '+' : '−'}</tspan> : null}</text>
    </g>)}
  </svg>;
}

export function MolecularGraphEditor({ graph, onChange, disabled = false }: { graph: MolecularGraph; onChange(graph: MolecularGraph): void; disabled?: boolean }) {
  const { t } = useAppI18n(scientificMessages);
  const [selected, setSelected] = useState(''), [partner, setPartner] = useState(''), [element, setElement] = useState<ChemicalElement>('C');
  const [x, setX] = useState('100'), [y, setY] = useState('160'), [charge, setCharge] = useState('0'), [order, setOrder] = useState<1 | 2 | 3>(1), [error, setError] = useState('');
  const current = graph.atoms.find(atom => atom.id === selected);
  const act = (action: () => void) => { try { action(); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const select = (identity: string) => {
    if (current && current.id !== identity && !partner) { setPartner(identity); return; }
    const atom = graph.atoms.find(atom => atom.id === identity);
    setSelected(identity); setPartner('');
    if (atom) { setElement(atom.element); setX(String(atom.x)); setY(String(atom.y)); setCharge(String(atom.charge)); }
  };
  const add = (px = Number(x), py = Number(y)) => act(() => {
    if (x.trim() === '' || y.trim() === '' || charge.trim() === '') throw new Error('Supply coordinates and formal charge.');
    const atom = { id: crypto.randomUUID(), element, x: px, y: py, charge: Number(charge) };
    onChange(parseMolecularGraph({ ...graph, atoms: [...graph.atoms, atom] })); setSelected(atom.id); setPartner('');
  });
  return <div>
    <p className="notebook-note">{t('drawHint')}</p>
    <MolecularDrawing graph={graph} selected={selected} partner={partner} onSelect={disabled ? undefined : select} onAdd={disabled ? undefined : add} />
    <fieldset disabled={disabled} style={{ border: 0, margin: 0, padding: 0 }}>
      <div className="notebook-science-fields">
        <Field label={t('element')}>{control => <NativeSelect {...control} value={element} onChange={e => setElement(e.target.value as ChemicalElement)}>{chemicalElements.map(value => <option key={value}>{value}</option>)}</NativeSelect>}</Field>
        <Field label={t('charge')}>{control => <Input {...control} type="number" min={-3} max={3} value={charge} onChange={e => setCharge(e.target.value)} />}</Field>
        <Field label={t('x')}>{control => <Input {...control} type="number" min={0} max={600} value={x} onChange={e => setX(e.target.value)} />}</Field>
        <Field label={t('y')}>{control => <Input {...control} type="number" min={0} max={320} value={y} onChange={e => setY(e.target.value)} />}</Field>
        <Field label={t('atom')}>{control => <NativeSelect {...control} value={current?.id ?? ''} onChange={e => { setPartner(''); const atom = graph.atoms.find(a => a.id === e.target.value); setSelected(atom?.id ?? ''); if (atom) { setElement(atom.element); setCharge(String(atom.charge)); setX(String(atom.x)); setY(String(atom.y)); } }}><option value="">{t('none')}</option>{graph.atoms.map((a, i) => <option key={a.id} value={a.id}>{i + 1}: {a.element}</option>)}</NativeSelect>}</Field>
        <Field label={t('bondTo')}>{control => <NativeSelect {...control} value={graph.atoms.some(a => a.id === partner) ? partner : ''} onChange={e => setPartner(e.target.value)}><option value="">{t('none')}</option>{graph.atoms.filter(a => a.id !== selected).map(a => <option key={a.id} value={a.id}>{graph.atoms.indexOf(a) + 1}: {a.element}</option>)}</NativeSelect>}</Field>
        <Field label={t('order')}>{control => <NativeSelect {...control} value={order} onChange={e => setOrder(Number(e.target.value) as 1 | 2 | 3)}>{[1, 2, 3].map(value => <option key={value}>{value}</option>)}</NativeSelect>}</Field>
      </div>
      <div className="notebook-science-actions">
        <Button disabled={graph.atoms.length >= 128} onClick={() => add()}>{t('addAtom')}</Button>
        <Button disabled={!current} onClick={() => act(() => { if ([x, y, charge].some(value => value.trim() === '')) throw new Error('Supply coordinates and formal charge.'); onChange(parseMolecularGraph({ ...graph, atoms: graph.atoms.map(a => a.id === selected ? { ...a, element, charge: Number(charge), x: Number(x), y: Number(y) } : a) })); })}>{t('updateAtom')}</Button>
        <Button disabled={!current} onClick={() => { onChange(removeChemicalAtom(graph, selected)); setSelected(''); setPartner(''); }}>{t('removeAtom')}</Button>
        <Button disabled={!current || !partner} onClick={() => act(() => onChange(setChemicalBond(graph, selected, partner, order, crypto.randomUUID())))}>{t('bond')}</Button>
        <Button disabled={!current || !partner} onClick={() => act(() => onChange(setChemicalBond(graph, selected, partner, 0, crypto.randomUUID())))}>{t('removeBond')}</Button>
      </div>
    </fieldset>
    {error && <Feedback kind="error">{error}</Feedback>}
  </div>;
}
