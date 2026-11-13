import React, { useState } from 'react';
import { useAppContext } from '@pero/app-sdk';
import { Disclosure, Button, ContentSection, InspectorHeader, LibraryHeader, Split, SplitPane } from '@pero/app-sdk/ui';
import type { LabState } from './types';
import { formatNumber } from './presentation';

export function Deck({ state, preview = false, compact = false, title, hideHeading = false }: { state: LabState; preview?: boolean; compact?: boolean; title?: string; hideHeading?: boolean }) {
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  const text = (en: string, zhText: string) => zh ? zhText : en;
  const [selected, setSelected] = useState('B1');
  const well = state.wells.find(item => item.id === selected);
  const heading = title ?? text('96-well plate', '96 孔板');
  const plate = <div className="deck-surface">
      {!hideHeading && <LibraryHeader className="deck-toolbar" density="compact" title={heading} actions={<span className="candidate-status">{preview ? text('Preview', '预览') : text(`Revision ${state.revision}`, `修订 ${state.revision}`)}</span>} />}
      <div className="deck-canvas"><div className="plate-tray"><div className="plate" role="group" aria-label="96-well plate">
        <span />{Array.from({ length: 12 }, (_, n) => <span className="plate-axis" key={n}>{n + 1}</span>)}
        {'ABCDEFGH'.split('').map(row => <React.Fragment key={row}><span className="plate-axis">{row}</span>
          {Array.from({ length: 12 }, (_, col) => {
            const id = `${row}${col + 1}`, item = state.wells.find(w => w.id === id);
            return <Button variant="ghost" key={id} className={`well ${selected === id ? 'selected' : ''} ${id === 'B1' ? 'target-well' : ''}`} data-filled={item?.volume_ul ? '' : undefined} aria-label={`${id}, ${item?.volume_ul ?? 0} microliters`} aria-pressed={selected === id} onClick={() => setSelected(id)}>
              <span className="well-liquid" style={{ opacity: item?.volume_ul ? item.red_fraction : 0 }} />
              {!!item?.volume_ul && <span className="well-volume">{formatNumber(item.volume_ul)}</span>}
            </Button>;
          })}</React.Fragment>)}
      </div></div></div>
      <div className="deck-legend"><span><strong>A1</strong> {text('Red dye', '红色染料')}</span><span><strong>A2</strong> {text('Diluent', '稀释液')}</span><span><strong>B1</strong> {text('Target', '目标')}</span></div>
    </div>;
  const resources = <>
      <section className="selected-well"><InspectorHeader title={`${text('Well', '孔')} ${selected}`} /><dl className="well-metrics">
        <div><dt>{text('Volume', '体积')}</dt><dd>{formatNumber(well?.volume_ul)} µL</dd></div><div><dt>{text('Capacity', '容量')}</dt><dd>{formatNumber(well?.capacity_ul)} µL</dd></div><div><dt>{text('Predicted red fraction', '预测红色比例')}</dt><dd>{formatNumber(well?.red_fraction)}</dd></div>
      </dl></section>
      <section className="deck-resources"><ContentSection id="lab-pipette" title={text('Pipette', '移液器')} actions={<span className="muted">{state.pipette.tip_id ? text(`Tip ${state.pipette.tip_id}`, `吸头 ${state.pipette.tip_id}`) : text('No tip attached', '未安装吸头')}</span>}><p className="pipette-volume">{formatNumber(state.pipette.volume_ul)} <span className="muted">/ {state.pipette.capacity_ul} µL</span></p>
        <Disclosure variant="inline" summary={<>{text('Tip inventory', '吸头库存')} <span>{state.available_tips.length} {text('available', '可用')} / {state.consumed_tips.length} {text('consumed', '已用')}</span></>}>
          <dl className="tip-inventory"><dt>{text('Available', '可用')}</dt><dd>{state.available_tips.join(', ') || text('None', '无')}</dd><dt>{text('Consumed', '已用')}</dt><dd>{state.consumed_tips.join(', ') || text('None', '无')}</dd></dl>
          <p className="muted">{text('Returned tips are retired.', '归还的吸头不再使用。')}</p>
        </Disclosure>
      </ContentSection></section>
    </>;
  if (compact) return <section className="deck-compact">{plate}<div className="well-inspector">{resources}</div></section>;
  return <Split className="deck-layout" storageKey="lab.deck.panes" collapseBelow={760}>
    <SplitPane id="plate" className="deck-pane" min={400}>{plate}</SplitPane>
    <SplitPane id="resources" className="resource-pane" min={240} size={280} resizeLabel="Resize well inspector">{resources}</SplitPane>
  </Split>;
}
