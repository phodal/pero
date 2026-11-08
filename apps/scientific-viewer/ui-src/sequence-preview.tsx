import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type MouseEvent } from 'react';
import { Button, Feedback, Input, Split, SplitPane, ToggleGroup, ToggleGroupItem } from '@pero/app-sdk/ui';
import { complement, parseGenBank, type BaseSpan, type SequenceFeature, type SequenceRecord } from './sequence-record';
import { annotatedResidues, type AnnotatedResidue } from './sequence-translation';
import { cutBoundary, restrictionSites, type RestrictionSite } from './sequence-restriction';
import { featureColor, featureTracks, SequenceMap } from './sequence-map';
import './sequence-preview.css';

type Selection = Readonly<{ spans: readonly BaseSpan[]; strand: 1 | -1; feature: number | null }>;

export function SequencePreview({ text, name, zh }: { text: string; name: string; zh: boolean }) {
  const parsed = useMemo(() => {
    try { return { record: parseGenBank(text) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [text]);
  if (!parsed.record) return <div className="artifact-empty"><Feedback kind="error">{parsed.error}</Feedback></div>;
  return <SequenceWorkspace record={parsed.record} name={name.replace(/\.[^.]+$/, '')} zh={zh} />;
}

function SequenceWorkspace({ record, name, zh }: { record: SequenceRecord; name: string; zh: boolean }) {
  const [map, setMap] = useState(record.circular ? 'circular' : 'linear');
  const [zoom, setZoom] = useState(1);
  const [showCuts, setShowCuts] = useState(true);
  const [showTranslation, setShowTranslation] = useState(true);
  const [activeSite, setActiveSite] = useState<RestrictionSite | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [query, setQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [visible, setVisible] = useState({ top: 0, width: 0, height: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const baseMeasure = useRef<HTMLSpanElement>(null);
  const translationAnchor = useRef<number | null>(null);
  const drag = useRef<{ base: number; strand: 1 | -1; pointer: number } | null>(null);
  const recordTitle = name || record.name;
  const length = record.bases.length;
  const tracks = useMemo(() => featureTracks(record.features), [record.features]);
  const opposite = useMemo(() => complement(record.bases), [record.bases]);
  const basesPerRow = Math.max(10, Math.min(100, Math.floor(visible.width / 10) * 10));
  const cutSites = useMemo(() => record.circular ? restrictionSites(record) : [], [record]);
  const proteins = useMemo(() => featureTracks(record.features.filter(feature => feature.translation))
    .map(({ feature, track }) => ({ feature, track, residues: annotatedResidues(feature) })), [record.features]);
  const translationRows = useMemo(() => {
    const rows = new Map<number, { feature: SequenceFeature; track: number; residue: AnnotatedResidue; span: BaseSpan }[]>();
    for (const { feature, track, residues } of proteins) for (const residue of residues) for (const span of residue.spans) {
      for (let row = Math.floor(span.start / basesPerRow); row <= Math.floor((span.end - 1) / basesPerRow); row++) {
        const entry = { feature, track, residue, span };
        const entries = rows.get(row);
        if (entries) entries.push(entry);
        else rows.set(row, [entry]);
      }
    }
    return rows;
  }, [basesPerRow, proteins]);
  const proteinTracks = showTranslation ? Math.max(0, ...proteins.map(protein => protein.track + 1)) : 0;
  const rowHeight = 100 + 20 * proteinTracks;
  const rowCount = Math.ceil(length / basesPerRow);
  const first = Math.max(0, Math.floor(visible.top / rowHeight) - 1);
  const last = Math.min(rowCount, Math.ceil((visible.top + visible.height) / rowHeight) + 1);
  useEffect(() => {
    const node = viewport.current;
    const measure = baseMeasure.current;
    if (!node || !measure) return;
    const sync = () => setVisible({ top: node.scrollTop, height: node.clientHeight,
      width: (node.clientWidth - 32) / (measure.getBoundingClientRect().width / 10) });
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    observer.observe(measure);
    sync();
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (translationAnchor.current === null || !viewport.current) return;
    viewport.current.scrollTop = Math.floor(translationAnchor.current / basesPerRow) * rowHeight;
    translationAnchor.current = null;
  }, [rowHeight, basesPerRow]);

  function reveal(offset: number) {
    viewport.current?.scrollTo({ top: Math.floor(offset / basesPerRow) * rowHeight });
  }
  function choose(feature: SequenceFeature) {
    setActiveSite(null);
    setSelection({ ...feature, feature: feature.id });
    setCopyStatus('');
    reveal(feature.strand === 1 ? feature.spans[0].start : feature.spans.at(-1)!.end - 1);
  }
  function chooseCut(site: RestrictionSite) {
    setActiveSite(site);
    setSelection({ spans: site.spans, strand: site.strand, feature: null });
    setCopyStatus('');
    reveal(site.spans[0].start);
  }
  function search() {
    const term = query.trim();
    if (!term) return;
    const position = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(term);
    if (position) {
      const start = Number(position[1]) - 1;
      const end = Number(position[2] ?? position[1]);
      if (start >= 0 && end > start && end <= length) {
        setActiveSite(null);
        setSelection({ spans: [{ start, end }], strand: 1, feature: null });
        reveal(start); setSearchStatus(''); setCopyStatus(''); return;
      }
    } else {
      const feature = record.features.find(feature => feature.label.toLowerCase().includes(term.toLowerCase()));
      if (feature) { choose(feature); setSearchStatus(''); return; }
      const site = cutSites.find(site => site.name.toLowerCase() === term.toLowerCase());
      if (site) { chooseCut(site); setSearchStatus(''); return; }
      const motif = term.toUpperCase();
      if (/^[ACGTRYSWKMBDHVN]+$/.test(motif) && motif.length <= length) {
        const sequence = record.circular ? record.bases + record.bases.slice(0, motif.length - 1) : record.bases;
        const reverse = [...complement(motif)].reverse().join('');
        const forwardIndex = sequence.indexOf(motif);
        const start = forwardIndex >= 0 ? forwardIndex : sequence.indexOf(reverse);
        if (start >= 0) {
          const end = start + motif.length;
          const spans = end <= length ? [{ start, end }] : [{ start, end: length }, { start: 0, end: end - length }];
          setActiveSite(null);
          setSelection({ spans, strand: forwardIndex >= 0 ? 1 : -1, feature: null });
          reveal(start); setSearchStatus(''); setCopyStatus(''); return;
        }
      }
    }
    setSearchStatus(zh ? '没有匹配的碱基、坐标或注释。' : 'No matching bases, coordinates, or annotations.');
  }
  function baseAt(target: Element, x: number) {
    const line = target.closest<HTMLElement>('[data-base-start]');
    if (!line) return null;
    const count = Number(line.dataset.baseCount);
    const box = line.getBoundingClientRect();
    const index = Math.max(0, Math.min(count - 1, Math.floor((x - box.left) / box.width * count)));
    return { base: Number(line.dataset.baseStart) + index, strand: line.dataset.strand === '-' ? -1 as const : 1 as const };
  }
  function selectPointer(event: PointerEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    if (event.type === 'pointerdown') {
      const hit = baseAt(event.target as Element, event.clientX);
      if (!hit || event.button !== 0 || event.pointerType === 'touch') return;
      event.preventDefault();
      drag.current = { ...hit, pointer: event.pointerId };
      setActiveSite(null);
      container.setPointerCapture(event.pointerId);
      setCopyStatus('');
    }
    const anchor = drag.current;
    if (!anchor || anchor.pointer !== event.pointerId) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const hit = element && container.contains(element) ? baseAt(element, event.clientX) : null;
    if (hit) setSelection({ spans: [{ start: Math.min(anchor.base, hit.base), end: Math.max(anchor.base, hit.base) + 1 }],
      strand: anchor.strand, feature: null });
    if (event.type === 'pointerup' || event.type === 'pointercancel') drag.current = null;
  }
  function copySelection(event: MouseEvent<HTMLButtonElement>) {
    if (!selection) return;
    const bases = selection.spans.map(({ start, end }) => record.bases.slice(start, end)).join('');
    const value = selection.strand === -1 ? [...complement(bases)].reverse().join('') : bases;
    const trigger = event.currentTarget;
    const field = document.createElement('textarea');
    field.value = value;
    field.readOnly = true;
    field.className = 'sr-only';
    trigger.parentElement?.append(field);
    field.select();
    // The App runs in a sandboxed frame. Keep copying tied to the user's gesture.
    const copied = document.execCommand('copy');
    field.remove();
    trigger.focus();
    setCopyStatus(copied ? (zh ? '已复制' : 'Copied') : (zh ? '无法访问剪贴板' : 'Clipboard unavailable'));
  }
  const selectedLength = selection?.spans.reduce((sum, span) => sum + span.end - span.start, 0);
  const t = {
    sequence: zh ? '碱基序列' : 'Base sequence',
    search: zh ? '搜索碱基、坐标或注释' : 'Find bases, coordinates or annotations',
    map: zh ? '地图视图' : 'Map view',
    circle: zh ? '质粒' : 'Plasmid',
    linear: zh ? '线性图' : 'Linear map',
    features: zh ? '注释' : 'Annotations',
    translation: zh ? 'CDS 翻译' : 'CDS translation',
    cutSites: zh ? '预测酶切位点' : 'Predicted cut sites',
  };
  return <section className="sequence-preview" aria-label={recordTitle}>
    <header className="sequence-header">
      <div className="sequence-heading"><strong>{recordTitle}</strong><span>{length.toLocaleString()} bp{record.accession && ` · ${record.accession}`}</span></div>
      <div className="sequence-search" role="search">
        <Input type="search" aria-label={t.search} placeholder={t.search} value={query}
          onChange={event => { setQuery(event.target.value); setSearchStatus(''); }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) search(); }} />
        <Button onClick={search} disabled={!query.trim()}>{zh ? '定位' : 'Find'}</Button>
      </div>
    </header>
    {searchStatus && <p className="sequence-message" role="status">{searchStatus}</p>}
    {record.skipped > 0 && <p className="sequence-message" role="status">{zh ? `${record.skipped} 个注释的位置格式暂不支持，可在源文件中查看。` : `${record.skipped} annotations use unsupported locations. See the source file.`}</p>}
    <Split className="sequence-split" storageKey="pero-sequence-split" collapseBelow={690}>
      <SplitPane id="sequence-bases" size={520} min={320} stackedBasis="34%" resizeLabel={zh ? '调整序列栏宽度' : 'Resize sequence pane'}>
        <div className="sequence-pane">
          <div className="sequence-pane-bar"><strong>{t.sequence}</strong>
            {proteins.length > 0 && <Button variant="ghost" aria-pressed={showTranslation} onClick={() => {
              translationAnchor.current = Math.floor((viewport.current?.scrollTop ?? 0) / rowHeight) * basesPerRow;
              setShowTranslation(!showTranslation);
            }}>{t.translation}</Button>}
          </div>
          <div className="sequence-bases" ref={viewport} tabIndex={0} aria-label={t.sequence}
            onScroll={event => { const top = event.currentTarget.scrollTop; setVisible(previous => ({ ...previous, top })); }}
            onPointerDown={selectPointer} onPointerMove={selectPointer} onPointerUp={selectPointer} onPointerCancel={selectPointer}
            onLostPointerCapture={() => { drag.current = null; }}>
            <span className="sequence-measure" aria-hidden="true" ref={baseMeasure}>AAAAAAAAAA</span>
            <div className="sequence-rows" style={{ height: rowCount * rowHeight }}>
              {Array.from({ length: last - first }, (_, index) => {
                const row = first + index;
                const start = row * basesPerRow;
                const end = Math.min(start + basesPerRow, length);
                const size = end - start;
                const spans = (selection?.spans ?? []).filter(span => span.end > start && span.start < end);
                const lines = [[record.bases, '+'], [opposite, '-']] as const;
                return <div className="sequence-row" key={row} style={{ top: row * rowHeight, height: rowHeight }}>
                  <div className="sequence-ruler" style={{ width: `${size}ch` }}>
                    {Array.from({ length: Math.ceil(size / 10) }, (_, i) => <span key={i} style={{ left: `${i * 10}ch` }}>{start + i * 10 + 1}</span>)}
                  </div>
                  {lines.map(([bases, strand]) => <div className="sequence-base-line" key={strand}>
                    <span aria-hidden="true" className="sequence-direction">{strand === '+' ? '5′' : '3′'}</span>
                    <span className="sequence-base-text" data-base-start={start} data-base-count={size} data-strand={strand}>
                      {spans.map(span => <span key={span.start} className="sequence-base-highlight" aria-hidden="true"
                        style={{ left: `${Math.max(start, span.start) - start}ch`, width: `${Math.min(end, span.end) - Math.max(start, span.start)}ch` }} />)}
                      <span>{bases.slice(start, end)}</span>
                    </span>
                  </div>)}
                  {proteinTracks > 0 && <div className="sequence-translation" aria-label={t.translation}
                    style={{ width: `${size}ch`, height: 20 * proteinTracks - 3 }}>
                    {(translationRows.get(row) ?? []).map(({ feature, track, residue, span }) => {
                      const from = Math.max(start, span.start);
                      const to = Math.min(end, span.end);
                      const { amino, index, anchor } = residue;
                      const residueClass = 'DE'.includes(amino) ? 'acidic' : 'KRH'.includes(amino) ? 'basic'
                        : 'STNQCY'.includes(amino) ? 'polar' : 'AGVILMFWP'.includes(amino) ? 'nonpolar' : 'other';
                      return <span className="sequence-residue" key={`${feature.id}:${index}:${span.start}`}
                        data-class={residueClass} data-protein={feature.label} data-residue={index}
                        title={`${feature.label} CDS · ${index} ${amino} · ${residue.spans.map(piece => `${piece.start + 1}–${piece.end}`).join(', ')}`}
                        style={{ left: `${from - start}ch`, width: `${to - from}ch`, top: 20 * track }}>
                        {anchor >= from && anchor < to ? amino : ''}
                      </span>;
                    })}
                  </div>}
                  <div className="sequence-row-features" style={{ width: `${size}ch` }}>
                    {tracks.flatMap(({ feature, track }) => feature.spans.flatMap(span => {
                      const a = Math.max(start, span.start);
                      const b = Math.min(end, span.end);
                      return a < b && (track < 2 || feature.id === selection?.feature) ? [
                        <button type="button" key={`${feature.id}:${span.start}`} title={feature.label} aria-label={feature.label}
                          aria-pressed={selection?.feature === feature.id} data-color={featureColor(feature.kind)} onClick={() => choose(feature)}
                          style={{ left: `${a - start}ch`, width: `${b - a}ch`, top: Math.min(track, 1) * 13 }}>
                          {b - a >= 4 ? feature.label : ''}
                        </button>,
                      ] : [];
                    }))}
                  </div>
                </div>;
              })}
            </div>
          </div>
        </div>
      </SplitPane>
      <SplitPane id="sequence-map" min={340}>
        <div className="sequence-pane">
          <div className="sequence-pane-bar">
            <ToggleGroup type="single" aria-label={t.map} value={map} onValueChange={value => { if (value) { setMap(value); setZoom(1); } }}>
              {record.circular && <ToggleGroupItem value="circular">{t.circle}</ToggleGroupItem>}
              <ToggleGroupItem value="linear">{t.linear}</ToggleGroupItem>
            </ToggleGroup>
            {map === 'circular' && cutSites.length > 0 && <Button variant="ghost" aria-pressed={showCuts}
              onClick={() => setShowCuts(!showCuts)}>{t.cutSites}</Button>}
            <div className="sequence-zoom">
              <Button variant="ghost" aria-label={zh ? '缩小地图' : 'Zoom out map'} disabled={zoom <= 1} onClick={() => setZoom(value => value - 0.25)}>−</Button>
              <Button variant="ghost" aria-label={zh ? '重置地图缩放' : 'Reset map zoom'} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
              <Button variant="ghost" aria-label={zh ? '放大地图' : 'Zoom in map'} disabled={zoom >= 2} onClick={() => setZoom(value => value + 0.25)}>+</Button>
            </div>
          </div>
          <div className="sequence-map-scroll">
            <SequenceMap record={{ ...record, name: recordTitle }} features={tracks} circular={map === 'circular'}
              selection={selection?.spans ?? []} active={selection?.feature ?? null} choose={choose}
              cuts={showCuts && map === 'circular' ? cutSites : []} activeCut={activeSite?.top ?? null} chooseCut={chooseCut} zoom={zoom} zh={zh} />
          </div>
          {record.features.length > 0 && <details className="sequence-annotations">
            <summary>{t.features} <span>{record.features.length}</span></summary>
            <div className="sequence-annotation-list">
              {record.features.map(feature => <Button key={feature.id} variant="ghost" aria-pressed={selection?.feature === feature.id}
                data-color={featureColor(feature.kind)} title={feature.label} onClick={() => choose(feature)}>
                <span>{feature.label}</span><small>{feature.spans.map(span => `${span.start + 1}–${span.end}`).join(', ')}</small>
              </Button>)}
            </div>
          </details>}
        </div>
      </SplitPane>
    </Split>
    <footer className="sequence-footer">
      {activeSite && <span role="status">{activeSite.name} · 5′ {cutBoundary(activeSite.top, length)} · 3′ {cutBoundary(activeSite.bottom, length)}</span>}
      <span role="status">{selection ? `${selection.spans.map(span => `${span.start + 1}–${span.end}`).join(', ')} · ${selection.strand === 1 ? '+' : '−'} · ${selectedLength?.toLocaleString()} bp`
        : (zh ? '选择碱基或注释' : 'Select bases or an annotation')}</span>
      {selection && <Button variant="ghost" onClick={copySelection}>{zh ? '复制碱基' : 'Copy bases'}</Button>}
      {copyStatus && <span role="status">{copyStatus}</span>}
    </footer>
  </section>;
}
