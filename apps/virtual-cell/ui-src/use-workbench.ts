import { useEffect, useRef, useState } from 'react';
import { downloadFile, useAppApi, useAppInfo } from '@pero/app-sdk';
import type { Translate } from './messages';
import type { Bundle } from './science';

const ROOT = '/api';
export type InputRevision = { id: string; source: { id: string; revision: string }; genes: number; conditions: number; counts: Record<string, number>; hasPlan: boolean; predictions: number; datasetDigest: string; specDigest: string; splitDigest: string };
export type Output = { id?: string; operation: string; inputId?: string; result: any; content?: string; sourceHashes?: Record<string, string>; environment?: Record<string, string> };

export function useWorkbench(t: Translate) {
  const api = useAppApi(), { active } = useAppInfo();
  const [items, setItems] = useState<InputRevision[]>([]), [selected, setSelected] = useState('');
  const [output, setOutput] = useState<Output | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<{ id: string; bundle: Bundle } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const gate = useRef(false);
  const input = items.find(i => i.id === selected);
  async function act(fn: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e: any) { setError(e?.message || String(e)); }
    finally { gate.current = false; setBusy(false); }
  }
  async function refresh() {
    const data = await api.get<{ items: InputRevision[] }>(`${ROOT}/inputs`);
    setItems(data.items); setSelected(prev => data.items.some(i => i.id === prev) ? prev : data.items[0]?.id ?? '');
    setRefreshKey(key => key + 1);
  }
  useEffect(() => { if (active) void act(refresh); }, [active]);
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    if (selected && active) api.get<{ bundle: Bundle }>(`${ROOT}/artifacts/${selected}`).then(doc => {
      if (!cancelled) setLoaded({ id: selected, bundle: doc.bundle });
    }).catch(e => { if (!cancelled) setError(e?.message || String(e)); });
    return () => { cancelled = true; };
  }, [selected, active, refreshKey]);
  async function load(documents: string[]) {
    const revision = await api.post<InputRevision>(`${ROOT}/inputs`, { documents });
    await refresh(); setSelected(revision.id); setOutput(null);
  }
  const choose = (id: string) => { setSelected(id); setOutput(null); setError(''); };
  const example = () => act(async () => { const doc = await api.get<{ content: string }>(`${ROOT}/example`); await load([doc.content]); });
  const importFiles = (files: File[]) => act(async () => {
    if (files.reduce((n, f) => n + f.size, 0) > 16 * 1024 * 1024) throw new Error(t('fileLimit'));
    await load(await Promise.all(files.map(file => file.text())));
  });
  const run = (operation: string) => act(async () => {
    if (!input) return;
    const result = await api.post<Output>(`${ROOT}/execute`, { inputId: input.id, operation });
    setOutput(result);
  });
  const evidence = (qc = false) => act(async () => {
    const doc = await api.get<{ content: string }>(`${ROOT}/evidence/${qc ? 'exclude_bad_coverage' : 'all'}`);
    setOutput({ operation: 'evidence', result: JSON.parse(doc.content), content: doc.content });
  });
  const exportOutput = () => act(async () => {
    if (!output) return;
    const doc = output.id ? await api.get<{ content: string }>(`${ROOT}/artifacts/${output.id}/export`) : { content: output.content! };
    downloadFile(`virtual-cell-${output.operation}-${output.id?.slice(0, 12) ?? 'norman'}.json`, doc.content, 'application/json');
  });
  const exportInputs = () => act(async () => {
    if (!input) return;
    const doc = await api.get<{ content: string }>(`${ROOT}/artifacts/${input.id}/export`);
    downloadFile(`virtual-cell-inputs-${input.id.slice(0, 12)}.json`, doc.content, 'application/json');
  });
  return { items, input, bundle: loaded?.id === selected ? loaded.bundle : null, selected, choose, output, error, busy, refresh: () => act(refresh), example, importFiles, run, evidence, exportOutput, exportInputs };
}
