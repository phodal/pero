import React, { useEffect, useRef, useState } from 'react';
import { structureText, moleculeRecords, type Asset } from './files';
import { useAppApi } from '@pero/app-sdk';
import { createStructureEngine } from './structure-engine';
type Viewer = Awaited<ReturnType<typeof createStructureEngine>>;
type MoleculeRow = { input: string; svg?: string; descriptors?: Record<string, number>; error?: string };
type MoleculeResult = { engine: { name: string; version: string }; rows: MoleculeRow[] };
export function Molecules({ asset }: { asset: Asset }) {
  const api = useAppApi(), generation = useRef(0);
  const [rows, setRows] = useState<MoleculeRow[]>([]), [engine, setEngine] = useState('');
  const [error, setError] = useState(''), [status, setStatus] = useState('loading'), [retry, setRetry] = useState(0);
  useEffect(() => {
    const current = ++generation.current; setRows([]); setError(''); setStatus('loading'); setEngine('');
    void (async () => {
      const records = moleculeRecords(asset.name, asset.bytes);
      const format = /\.sdf$/i.test(asset.name) ? 'sdf' : /\.mol$/i.test(asset.name) ? 'mol' : 'smiles';
      const result = await api.post<MoleculeResult>('/api/molecules', { format, records });
      if (current === generation.current) { setRows(result.rows); setEngine(`${result.engine.name} ${result.engine.version}`); setStatus('ready'); }
    })().catch(error => { if (current === generation.current) { setError(String(error)); setStatus('failed'); } });
    return () => { generation.current++; };
  }, [asset, api, retry]);
  return <section aria-label="Molecules"><h2>Molecules</h2><p>{engine || 'Local RDKit backend'} · Computed descriptors · Not scientifically verified</p>{error && <p role="alert">{error}</p>}
    {status === 'loading' && <><p role="status">Preparing molecule preview…</p><button onClick={() => { generation.current++; setStatus('stopped'); }}>Stop waiting</button></>}
    {status === 'stopped' && <p role="status">Result discarded. The bounded local calculation may still finish.</p>}
    {(status === 'failed' || status === 'stopped') && <button onClick={() => setRetry(value => value + 1)}>Retry molecule preview</button>}
    {rows.map((row, index) => <article key={index} data-status={row.error ? 'invalid' : 'ready'}><code>{row.input.slice(0, 200)}</code>{row.error ? <p role="alert">{row.error}</p> : <><img alt={`Molecule ${index + 1}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(row.svg!)}`} /><details><summary>Computed descriptors</summary><pre>{JSON.stringify(row.descriptors, null, 2)}</pre></details></>}</article>)}
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
