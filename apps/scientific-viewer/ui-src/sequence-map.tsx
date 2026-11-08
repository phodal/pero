import { cutBoundary, type RestrictionSite } from './sequence-restriction';
import type { BaseSpan, SequenceFeature, SequenceRecord } from './sequence-record';

export function featureColor(kind: string) {
  if (kind === 'CDS' || kind === 'gene') return 'coding';
  if (kind === 'regulatory' || kind === 'promoter') return 'regulatory';
  if (kind === 'rep_origin') return 'origin';
  if (kind === 'primer_bind' || kind === 'misc_binding') return 'binding';
  return 'other';
}

export function featureTracks(features: readonly SequenceFeature[]) {
  const tracks: BaseSpan[][] = [];
  return features.map(feature => {
    let track = tracks.findIndex(spans => feature.spans.every(a => spans.every(b => a.end <= b.start || a.start >= b.end)));
    if (track === -1) track = tracks.push([]) - 1;
    tracks[track].push(...feature.spans);
    return { feature, track };
  });
}

const center = 240;
function point(position: number, length: number, r: number) {
  const angle = 2 * Math.PI * position / length;
  return [center + r * Math.sin(angle), center - r * Math.cos(angle)];
}

function circularArc(start: number, end: number, length: number, r: number) {
  const p = point(start, length, r);
  const q = point(Math.min(end, start + length - 0.001), length, r);
  return `M ${p} A ${r} ${r} 0 ${end - start > length / 2 ? 1 : 0} 1 ${q}`;
}

