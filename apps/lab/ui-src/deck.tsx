import React, { useState } from 'react';
import { Split, SplitPane } from '@pero/app-sdk/ui';
import type { LabState } from './types';
import { formatNumber } from './presentation';

export function Deck({ state }: { state: LabState }) {
  const [selected, setSelected] = useState('B1');
  const well = state.wells.find(item => item.id === selected);
  return <Split className="deck-layout" storageKey="lab.deck.panes" collapseBelow={760}>
    <SplitPane id="plate" min={320}>
      <h2>96-well plate</h2>
      <p className="muted">Virtual dye intensity; volumes in µL. State revision {state.revision}.</p>
      <div className="plate-scroll"><div className="plate" aria-label="96-well plate">
        <span />{Array.from({ length: 12 }, (_, n) => <span className="plate-axis" key={n}>{n + 1}</span>)}
        {'ABCDEFGH'.split('').map(row => <React.Fragment key={row}><span className="plate-axis">{row}</span>
          {Array.from({ length: 12 }, (_, col) => {
            const id = `${row}${col + 1}`, item = state.wells.find(w => w.id === id);
            return <button key={id} className={`well ${selected === id ? 'selected' : ''}`} aria-label={`${id}, ${item?.volume_ul ?? 0} microliters`} aria-pressed={selected === id} onClick={() => setSelected(id)}>
              <span className="well-liquid" style={{ opacity: item?.volume_ul ? Math.max(.1, item.red_fraction) : 0 }} />
              <span>{formatNumber(item?.volume_ul ?? 0)}</span>
            </button>;
          })}</React.Fragment>)}
      </div></div>
      <p className="muted">A1: red dye. A2: diluent. B1: target mixture.</p>
    </SplitPane>
    <SplitPane id="resources" min={200} size={250}>
      <h2>Well {selected}</h2>
      <dl className="facts"><dt>Volume</dt><dd>{formatNumber(well?.volume_ul)} µL</dd><dt>Capacity</dt><dd>{formatNumber(well?.capacity_ul)} µL</dd><dt>Predicted red fraction</dt><dd>{formatNumber(well?.red_fraction)}</dd></dl>
      <h2>Pipette and tips</h2>
      <dl className="facts"><dt>Attached tip</dt><dd>{state.pipette.tip_id ?? 'None'}</dd><dt>Pipette volume</dt><dd>{formatNumber(state.pipette.volume_ul)} / {state.pipette.capacity_ul} µL</dd><dt>Available tips</dt><dd>{state.available_tips.length}</dd><dt>Consumed tips</dt><dd>{state.consumed_tips.length}</dd></dl>
      <p className="muted">Returned tips are retired, never reused.</p>
    </SplitPane>
  </Split>;
}
