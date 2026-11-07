import { Disclosure, Button } from '@pero/app-sdk/ui';
import React, { useEffect, useRef, useState } from 'react';
import { structureText, moleculeRecords, type Asset } from './files';
import { useAppApi } from '@pero/app-sdk';
import { Split, SplitPane } from '@pero/app-sdk/ui';
import { createStructureEngine } from './structure-engine';
import './molecular.css';
type Viewer = Awaited<ReturnType<typeof createStructureEngine>>;
type MoleculeRow = { input: string; svg?: string; descriptors?: Record<string, number>; error?: string };
type MoleculeResult = { engine: { name: string; version: string }; rows: MoleculeRow[] };
const descriptorLabels: Record<string, { label: string; unit?: string }> = {
  MolWt: { label: 'Molar mass', unit: 'g/mol' },
  ExactMolWt: { label: 'Exact mass', unit: 'Da' },
  MolLogP: { label: 'Log P' },
  TPSA: { label: 'Polar surface area', unit: 'Å²' },
  NumHDonors: { label: 'H-bond donors' },
  NumHAcceptors: { label: 'H-bond acceptors' },
  NumRotatableBonds: { label: 'Rotatable bonds' },
};
export function Molecules({ asset }: { asset: Asset }) {
  const api = useAppApi(), generation = useRef(0);
  const [rows, setRows] = useState<MoleculeRow[]>([]), [engine, setEngine] = useState('');
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState(''), [status, setStatus] = useState('loading'), [retry, setRetry] = useState(0);
  const format = /\.sdf$/i.test(asset.name) ? 'SDF' : /\.mol$/i.test(asset.name) ? 'MOL' : 'SMILES';
  useEffect(() => {
    const current = ++generation.current; setRows([]); setError(''); setStatus('loading'); setEngine(''); setSelected(0);
    void (async () => {
      const records = moleculeRecords(asset.name, asset.bytes);
      const format = /\.sdf$/i.test(asset.name) ? 'sdf' : /\.mol$/i.test(asset.name) ? 'mol' : 'smiles';
      const result = await api.post<MoleculeResult>('/api/molecules', { format, records });
      if (current === generation.current) { setRows(result.rows); setEngine(`${result.engine.name} ${result.engine.version}`); setStatus('ready'); }
    })().catch(error => { if (current === generation.current) { setError(String(error)); setStatus('failed'); } });
    return () => { generation.current++; };
  }, [asset, api, retry]);
  const current = rows[selected], invalid = rows.filter(row => row.error).length;
  return <section className="sv-molecule-workspace" aria-label="Molecules">
    <header className="sv-molecule-section-heading">
      <h2>Molecules</h2>
      {status === 'ready' && <p className="sv-molecule-count">{rows.length} {rows.length === 1 ? 'record' : 'records'}{invalid > 0 && <><span>{rows.length - invalid} rendered</span><span className="sv-molecule-invalid-count">{invalid} invalid</span></>}<span>{format}</span></p>}
    </header>
    {error && <p role="alert">{error}</p>}
    {status === 'loading' && <div className="sv-molecule-load-state"><p role="status">Preparing molecule preview…</p><Button onClick={() => { generation.current++; setStatus('stopped'); }}>Stop waiting</Button></div>}
    {status === 'stopped' && <p role="status">Result discarded. The bounded local calculation may still finish.</p>}
    {(status === 'failed' || status === 'stopped') && <div><Button onClick={() => setRetry(value => value + 1)}>Retry molecule preview</Button></div>}
    {rows.length > 0 && <Split className="sv-molecule-layout" storageKey="scientific-viewer.sv-molecule-panes" collapseBelow={720}>
      <SplitPane as="section" id="sv-molecule-gallery" aria-label="Molecule structures" min={320} className="sv-molecule-gallery">
        <div className="sv-molecule-grid">
          {rows.map((row, index) => <article className="sv-molecule-card" key={index} data-status={row.error ? 'invalid' : 'ready'} data-selected={selected === index ? '' : undefined}>
            <Button variant="ghost" className="sv-molecule-select" aria-label={`Select Molecule ${index + 1}`} aria-pressed={selected === index} onClick={() => setSelected(index)}>
              <span className="sv-molecule-card-title"><span>Molecule {index + 1}</span>{selected === index && <span className="sv-molecule-selected-label">Selected</span>}</span>
              <span className="sv-molecule-canvas">{row.error ? <span className="sv-molecule-unavailable">No structure</span> : <img alt={`Molecule ${index + 1}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(row.svg!)}`} />}</span>
              {format === 'SMILES' && <code className="sv-molecule-input-preview">{row.input}</code>}
            </Button>
            {row.error && <p className="sv-molecule-record-error" role="alert">{row.error}</p>}
          </article>)}
        </div>
      </SplitPane>
      <SplitPane as="aside" id="sv-molecule-details" aria-label="Molecule details" min={240} size={280} resizeLabel="Resize molecule details" className="sv-molecule-inspector">
        {current && <>
          <h3>Molecule {selected + 1}</h3>
          {format === 'SMILES' ? <dl className="sv-molecule-source"><dt>SMILES</dt><dd><code>{current.input}</code></dd></dl> : <Disclosure variant="inline" className="sv-molecule-source-record" summary={<>Source record ({format})</>}><pre>{current.input}</pre></Disclosure>}
          {current.error ? <p className="sv-molecule-invalid-details">Descriptors unavailable for this record.</p> : <section aria-label="Computed descriptors" className="sv-molecule-properties">
            <h4>Computed descriptors</h4>
            <dl>{Object.entries(current.descriptors ?? {}).map(([key, value]) => {
              const descriptor = descriptorLabels[key];
              return <React.Fragment key={key}><dt>{descriptor?.label ?? key}</dt><dd><span title={String(value)}>{Number.isInteger(value) ? value : Number(value.toPrecision(7))}</span>{descriptor?.unit && <span className="sv-molecule-unit"> {descriptor.unit}</span>}</dd></React.Fragment>;
            })}</dl>
          </section>}
          <div className="sv-molecule-calculation-note"><p>{engine}</p><p>Computed values, not scientifically verified.</p></div>
        </>}
      </SplitPane>
    </Split>}
  </section>;
}
export function Structure({ asset }: { asset: Asset }) {
  const node = useRef<HTMLDivElement>(null), [status, setStatus] = useState('Loading Mol*…'), [error, setError] = useState('');
  useEffect(() => {
    let active = true, viewer: Viewer | undefined; setError(''); setStatus('Loading Mol*…');
    void (async () => {
      const text = structureText(asset.bytes);
      const next = await createStructureEngine(node.current!, setError);
      viewer = next; if (!active) { next.dispose(); return; }
      await next.loadStructureFromData(text, /\.pdb$/i.test(asset.name) ? 'pdb' : 'mmcif');
      if (active) setStatus('Structure ready');
    })().catch(error => { if (active) { setStatus('Preview unavailable'); setError(String(error)); } });
    return () => { active = false; viewer?.dispose(); };
  }, [asset]);
  return <section aria-label="Structure"><h2>Structure</h2><p role="status">{status}</p>{error && <p role="alert">{error}</p>}<div className="molecule-view" ref={node} /><p>Mol* geometry preview · Source and scientific interpretation unverified</p></section>;
}
