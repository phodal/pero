import React, { useEffect, useRef, useState } from 'react';
import { useAppDataChanged } from '@pero/app-sdk';
import { Button, Checkbox, Feedback, Field, Input, Toolbar } from '@pero/app-sdk/ui';
import type { Api, Paper } from './types';
import './resource-import.css';

type Resource = {
  id: string; kind: string; title: string; url: string; relation: string;
  status: string; revision: string; license: string; sizeBytes: number | null;
  warning: string; paperId?: string;
  evidence: { sourceUrl: string; label: string; method: string }[];
};
type Bundle = {
  id: string; seedUrl: string; status: string; resources: Resource[]; warnings: string[];
  paperIds?: string[]; handoff?: { schema: string; bundleId: string; resources: unknown[] };
};
const names: Record<string, string> = { web_article: 'Article', paper: 'Paper', code: 'Code', model: 'Model', dataset: 'Dataset', benchmark: 'Benchmark', service: 'Service' };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function bytes(value: number | null) {
  if (value == null) return 'Size unknown';
  return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KiB` : `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
function exportPlan(bundle: Bundle) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle.handoff, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${bundle.id.slice(0, 12)}.pero-resources.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  // A later user gesture is not needed; retain the URL until the download is dispatched.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ResourceImportPanel({ api, active, onAdded }: {
  api: Api; active: boolean; onAdded(paper: Paper, focus: boolean): Promise<void>;
}) {
  const [url, setUrl] = useState(''), [draft, setDraft] = useState<Bundle | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [bundles, setBundles] = useState<Bundle[]>([]);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(true), request = useRef(0), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  async function refresh() {
    const result = await api.post<{ bundles: Bundle[] }>('/api/resource-imports', { action: 'list' });
    if (mounted.current) setBundles(result.bundles);
  }
  useEffect(() => { if (active) void refresh().catch(error => { if (mounted.current) setError(message(error)); }); }, [active, api]);
  useAppDataChanged(() => { if (active) void refresh().catch(error => { if (mounted.current) setError(message(error)); }); });

  async function inspect() {
    if (pending.current || !url.trim()) return;
    pending.current = true; setBusy('inspect'); setError(''); setNotice(''); setDraft(null);
    const current = ++request.current;
    try {
      const result = await api.post<Bundle>('/api/resource-imports', { action: 'inspect', url: url.trim() });
      if (mounted.current && current === request.current) {
        setDraft(result); setSelected(result.resources.map(resource => resource.id));
      }
    } catch (error) { if (mounted.current && current === request.current) setError(message(error)); }
    finally { pending.current = false; if (mounted.current && current === request.current) setBusy(''); }
  }
  async function save() {
    if (pending.current || !draft || !selected.length) return;
    pending.current = true; setBusy('save'); setError(''); setNotice('');
    try {
      const saved = await api.post<Bundle>('/api/resource-imports', { action: 'save', draftId: draft.id, resourceIds: selected });
      if (!mounted.current) return;
      setDraft(saved); setNotice('References saved. No code, models or datasets were downloaded.');
      setBundles(previous => [saved, ...previous.filter(bundle => bundle.id !== saved.id)]);
      for (const id of saved.paperIds ?? []) {
        const paper = await api.get<Paper>(`/api/papers/${id}`);
        if (mounted.current) await onAdded(paper, false);
      }
    } catch (error) { if (mounted.current) setError(message(error)); }
    finally { pending.current = false; if (mounted.current) setBusy(''); }
  }
  function select(id: string, checked: boolean) {
    setSelected(previous => checked ? [...previous, id] : previous.filter(value => value !== id));
  }
  function resources(bundle: Bundle, editable: boolean) {
    return <div className="pa-resource-table"><table>
      <caption className="pa-sr-only">Research resources</caption>
      <thead><tr><th scope="col">Resource</th><th scope="col">Type</th><th scope="col">License / size</th></tr></thead>
      <tbody>{bundle.resources.map(resource => <tr key={resource.id}>
        <td><div className="pa-resource-name">
          {editable && <Checkbox checked={selected.includes(resource.id)} disabled={!!busy} aria-label={`Save ${resource.title}`} onCheckedChange={checked => select(resource.id, checked)}/>}
          <a href={resource.url} target="_blank" rel="noreferrer">{resource.title}</a>
        </div><small>{resource.status === 'unavailable' ? 'Metadata unavailable' : resource.relation.replaceAll('_', ' ')}</small>
          {resource.warning && <p className="pa-resource-warning">{resource.warning}</p>}
          <details><summary>Source</summary>{resource.evidence.map((evidence, index) => <p key={index}><a href={evidence.sourceUrl} target="_blank" rel="noreferrer">{evidence.label || evidence.sourceUrl}</a> · {evidence.method}</p>)}{resource.revision && <p>Revision: <code>{resource.revision}</code></p>}</details>
        </td><td>{names[resource.kind] ?? resource.kind}</td><td>{resource.license || 'Unknown'}<small>{bytes(resource.sizeBytes)}</small></td>
      </tr>)}</tbody>
    </table></div>;
  }
  return <section className="pa-resource-import" aria-label="Import research link">
    <div className="pa-search-form"><Field label="Research link">{props => <Input {...props} type="url" maxLength={4096} placeholder="https://…" value={url} disabled={!!busy}
      onChange={event => setUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void inspect(); } }}/>}</Field>
      <Toolbar><Button variant="primary" busy={busy === 'inspect'} disabled={!!busy || !url.trim()} onClick={() => void inspect()}>{busy === 'inspect' ? 'Finding resources…' : 'Find resources'}</Button></Toolbar>
    </div>
    {error && <Feedback kind="error">{error}</Feedback>}
    {notice && <p role="status" className="pa-resource-notice">{notice}</p>}
    {draft && <section aria-label="Resource review">
      {draft.warnings.map((warning, index) => <Feedback key={index}>{warning}</Feedback>)}
      {resources(draft, draft.status !== 'saved')}
      {draft.status !== 'saved' && <Toolbar><Button variant="primary" busy={busy === 'save'} disabled={!!busy || !selected.length} onClick={() => void save()}>Save references ({selected.length})</Button></Toolbar>}
      {draft.status === 'saved' && !!draft.handoff?.resources.length && <div className="pa-resource-handoff"><Button onClick={() => exportPlan(draft)}>Export download plan</Button><small>Open this plan in Data → Research downloads. Files are selected and confirmed there.</small></div>}
    </section>}
    {bundles.length > 0 && <section className="pa-resource-history" aria-label="Saved research bundles"><h3>Saved research</h3>
      {bundles.map(bundle => <details key={bundle.id}><summary>{bundle.resources.find(resource => resource.relation === 'source')?.title || bundle.seedUrl} · {bundle.resources.length} resources</summary>
        {resources(bundle, false)}{!!bundle.handoff?.resources.length && <Button onClick={() => exportPlan(bundle)}>Export download plan</Button>}
      </details>)}
    </section>}
  </section>;
}
