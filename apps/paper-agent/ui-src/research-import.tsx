import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Feedback, Field, Input, Toolbar } from '@pero/app-sdk/ui';
import type { Api } from './types';
import { assetSize, resourceKinds, type ImportDraft, type ResearchBundle, type ResearchResource } from './research-types';
import './research-import.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const confidence = { explicit: 'Explicit link', metadata: 'Source metadata', unresolved: 'Unresolved' };
const relations = { links_to: 'Links to', implements: 'Implements', cites: 'Cites', releases: 'Releases', evaluated_on: 'Evaluated on' };

export function ResourceDetails({ resource, onRead }: { resource: ResearchResource; onRead?(id: string): void }) {
  return <>
    <div className="pa-resource-meta"><span>{resourceKinds[resource.kind]}</span><span>{relations[resource.relation]}</span><span>{confidence[resource.confidence]}</span><span>{resource.license || 'License unknown'}</span><span>{assetSize(resource.size)}</span></div>
    {resource.authors.length > 0 && <p className="pa-muted">{resource.authors.join(', ')}</p>}
    {resource.unresolved.length > 0 && <ul className="pa-resource-warnings">{resource.unresolved.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    <div className="pa-actions"><a href={resource.url} target="_blank" rel="noreferrer">Open source</a>{resource.paperId && onRead && <Button variant="ghost" onClick={() => onRead(resource.paperId!)}>Read saved source</Button>}</div>
    <details><summary>Source details</summary>
      <dl className="pa-resource-provenance"><dt>Identity</dt><dd>{resource.identity}</dd><dt>Original URL</dt><dd><a href={resource.originalUrl} target="_blank" rel="noreferrer">{resource.originalUrl}</a></dd><dt>Revision</dt><dd>{resource.revision || 'Not resolved'}</dd>{resource.observedAt && <><dt>Inspected</dt><dd>{resource.observedAt}</dd></>}</dl>
      {resource.evidence.length > 0 && <ul>{resource.evidence.map((evidence, index) => <li key={index}><a href={evidence.url} target="_blank" rel="noreferrer">{evidence.label || evidence.url}</a></li>)}</ul>}
      {resource.excerpt && <p className="pa-resource-excerpt">{resource.excerpt}</p>}
    </details>
  </>;
}

export function ResearchImport({ api, active, onSaved }: { api: Api; active: boolean; onSaved(bundle: ResearchBundle, startDownloadIds: string[]): Promise<void> }) {
  const [url, setUrl] = useState(''), [draft, setDraft] = useState<ImportDraft | null>(null), [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [selected, setSelected] = useState<string[]>([]), [downloadIds, setDownloadIds] = useState<string[]>([]), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [draftsError, setDraftsError] = useState('');
  const mounted = useRef(true), epoch = useRef(0), requestPending = useRef(false), savePending = useRef(false), input = useRef<HTMLInputElement>(null), acceptedDraft = useRef<ImportDraft | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  function accept(value: ImportDraft) {
    const previous = acceptedDraft.current;
    if (previous?.id !== value.id || previous.status !== 'ready' && value.status === 'ready') {
      setSelected(value.resources.map(resource => resource.id)); setDownloadIds([]); setConfirmed(false);
    }
    acceptedDraft.current = value; setDraft(value);
  }
  async function loadDrafts() {
    try { const value = await api.get<{ drafts: ImportDraft[] }>('/api/research/drafts'); if (mounted.current) { setDrafts(value.drafts); setDraftsError(''); } }
    catch (error) { if (mounted.current) setDraftsError(errorText(error)); }
  }
  useEffect(() => { if (active) void loadDrafts(); }, [api, active]);
  useEffect(() => {
    if (!active || draft?.status !== 'inspecting' || error || busy) return;
    let alive = true; const version = epoch.current;
    const timer = setTimeout(async () => {
      try { const value = await api.post<ImportDraft>('/api/research/inspect', { draftId: draft.id }); if (alive && version === epoch.current) accept(value); }
      catch (error) { if (alive && version === epoch.current) setError(errorText(error)); }
    }, 700);
    return () => { alive = false; clearTimeout(timer); };
  }, [api, active, draft, error, busy]);
  async function inspect(resume?: ImportDraft, refresh = false) {
    if (requestPending.current || savePending.current) return;
    const seed = resume?.seedUrl ?? url.trim();
    if (!resume && !/^https:\/\//i.test(seed)) { setError('Use a public HTTPS URL.'); input.current?.focus(); return; }
    requestPending.current = true; setBusy(true); setError(''); acceptedDraft.current = null; setDraft(null); setDownloadIds([]); setConfirmed(false);
    const version = ++epoch.current;
    try {
      const value = await api.post<ImportDraft>('/api/research/inspect', resume ? { draftId: resume.id } : { url: seed, ...(refresh ? { refresh: true } : {}) });
      if (mounted.current && version === epoch.current) { setUrl(value.seedUrl); accept(value); }
      else if (mounted.current && value.status === 'inspecting') void api.post('/api/research/inspect', { draftId: value.id, cancel: true }).catch(() => {});
    } catch (error) { if (mounted.current && version === epoch.current) setError(errorText(error)); }
    finally { if (mounted.current && version === epoch.current) { requestPending.current = false; setBusy(false); } }
  }
  async function cancel() {
    if (!draft || requestPending.current) return;
    requestPending.current = true; setBusy(true); setError(''); const version = ++epoch.current;
    try { const value = await api.post<ImportDraft>('/api/research/inspect', { draftId: draft.id, cancel: true }); if (mounted.current && version === epoch.current) accept(value); }
    catch (error) { if (mounted.current && version === epoch.current) setError(errorText(error)); }
    finally { if (mounted.current && version === epoch.current) { requestPending.current = false; setBusy(false); } }
  }
  function reset() {
    epoch.current++; requestPending.current = false; setBusy(false); setDraft(null); setError(''); setUrl(''); setSelected([]); setDownloadIds([]); setConfirmed(false);
    if (draft?.status === 'inspecting') void api.post('/api/research/inspect', { draftId: draft.id, cancel: true }).catch(error => { if (mounted.current) setDraftsError(`Previous inspection could not be cancelled: ${errorText(error)}`); });
    input.current?.focus(); void loadDrafts();
  }
  async function save() {
    if (!draft || draft.status !== 'ready' || !selected.length || savePending.current || downloadIds.length > 0 && !confirmed) return;
    savePending.current = true; setSaving(true); setError('');
    try {
      const bundle = await api.post<ResearchBundle>('/api/research/commit', { draftId: draft.id, resourceIds: selected, downloadIds, confirmedDownloads: confirmed && downloadIds.length > 0 });
      await onSaved(bundle, downloadIds);
      if (mounted.current) { setDraft(null); setUrl(''); setDownloadIds([]); setConfirmed(false); void loadDrafts(); }
    } catch (error) { if (mounted.current) setError(errorText(error)); }
    finally { savePending.current = false; if (mounted.current) setSaving(false); }
  }
  const selectedAssets = draft?.resources.flatMap(resource => resource.assets).filter(asset => downloadIds.includes(asset.id)) ?? [];
  return <div className="pa-research-import">
    <div className="pa-research-url" role="group" aria-label="Inspect research URL" onKeyDown={event => {
      // App frames deliberately disallow native form submission. Keep both
      // keyboard and pointer actions on the same authenticated API path.
      if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) {
        event.preventDefault(); if (!draft && !busy && !saving) void inspect();
      }
    }}>
      <Field label="Research URL">{props => <Input {...props} ref={input} type="url" required maxLength={2048} value={url} readOnly={!!draft || busy || saving} placeholder="https://…" onChange={event => { setUrl(event.target.value); setError(''); }}/>}</Field>
      <Toolbar>{!draft && <Button variant="primary" busy={busy} disabled={!url.trim() || saving} onClick={() => void inspect()}>{busy ? 'Inspecting…' : 'Inspect link'}</Button>}{(draft || busy || error) && <Button type="button" disabled={saving} onClick={reset}>New URL</Button>}</Toolbar>
    </div>
    {error && <Feedback kind="error">{error}{draft?.status === 'inspecting' ? <Button disabled={busy} onClick={() => setError('')}>Retry status</Button> : !draft && <Button disabled={busy} onClick={() => void inspect()}>Retry</Button>}</Feedback>}
    {draft?.status === 'inspecting' && <div className="pa-actions"><p role="status">Inspecting sources…</p><Button busy={busy} onClick={() => void cancel()}>Cancel inspection</Button></div>}
    {draft?.status === 'failed' && <Feedback kind="error">{draft.error || 'Inspection failed.'}<Button onClick={() => void inspect()}>Retry inspection</Button></Feedback>}
    {draft?.status === 'cancelled' && <Feedback>Inspection cancelled.<Button onClick={() => void inspect()}>Retry inspection</Button></Feedback>}
    {draft?.warnings.map((warning, index) => <Feedback key={index}>{warning}</Feedback>)}
    {draft?.status === 'ready' && <section aria-label="Review resources" aria-busy={saving}>
      <div className="pa-research-heading"><h2>Review resources</h2><span className="pa-muted">{selected.length} of {draft.resources.length} selected</span></div>
      {!draft.resources.length && <Feedback>No resources found. Try another public research URL.</Feedback>}
      <ul className="pa-resource-list">{draft.resources.map(resource => <li key={resource.id}>
        <label className="pa-resource-title"><Checkbox checked={selected.includes(resource.id)} disabled={saving} onCheckedChange={checked => { setSelected(values => checked ? [...values, resource.id] : values.filter(id => id !== resource.id)); if (!checked) setDownloadIds(values => values.filter(id => !resource.assets.some(asset => asset.id === id))); setConfirmed(false); }}/><span>{resource.title || resource.url}</span></label>
        <div className="pa-resource-body"><ResourceDetails resource={resource}/>
          {resource.assets.map(asset => <label className="pa-resource-download" key={asset.id}><Checkbox checked={downloadIds.includes(asset.id)} disabled={saving || !selected.includes(resource.id)} onCheckedChange={checked => { setDownloadIds(values => checked ? [...values, asset.id] : values.filter(id => id !== asset.id)); setConfirmed(false); }}/><span>Download {asset.filename} <small>{assetSize(asset.size)} / {asset.license}</small></span></label>)}
        </div>
      </li>)}</ul>
      {downloadIds.length > 0 ? <label className="pa-download-confirm"><Checkbox checked={confirmed} disabled={saving} onCheckedChange={setConfirmed}/><span>I confirm downloading {downloadIds.length} selected {downloadIds.length === 1 ? 'file' : 'files'} ({assetSize(selectedAssets.reduce((total, asset) => total + asset.size, 0))}) to Data under the licenses shown. No code will run.</span></label> : <p className="pa-muted">References only. No files downloaded or code run.</p>}
      <Toolbar><Button variant="primary" busy={saving} disabled={!selected.length || downloadIds.length > 0 && !confirmed} onClick={() => void save()}>{saving ? 'Saving…' : downloadIds.length ? 'Save and download' : 'Save references only'}</Button><Button disabled={saving} onClick={() => void inspect(undefined, true)}>Inspect again</Button></Toolbar>
    </section>}
    {!draft && !busy && <section className="pa-research-drafts" aria-label="Saved import reviews">
      {draftsError && <Feedback kind="error">{draftsError}<Button onClick={() => void loadDrafts()}>Retry saved reviews</Button></Feedback>}
      {!!drafts.length && <details><summary>Resume an inspection ({drafts.length})</summary><ul>{drafts.map(item => <li key={item.id}><Button variant="ghost" onClick={() => void inspect(item)}>{item.seedUrl}</Button><span className="pa-muted">{item.status}</span></li>)}</ul></details>}
    </section>}
  </div>;
}
