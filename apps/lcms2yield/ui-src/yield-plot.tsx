import { seriesStyle } from '@pero/app-sdk/chart';
import { plotBounds, yieldPercent, type YieldPoint } from './plot';

const TYPES = ['Buchwald', 'SN2', 'amide_coupling', 'Suzuki'] as const;

export function YieldPlot({ points, selected, onSelect, label }: {
  points: (YieldPoint & { reactionType: string })[];
  selected: number | null;
  onSelect: (index: number) => void;
  label: string;
}) {
  const bounds = plotBounds(points);
  const span = bounds.high - bounds.low;
  const map = (value: number) => ((value - bounds.low) / span) * 100;
  const color = new Map<string, string>(TYPES.map((type, index) => [type, seriesStyle(index).stroke]));
  const ordered = [...points.filter(point => point.index !== selected), ...points.filter(point => point.index === selected)];
  return <svg className="yield-plot" viewBox="0 0 100 100" width="100%" height="320" preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
    <line x1={map(bounds.low)} y1={100 - map(bounds.low)} x2={map(bounds.high)} y2={100 - map(bounds.high)} className="yield-diagonal" />
    {ordered.map(point => <circle key={point.index} cx={map(point.x)} cy={100 - map(point.y)} r={selected === point.index ? 2.2 : 1.15}
      fill={color.get(point.reactionType) ?? 'currentColor'} className={selected === point.index ? 'is-selected' : undefined}
      tabIndex={0} role="button" aria-pressed={selected === point.index} aria-label={`${point.reactionType} ${point.index + 1}`}
      onClick={() => onSelect(point.index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(point.index); } }} />)}
  </svg>;
}
