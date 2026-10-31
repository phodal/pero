import React, { useEffect, useRef, useState } from 'react';
import { structureText, blockStructureDrops, moleculeRecords, type Asset } from './files';
type Molecule = { is_valid(): boolean; get_svg(): string; get_descriptors(): string; delete(): void };
type RDKit = { get_mol(value: string): Molecule | null };
type Viewer = { plugin: { managers: { dragAndDrop: { addHandler(name: string, handler: () => boolean): void } } }; loadStructureFromData(value: string, format: string): Promise<void>; dispose(): void };
declare global { interface Window {
  initRDKitModule: (options: { locateFile: (path: string) => string }) => Promise<RDKit>;
  molstar: { Viewer: { create(element: HTMLElement, options: object): Promise<Viewer> } };
} }
let rdkit: Promise<RDKit> | undefined;
export function Molecules({ asset }: { asset: Asset }) {
  const [rows, setRows] = useState<{ input: string; svg?: string; descriptors?: string; error?: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; setRows([]); setError('');
    void (async () => {
      const entries = moleculeRecords(asset.name, asset.bytes);
      const kit = await (rdkit ??= window.initRDKitModule({ locateFile: path => new URL(path, location.href).href }));
      const result = entries.map(input => {
        let molecule: Molecule | null = null;
        try {
          molecule = kit.get_mol(input);
          if (!molecule?.is_valid()) return { input, error: 'Invalid molecule' };
          return { input, svg: molecule.get_svg(), descriptors: molecule.get_descriptors() };
        } catch { return { input, error: 'Invalid molecule' }; }
        finally { molecule?.delete(); }
      });
      if (active) setRows(result);
    })().catch(error => active && setError(String(error)));
    return () => { active = false; };
  }, [asset]);
  return <section aria-label="Molecules"><h2>Molecules</h2><p>RDKit computed descriptors · Not scientifically verified</p>{error && <p role="alert">{error}</p>}
    {!rows.length && !error && <p role="status">Loading RDKit…</p>}
    {rows.map((row, index) => <article key={index} data-status={row.error ? 'invalid' : 'ready'}><code>{row.input.slice(0, 200)}</code>{row.error ? <p role="alert">{row.error}</p> : <><img alt={`Molecule ${index + 1}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(row.svg!)}`} /><details><summary>Computed descriptors</summary><pre>{row.descriptors}</pre></details></>}</article>)}
  </section>;
}
export function Structure({ asset }: { asset: Asset }) {
  const node = useRef<HTMLDivElement>(null), [status, setStatus] = useState('Loading Mol*…'), [error, setError] = useState('');
  useEffect(() => {
    let active = true, viewer: Viewer | undefined; setError(''); setStatus('Loading Mol*…');
    void (async () => {
      const text = structureText(asset.bytes);
      const next = await window.molstar.Viewer.create(node.current!, { layoutIsExpanded: false, layoutShowControls: false, layoutShowLeftPanel: false, viewportShowControls: false, viewportShowSelectionMode: false, viewportShowSettings: false, viewportShowToggleFullscreen: false, volumeStreamingDisabled: true, layoutShowRemoteState: false, layoutShowSequence: true, layoutShowLog: false, viewportShowExpand: false, viewportShowScreenshotControls: false, extensions: [], showWelcomeToast: false });
      blockStructureDrops(next.plugin.managers.dragAndDrop, setError);
      viewer = next; if (!active) { next.dispose(); return; }
      await next.loadStructureFromData(text, /\.pdb$/i.test(asset.name) ? 'pdb' : 'mmcif');
      if (active) setStatus('Structure ready');
    })().catch(error => { if (active) { setStatus('Preview unavailable'); setError(String(error)); } });
    return () => { active = false; viewer?.dispose(); };
  }, [asset]);
  return <section aria-label="Structure"><h2>Structure</h2><p role="status">{status}</p>{error && <p role="alert">{error}</p>}<div className="molecule-view" ref={node} /><p>Mol* geometry preview · Source and scientific interpretation unverified</p></section>;
}
