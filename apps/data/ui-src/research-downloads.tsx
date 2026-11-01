import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppDataChanged } from '@pero/app-sdk';
import { Button, Checkbox, Feedback, FilePicker, Toolbar } from '@pero/app-sdk/ui';
import './research-downloads.css';

type Source = { id: string; name: string; kind: string; size: number; license: string; revision: string; sourceUrl: string };
type Asset = { id: string; name: string; source: string; revision: string; sha256: string; size: number; localAvailable: boolean };
type Job = { id: string; sourceId: string; status: string; received: number; total: number; error: string };
type State = { preparedSources?: Source[]; assets: Asset[]; download: Job | null };
const detail = (error: unknown) => error instanceof Error ? error.message : String(error);
const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

export function ResearchDownloads() {
  const api = useAppApi();
  const [sources, setSources] = useState<Source[]>([]), [state, setState] = useState<State>({ assets: [], download: null });
  const [selected, setSelected] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [warnings, setWarnings] = useState<string[]>([]);
  const alive = useRef(true), pending = useRef(false);
  const source = sources.find(item => item.id === selected), running = state.download?.status === 'running';
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function refresh() {
    const value = await api.post<State>('/api/research-assets', { action: 'status' });
    if (alive.current) { setState(value); if (value.preparedSources) setSources(value.preparedSources); }
  }
  useEffect(() => { void refresh().catch(error => { if (alive.current) setError(detail(error)); }); }, [api]);
  useAppDataChanged(() => { void refresh().catch(error => { if (alive.current) setError(detail(error)); }); });
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await api.post<State>('/api/research-assets', { action: 'status' });
        if (!stopped) {
          setState(value);
          if (value.download?.status === 'running') timer = setTimeout(() => void poll(), 1000);
        }
      } catch (error) { if (!stopped) setError(detail(error)); }
    }
    timer = setTimeout(() => void poll(), 500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, running, state.download?.id]);

  async function load(file: File) {
    if (pending.current) return;
    pending.current = true; setBusy('prepare'); setError(''); setWarnings([]); setSelected(''); setConfirmed(false);
    try {
      if (file.size > 65536) throw new Error('Download plans must be smaller than 64 KiB.');
      const value: unknown = JSON.parse(await file.text());
      if (!value || typeof value !== 'object' || !('schema' in value) || value.schema !== 'pero.research-assets.v1'
          || !('resources' in value) || !Array.isArray(value.resources) || !value.resources.length || value.resources.length > 8) {
        throw new Error('Choose a Paper download plan containing 1–8 model or dataset references.');
      }
      const result = await api.post<{ sources: Source[]; warnings: string[] }>('/api/research-assets', { action: 'prepare', resources: value.resources });
      if (alive.current) { setSources(result.sources); setWarnings(result.warnings); }
    } catch (error) { if (alive.current) setError(detail(error)); }
    finally { pending.current = false; if (alive.current) setBusy(''); }
  }
  async function download() {
    if (pending.current || !source || !confirmed || running) return;
    pending.current = true; setBusy('download'); setError('');
    try {
      const value = await api.post<State>('/api/research-assets', { action: 'download', sourceId: source.id, confirm: true });
      if (alive.current) { setState(value); setConfirmed(false); }
    } catch (error) { if (alive.current) setError(detail(error)); }
    finally { pending.current = false; if (alive.current) setBusy(''); }
  }
  async function cancel() {
    if (pending.current) return;
    pending.current = true; setBusy('cancel');
    try { await api.post('/api/research-assets', { action: 'cancel' }); await refresh(); }
    catch (error) { if (alive.current) setError(detail(error)); }
    finally { pending.current = false; if (alive.current) setBusy(''); }
  }
  const local = source && state.assets.find(asset => asset.source === source.sourceUrl && asset.revision === source.revision && asset.localAvailable);
  return <section className="data-research" aria-label="Research downloads">
    <Toolbar><FilePicker label="Open download plan" emptyLabel="Choose a Paper resource plan" accept=".json,application/json" busy={!!busy} onFile={file => void load(file)}/>
      <Button disabled={!!busy} onClick={() => void refresh().catch(error => setError(detail(error)))}>Refresh</Button></Toolbar>
    {error && <Feedback kind="error">{error}</Feedback>}
    {warnings.map((warning, index) => <Feedback key={index}>{warning}</Feedback>)}
    {!sources.length && !busy && <p>Export a download plan from Paper → Add papers → Link. Opening it fetches metadata only.</p>}
    {!!sources.length && <div className="data-research-table"><table><thead><tr><th scope="col">File</th><th scope="col">Size</th><th scope="col">License</th></tr></thead><tbody>
      {sources.map(item => <tr key={item.id}><td><label><input type="radio" name="research-file" checked={selected === item.id} disabled={!!busy || running}
        onChange={() => { setSelected(item.id); setConfirmed(false); }}/>{item.name}</label><small>{item.kind} · {item.revision.slice(0, 12)}</small></td><td>{size(item.size)}</td><td>{item.license}</td></tr>)}
    </tbody></table></div>}
    {source && <div className="data-research-confirm"><a href={source.sourceUrl} target="_blank" rel="noreferrer">Review source and license</a>
      {local ? <p role="status">Already available locally · SHA-256 <code>{local.sha256}</code></p> : <>
        <label><Checkbox checked={confirmed} disabled={!!busy || running} onCheckedChange={setConfirmed}/>Download {size(source.size)} with license “{source.license}”.</label>
        <Button variant="primary" busy={busy === 'download'} disabled={!!busy || running || !confirmed} onClick={() => void download()}>Download selected file</Button>
      </>}
    </div>}
    {state.download && <div className="data-research-progress" aria-live="polite"><p>{state.download.status} · {size(state.download.received)} / {size(state.download.total)}</p>
      {running && <><progress max={state.download.total} value={state.download.received} aria-label="Download progress"/><Button busy={busy === 'cancel'} disabled={!!busy} onClick={() => void cancel()}>Cancel download</Button></>}
      {state.download.error && <Feedback kind="error">{state.download.error}</Feedback>}
    </div>}
    {!!state.assets.length && <details className="data-research-receipts"><summary>Local assets ({state.assets.length})</summary>{state.assets.map(asset => <article key={asset.id}>
      <strong>{asset.name}</strong><p>{asset.localAvailable ? 'Available' : 'Missing local file'} · {size(asset.size)}</p><p>SHA-256: <code>{asset.sha256}</code></p>{asset.source.startsWith('https://') && <a href={asset.source} target="_blank" rel="noreferrer">Source</a>}
    </article>)}</details>}
  </section>;
}
