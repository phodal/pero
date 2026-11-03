import React, { useState } from 'react';
import { Icon, Split, SplitPane } from '@pero/app-sdk/ui';
import type { LabState } from './types';
import { formatNumber } from './presentation';

export function Deck({ state, preview = false, compact = false, title = '96-well plate' }: { state: LabState; preview?: boolean; compact?: boolean; title?: string }) {
  const [selected, setSelected] = useState('B1');
  const well = state.wells.find(item => item.id === selected);
  const plate = <div className="deck-surface">
      <div className="section-toolbar deck-toolbar"><h2><Icon name="grid" />{title}</h2><span className="candidate-status">{preview ? 'Preview' : `Revision ${state.revision}`}</span></div>
      <div className="deck-canvas"><div className="plate-tray"><div className="plate" role="group" aria-label="96-well plate">
        <span />{Array.from({ length: 12 }, (_, n) => <span className="plate-axis" key={n}>{n + 1}</span>)}
        {'ABCDEFGH'.split('').map(row => <React.Fragment key={row}><span className="plate-axis">{row}</span>
          {Array.from({ length: 12 }, (_, col) => {
            const id = `${row}${col + 1}`, item = state.wells.find(w => w.id === id);
            return <button key={id} className={`well ${selected === id ? 'selected' : ''} ${id === 'B1' ? 'target-well' : ''}`} data-filled={item?.volume_ul ? '' : undefined} aria-label={`${id}, ${item?.volume_ul ?? 0} microliters`} aria-pressed={selected === id} onClick={() => setSelected(id)}>
              <span className="well-liquid" style={{ opacity: item?.volume_ul ? item.red_fraction : 0 }} />
              {!!item?.volume_ul && <span className="well-volume">{formatNumber(item.volume_ul)}</span>}
            </button>;
          })}</React.Fragment>)}
      </div></div></div>
      <div className="deck-legend"><span><strong>A1</strong> Red dye</span><span><strong>A2</strong> Diluent</span><span><strong>B1</strong> Target</span></div>
    </div>;
  const resources = <>
      <section className="selected-well"><h2>Well <strong>{selected}</strong></h2><dl className="well-metrics">
        <div><dt>Volume</dt><dd>{formatNumber(well?.volume_ul)} µL</dd></div><div><dt>Capacity</dt><dd>{formatNumber(well?.capacity_ul)} µL</dd></div><div><dt>Predicted red fraction</dt><dd>{formatNumber(well?.red_fraction)}</dd></div>
      </dl></section>
      <section className="deck-resources"><div className="section-toolbar"><h2>Pipette</h2><span className="muted">{state.pipette.tip_id ? `Tip ${state.pipette.tip_id}` : 'No tip attached'}</span></div><p className="pipette-volume">{formatNumber(state.pipette.volume_ul)} <span className="muted">/ {state.pipette.capacity_ul} µL</span></p>
        <details><summary>Tip inventory <span>{state.available_tips.length} available / {state.consumed_tips.length} consumed</span></summary>
          <dl className="tip-inventory"><dt>Available</dt><dd>{state.available_tips.join(', ') || 'None'}</dd><dt>Consumed</dt><dd>{state.consumed_tips.join(', ') || 'None'}</dd></dl>
          <p className="muted">Returned tips are retired.</p>
        </details>
      </section>
    </>;
  if (compact) return <section className="deck-compact">{plate}<div className="well-inspector">{resources}</div></section>;
  return <Split className="deck-layout" storageKey="lab.deck.panes" collapseBelow={760}>
    <SplitPane id="plate" className="deck-pane" min={400}>{plate}</SplitPane>
    <SplitPane id="resources" className="resource-pane" min={240} size={280} resizeLabel="Resize well inspector">{resources}</SplitPane>
  </Split>;
}