export function SequenceMap({ record, features, circular, selection, active, choose, cuts, activeCut, chooseCut, zoom, zh }: {
  record: SequenceRecord;
  features: ReturnType<typeof featureTracks>;
  circular: boolean;
  selection: readonly BaseSpan[];
  active: number | null;
  choose(feature: SequenceFeature): void;
  cuts: readonly RestrictionSite[];
  activeCut: number | null;
  chooseCut(site: RestrictionSite): void;
  zoom: number;
  zh: boolean;
}) {
  const length = record.bases.length;
  const radius = cuts.length ? 139 : 194;
  const cutGroups = new Map<number, RestrictionSite[]>();
  if (circular) for (const site of cuts) {
    const group = cutGroups.get(site.top);
    if (group) group.push(site);
    else cutGroups.set(site.top, [site]);
  }
  const approximateTick = length / 8;
  const magnitude = 10 ** Math.floor(Math.log10(approximateTick));
  const tick = Math.max(1, Math.round(approximateTick / magnitude) * magnitude);
  const ticks = Array.from({ length: Math.ceil(length / tick) }, (_, index) => index * tick);
  const x = (offset: number) => 34 + 412 * offset / length;
  const axisY = 58;
  const numTracks = Math.max(1, ...features.map(({ track }) => track + 1));
  const spacing = Math.min(23, (radius - 55) / numTracks);
  const width = Math.min(11, spacing * 0.64);
  const count = length.toLocaleString(zh ? 'zh-CN' : 'en');
  return <svg className="sequence-map-svg" data-map={circular ? 'circular' : 'linear'}
    style={{ width: circular ? `min(${zoom * 100}cqw, ${zoom * 100}cqh)` : `${zoom * 100}%` }} viewBox={circular ? '0 0 480 480' : `0 0 480 ${axisY + (numTracks + 1) * 27}`}
    role="group" aria-label={circular ? (zh ? '环形质粒图' : 'Circular plasmid map') : (zh ? '线性地图' : 'Linear sequence map')}>
    {circular ? <circle className="sequence-axis" cx={center} cy={center} r={radius} /> :
      <line className="sequence-axis" x1={x(0)} y1={axisY} x2={x(length)} y2={axisY} />}
    {ticks.map(offset => {
      const [ax, ay] = circular ? point(offset, length, radius) : [x(offset), axisY];
      const [bx, by] = circular ? point(offset, length, radius + 7) : [ax, ay - 7];
      const [tx, ty] = circular ? point(offset, length, radius + (cuts.length ? -10 : 22)) : [ax, ay - 18];
      return <g key={offset} className="sequence-map-tick">
        <line x1={ax} y1={ay} x2={bx} y2={by} />
        <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle">{(offset + 1).toLocaleString(zh ? 'zh-CN' : 'en')}</text>
      </g>;
    })}
    <g className="sequence-map-title" textAnchor="middle">
      {circular && <text x={center} y={center - 6}>{record.name}</text>}
      <text className="sequence-map-length" x={center} y={circular ? center + 19 : 19}>{count} bp</text>
    </g>
    {circular && ([-1, 1] as const).flatMap(side => {
      const anchors = [...cutGroups].map(([offset, sites]) => ({
        offset, sites, p: point(offset, length, radius + 2), elbow: point(offset, length, radius + 24),
      })).filter(item => (item.p[0] < center ? -1 : 1) === side).sort((a, b) => a.elbow[1] - b.elbow[1]);
      const gap = Math.min(17, 440 / Math.max(1, anchors.length - 1));
      const labelX = side === 1 ? 411 : 69;
      let previous = 20 - gap;
      return anchors.map(({ offset, sites, p, elbow }, index) => {
        const y = Math.min(460 - (anchors.length - index - 1) * gap, Math.max(previous + gap, elbow[1]));
        previous = y;
        const names = sites.map(site => site.name).join(' / ');
        const coordinate = cutBoundary(offset, length);
        return <g key={offset} role="button" tabIndex={0} className="sequence-cut" aria-pressed={activeCut === offset}
          aria-label={`${names} · ${coordinate}`} onClick={() => chooseCut(sites[0])}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseCut(sites[0]); } }}>
          <title>{sites.map(site => `${site.name} · 5′ ${coordinate} · 3′ ${cutBoundary(site.bottom, length)}`).join('\n')}</title>
          <path d={`M ${p} L ${elbow} L ${labelX - side * 4} ${y}`} />
          <circle cx={p[0]} cy={p[1]} r={1.65} />
          <text x={labelX} y={y} textAnchor={side === 1 ? 'start' : 'end'} dominantBaseline="central">{names}</text>
        </g>;
      });
    })}
    {features.map(({ feature, track }) => {
      const selected = active === feature.id;
      const r = radius - 21 - track * spacing;
      const y = axisY + (track + 1) * 26;
      return <g key={feature.id} role="button" tabIndex={0} aria-label={feature.label} aria-pressed={selected}
        data-color={featureColor(feature.kind)} className="sequence-map-feature" onClick={() => choose(feature)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(feature); } }}>
        <title>{feature.label} · {feature.kind} · {feature.spans.map(span => `${span.start + 1}–${span.end}`).join(', ')} · {feature.strand === 1 ? '+' : '−'}</title>
        {feature.spans.map((span, index) => {
          const direction = feature.strand;
          const terminal = direction === 1 ? index === feature.spans.length - 1 : index === 0;
          const midpoint = (span.start + span.end) / 2;
          const spanWidth = (span.end - span.start) / length * (circular ? 2 * Math.PI * r : 412);
          const tip = direction === 1 ? span.end : span.start;
          const tipWidth = Math.min(8, spanWidth / 2);
          const tipOffset = tipWidth / (circular ? 2 * Math.PI * r : 412) * length;
          const beforeTip = tip - direction * tipOffset;
          const head = circular ? [
            point(tip, length, r),
            point(beforeTip, length, r - width / 2 - 1),
            point(beforeTip, length, r + width / 2 + 1),
          ] : [[x(tip), y], [x(beforeTip), y - width / 2 - 1], [x(beforeTip), y + width / 2 + 1]];
          const start = terminal && direction === -1 ? beforeTip : span.start;
          const end = terminal && direction === 1 ? beforeTip : span.end;
          const path = circular ? circularArc(start, end, length, r) : `M ${x(start)} ${y} H ${x(end)}`;
          const [lx, ly] = circular ? point(midpoint, length, r) : [x(midpoint), y];
          const rotation = midpoint / length * 360;
          const label = feature.label.length > 23 ? feature.label.slice(0, 22) + '…' : feature.label;
          return <g key={index}>
            <path className="sequence-hit" d={path} />
            <path className="sequence-feature-stroke" d={path} strokeWidth={width} />
            {terminal && spanWidth > 5 && <polygon className="sequence-feature-tip" points={head.map(p => p.join(',')).join(' ')} />}
            {width >= 9 && spanWidth > label.length * 6 + 14 && <text className="sequence-feature-label"
              x={lx} y={ly} textAnchor="middle" dominantBaseline="central"
              transform={circular ? `rotate(${rotation > 90 && rotation < 270 ? rotation - 180 : rotation} ${lx} ${ly})` : undefined}>{label}</text>}
          </g>;
        })}
      </g>;
    })}
    {selection.map((span, index) => <path key={index} className="sequence-map-selection"
      d={circular ? circularArc(span.start, span.end, length, radius - 5) : `M ${x(span.start)} ${axisY + 5} H ${x(span.end)}`} />)}
  </svg>;
}
