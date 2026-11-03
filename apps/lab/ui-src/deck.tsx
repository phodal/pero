import React, { useState } from 'react';
import { Split, SplitPane } from '@pero/app-sdk/ui';
import type { LabState } from './types';
import { formatNumber } from './presentation';

export function Deck({ state, preview = false, compact = false, title = '96-well plate' }: { state: LabState; preview?: boolean; compact?: boolean; title?: string }) {
  const [selected, setSelected] = useState('B1');
  const well = state.wells.find(item => item.id === selected);
  const plate = <>
      <div className="section-toolbar"><h2>{title}</h2><span className="muted">{preview ? 'Preview' : `Revision ${state.revision}`}</span></div>
      <div className="plate-scroll"><div className="plate" role="group" aria-label="96-well plate">
        <span />{Array.from({ length: 12 }, (_, n) => <span className="plate-axis" key={n}>{n + 1}</span>)}
        {'ABCDEFGH'.split('').map(row => <React.Fragment key={row}><span className="plate-axis">{row}</span>
          {Array.from({ length: 12 }, (_, col) => {
            const id = `${row}${col + 1}`, item = state.wells.find(w => w.id === id);
            return <button key={id} className={`well ${selected === id ? 'selected' : ''} ${id === 'B1' ? 'target-well' : ''}`} aria-label={`${id}, ${item?.volume_ul ?? 0} microliters`} aria-pressed={selected === id} onClick={() => setSelected(id)}>
              <span className="well-liquid" style={{ opacity: item?.volume_ul ? item.red_fraction : 0 }} />
              {!!item?.volume_ul && <span className="well-volume">{formatNumber(item.volume_ul)}</span>}
            </button>;
          })}</React.Fragment>)}
      </div></div>
      <div className="deck-legend"><span><strong>A1</strong> Red dye</span><span><strong>A2</strong> Diluent</span><span><strong>B1</strong> Target mixture</span></div>
      <p className="muted">{preview ? 'Initial layout preview. Freezing the experiment records its starting state.' : 'Virtual dye intensity shows the predicted fraction. Volumes in µL.'}</p>
    </>;
  const resources = <>
      <h2>Well {selected}</h2>
      <dl className="facts"><dt>Volume</dt><dd>{formatNumber(well?.volume_ul)} µL</dd><dt>Capacity</dt><dd>{formatNumber(well?.capacity_ul)} µL</dd><dt>Predicted red fraction</dt><dd>{formatNumber(well?.red_fraction)}</dd></dl>
      <details className="deck-resources"><summary>Pipette and tips ({state.available_tips.length} available)</summary>
        <dl className="facts"><dt>Attached tip</dt><dd>{state.pipette.tip_id ?? 'None'}</dd><dt>Pipette volume</dt><dd>{formatNumber(state.pipette.volume_ul)} / {state.pipette.capacity_ul} µL</dd><dt>Consumed tips</dt><dd>{state.consumed_tips.length}</dd></dl>
        <p className="muted">Returned tips are retired, never reused.</p>
      </details>
    </>;
  if (compact) return <section className="deck-compact">{plate}<div className="well-inspector">{resources}</div></section>;
  return <Split className="deck-layout" storageKey="lab.deck.panes" collapseBelow={760}>
    <SplitPane id="plate" min={320}>{plate}</SplitPane>
    <SplitPane id="resources" min={200} size={250}>{resources}</SplitPane>
  </Split>;
}
