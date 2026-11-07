import React, { useEffect, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Disclosure, Progress, Button, Checkbox, Feedback, Field, Icon, Input, Toolbar } from '@pero/app-sdk/ui';
import type { Api } from './types';
import { assetSize, type ImportDraft, type ResearchBundle, type ResearchResource } from './research-types';
import './research-import.css';
import { groupResearchResources } from './research-groups';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const confidence = { explicit: 'Explicit link', metadata: 'Source metadata', unresolved: 'Unresolved' };
const relations = { links_to: 'Links to', implements: 'Implements', cites: 'Cites', releases: 'Releases', evaluated_on: 'Evaluated on' };

const labels = {
  url: { zh: '研究链接', en: 'Research URL' }, inspect: { zh: '检查链接', en: 'Inspect link' }, inspecting: { zh: '检查中…', en: 'Inspecting…' },
  newUrl: { zh: '更换链接', en: 'New URL' }, review: { zh: '选择资源', en: 'Review resources' }, selected: { zh: '已选', en: 'selected' },
  original: { zh: '原文', en: 'Open source' }, details: { zh: '来源详情', en: 'Source details' }, license: { zh: '许可未知', en: 'License unknown' }, licenseLabel: { zh: '许可与大小', en: 'License and size' }, sizeUnknown: { zh: '大小未知', en: 'Size unknown' },
  unresolved: { zh: '版本未确认', en: 'Not resolved' }, read: { zh: '阅读已保存来源', en: 'Read saved source' },
  revision: { zh: '版本', en: 'Revision' }, identity: { zh: '标识', en: 'Identity' }, inspected: { zh: '检查时间', en: 'Inspected' },
  pdf: { zh: '保存 PDF', en: 'Download PDF for reading' }, html: { zh: '排版阅读', en: 'Allow official HTML for Read' },
  tex: { zh: '保存 TeX 源码', en: 'Get source for read-only inspection' },
  htmlScope: { zh: '官方 HTML，最多 8 MiB；准备阅读时下载，不含图片。许可未知。', en: 'Official HTML, up to 8 MiB; acquired on Prepare Read, without images. License unknown.' },
  pdfScope: { zh: '最多 16 MiB；大小和许可未知。', en: 'Up to 16 MiB; size and license unknown.' },
  texScope: { zh: '最多 16 MiB；只读，不编译。大小和许可未知。', en: 'Up to 16 MiB; read only, never compiled. Size and license unknown.' },
  needsVersion: { zh: '请先确认 arXiv 版本。', en: 'Select an explicit arXiv vN first.' },
  references: { zh: '仅保存引用', en: 'Save references only' }, saveFiles: { zh: '保存并下载', en: 'Save and download' },
  saveHtml: { zh: '保存阅读许可', en: 'Save HTML permission' }, saving: { zh: '保存中…', en: 'Saving…' },
  again: { zh: '重新检查', en: 'Inspect again' }, confirm: { zh: '我确认仅获取所选文件', en: 'I confirm downloading only the selected files' },
  noExecution: { zh: '不运行代码；TeX 不编译。', en: 'No code runs; TeX is not compiled.' },
  referenceScope: { zh: '只保存引用，不下载文件。', en: 'References only. No files downloaded or code run.' },
  empty: { zh: '未找到资源，请尝试其他研究链接。', en: 'No resources found. Try another public research URL.' },
  retry: { zh: '重试', en: 'Retry' }, retryStatus: { zh: '重试状态查询', en: 'Retry status' }, retryInspection: { zh: '重新检查', en: 'Retry inspection' }, retryReviews: { zh: '重试读取历史', en: 'Retry saved reviews' },
  invalidUrl: { zh: '请输入公开的 HTTPS 链接。', en: 'Use a public HTTPS URL.' }, failed: { zh: '检查失败', en: 'Inspection failed.' }, download: { zh: '下载', en: 'Download' },
  cancelled: { zh: '检查已取消', en: 'Inspection cancelled.' }, cancel: { zh: '取消检查', en: 'Cancel inspection' },
  inspectSources: { zh: '正在检查来源…', en: 'Inspecting sources…' }, resume: { zh: '继续检查', en: 'Resume an inspection' },
  web_article: { zh: '文章', en: 'Article' }, paper: { zh: '论文', en: 'Paper' }, pdf_candidate: { zh: 'PDF', en: 'PDF / unverified paper' },
  source_archive: { zh: '源码', en: 'Source archive' }, code: { zh: '代码', en: 'Code' }, model: { zh: '模型', en: 'Model' },
  dataset: { zh: '数据集', en: 'Dataset' }, benchmark: { zh: '基准', en: 'Benchmark' }, service: { zh: '服务', en: 'Service' },
};
const resourceIcons: Record<ResearchResource['kind'], string> = {
  web_article: 'external-link', paper: 'book-open-text', pdf_candidate: 'file-text', source_archive: 'file-code',
  code: 'code', model: 'box', dataset: 'database', benchmark: 'chart-line', service: 'plug',
};

export function ResourceDetails({ resource, related = [], onRead, detailsOnly = false }: { resource: ResearchResource; related?: readonly ResearchResource[]; onRead?(id: string): void; detailsOnly?: boolean }) {
  const { t } = useAppI18n(labels);
  const sources = [resource, ...related];
  const warnings = [...new Set(sources.flatMap(source => source.unresolved))];
  return <div className="pa-resource-info">
    {!detailsOnly && <div className="pa-resource-meta"><span>{t(resource.kind)}</span>{resource.revision && <span>{resource.revision}</span>}<a href={resource.url} target="_blank" rel="noreferrer" aria-label={`${t('original')}: ${new URL(resource.url).hostname}`}><span>{new URL(resource.url).hostname}</span><Icon name="external-link"/></a></div>}
    {!detailsOnly && warnings.length > 0 && <ul className="pa-resource-warnings">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    <div className="pa-resource-actions"><Disclosure variant="inline" summary={<>{t('details')}</>}>
      {sources.map(source => <div key={source.id} className="pa-resource-provenance-source">{sources.length > 1 && <p><strong>{t(source.kind)}</strong> {source.title}</p>}
      <dl className="pa-resource-provenance"><dt>{t('identity')}</dt><dd>{source.identity}</dd><dt>URL</dt><dd><a href={source.originalUrl} target="_blank" rel="noreferrer">{source.originalUrl}</a></dd><dt>{t('revision')}</dt><dd>{source.revision || t('unresolved')}</dd>{source.observedAt && <><dt>{t('inspected')}</dt><dd>{source.observedAt}</dd></>}<dt>{t('licenseLabel')}</dt><dd>{source.license || t('license')} / {source.size == null ? t('sizeUnknown') : assetSize(source.size)}</dd><dt>{relations[source.relation]}</dt><dd>{confidence[source.confidence]}</dd></dl>
      {source.authors.length > 0 && <p className="pa-muted">{source.authors.join(', ')}</p>}
      {source.evidence.length > 0 && <ul>{source.evidence.map((evidence, index) => <li key={index}><a href={evidence.url} target="_blank" rel="noreferrer">{evidence.label || evidence.url}</a>{evidence.position != null && ` (link ${evidence.position})`}{evidence.href && <div>{evidence.href}</div>}</li>)}</ul>}
      {source.excerpt && <p className="pa-resource-excerpt">{source.excerpt}</p>}
      </div>)}
    </Disclosure>{!detailsOnly && resource.paperId && onRead && <Button variant="ghost" onClick={() => onRead(resource.paperId!)}>{t('read')}</Button>}</div>
  </div>;
}

export function ResearchImport({ api, active, onSaved }: { api: Api; active: boolean; onSaved(bundle: ResearchBundle, startDownloadIds: string[], startPdfIds: string[], startSourceIds: string[]): Promise<void> }) {
  const { t } = useAppI18n(labels);
  const [url, setUrl] = useState(''), [draft, setDraft] = useState<ImportDraft | null>(null), [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [selected, setSelected] = useState<string[]>([]), [downloadIds, setDownloadIds] = useState<string[]>([]), [pdfIds, setPdfIds] = useState<string[]>([]), [sourceIds, setSourceIds] = useState<string[]>([]), [htmlIds, setHtmlIds] = useState<string[]>([]), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [draftsError, setDraftsError] = useState('');
  const mounted = useRef(true), epoch = useRef(0), requestPending = useRef(false), savePending = useRef(false), input = useRef<HTMLInputElement>(null), acceptedDraft = useRef<ImportDraft | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  function accept(value: ImportDraft) {
    const previous = acceptedDraft.current;
    if (previous?.id !== value.id || previous.status !== 'ready' && value.status === 'ready') {
      setSelected(value.resources.map(resource => resource.id)); setDownloadIds([]); setPdfIds([]); setSourceIds([]); setHtmlIds([]); setConfirmed(false);
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
    if (!resume && !/^https:\/\//i.test(seed)) { setError(t('invalidUrl')); input.current?.focus(); return; }
    requestPending.current = true; setBusy(true); setError(''); acceptedDraft.current = null; setDraft(null); setDownloadIds([]); setPdfIds([]); setSourceIds([]); setHtmlIds([]); setConfirmed(false);
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
    epoch.current++; requestPending.current = false; setBusy(false); setDraft(null); setError(''); setUrl(''); setSelected([]); setDownloadIds([]); setPdfIds([]); setSourceIds([]); setHtmlIds([]); setConfirmed(false);
    if (draft?.status === 'inspecting') void api.post('/api/research/inspect', { draftId: draft.id, cancel: true }).catch(error => { if (mounted.current) setDraftsError(`Previous inspection could not be cancelled: ${errorText(error)}`); });
    input.current?.focus(); void loadDrafts();
  }
  async function save() {
    if (!draft || draft.status !== 'ready' || !selected.length || savePending.current || (downloadIds.length + pdfIds.length + sourceIds.length + htmlIds.length) > 0 && !confirmed) return;
    savePending.current = true; setSaving(true); setError('');
    try {
      const bundle = await api.post<ResearchBundle>('/api/research/commit', { draftId: draft.id, resourceIds: selected, downloadIds, pdfIds, sourceIds, htmlIds, confirmedDownloads: confirmed && (downloadIds.length + pdfIds.length + sourceIds.length + htmlIds.length) > 0 });
      await onSaved(bundle, downloadIds, pdfIds, sourceIds);
      if (mounted.current) { setDraft(null); setUrl(''); setDownloadIds([]); setPdfIds([]); setSourceIds([]); setHtmlIds([]); setConfirmed(false); void loadDrafts(); }
    } catch (error) { if (mounted.current) setError(errorText(error)); }
    finally { savePending.current = false; if (mounted.current) setSaving(false); }
  }
  const groups = groupResearchResources(draft?.resources ?? []);
  const selectedGroups = groups.filter(group => group.resources.some(resource => selected.includes(resource.id)));
  const selectedAssets = draft?.resources.flatMap(resource => resource.assets).filter(asset => downloadIds.includes(asset.id)) ?? [];
  return <div className="pa-research-import">
    <div className="pa-research-url" role="group" aria-label="Inspect research URL" onKeyDown={event => {
      // App frames deliberately disallow native form submission. Keep both
      // keyboard and pointer actions on the same authenticated API path.
      if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) {
        event.preventDefault(); if (!draft && !busy && !saving) void inspect();
      }
    }}>
      <Field label={t('url')}>{props => <Input {...props} ref={input} type="url" required maxLength={2048} value={url} readOnly={!!draft || busy || saving} placeholder="https://…" onChange={event => { setUrl(event.target.value); setError(''); }}/>}</Field>
      <Toolbar>{!draft && <Button variant="primary" busy={busy} disabled={!url.trim() || saving} onClick={() => void inspect()}>{busy ? t('inspecting') : t('inspect')}</Button>}{(draft || busy || error) && <Button type="button" disabled={saving} onClick={reset}>{t('newUrl')}</Button>}</Toolbar>
    </div>
    {error && <Feedback kind="error">{error}{draft?.status === 'inspecting' ? <Button disabled={busy} onClick={() => setError('')}>{t('retryStatus')}</Button> : !draft && <Button disabled={busy} onClick={() => void inspect()}>{t('retry')}</Button>}</Feedback>}
    {draft?.status === 'inspecting' && <div className="pa-import-progress"><Progress label={t('inspectSources')}/><span role="status">{t('inspectSources')}</span><Button busy={busy} onClick={() => void cancel()}>{t('cancel')}</Button></div>}
    {draft?.status === 'failed' && <Feedback kind="error">{draft.error || t('failed')}<Button onClick={() => void inspect()}>{t('retryInspection')}</Button></Feedback>}
    {draft?.status === 'cancelled' && <Feedback>{t('cancelled')}<Button onClick={() => void inspect()}>{t('retryInspection')}</Button></Feedback>}
    {draft?.warnings.map((warning, index) => <Feedback key={index}>{warning}</Feedback>)}
    {draft?.status === 'ready' && <section aria-label={t('review')} aria-busy={saving}>
      <div className="pa-research-heading"><h2>{t('review')}</h2><span className="pa-muted">{selectedGroups.length}/{groups.length} {t('selected')}</span></div>
      {!draft.resources.length && <Feedback>{t('empty')}</Feedback>}
      <ul className="pa-resource-list">{groups.map(group => {
        const resource = group.primary, html = group.html, ids = group.resources.map(value => value.id);
        return <li key={group.id} data-resource-group={group.id}>
          <div className="pa-resource-identity"><label className="pa-resource-title"><Checkbox aria-label={[resource.title || resource.url, resource.revision].filter(Boolean).join(' ')} checked={ids.every(id => selected.includes(id))} disabled={saving} onCheckedChange={checked => {
            setSelected(values => checked === true ? [...new Set([...values, ...ids])] : values.filter(id => !ids.includes(id)));
            if (checked !== true) {
              setDownloadIds(values => values.filter(id => !group.resources.some(resource => resource.assets.some(asset => asset.id === id))));
              setPdfIds(values => values.filter(id => !ids.includes(id))); setSourceIds(values => values.filter(id => !ids.includes(id))); setHtmlIds(values => values.filter(id => !ids.includes(id)));
            }
            setConfirmed(false);
          }}/><Icon name={resourceIcons[resource.kind]}/><span>{resource.title || resource.url}</span></label><ResourceDetails resource={resource} related={group.resources.filter(value => value.id !== resource.id)}/></div>
          <div className="pa-resource-body pa-resource-files">
          {html && <label className="pa-resource-download"><Checkbox checked={htmlIds.includes(html.id)} disabled={saving || !selected.includes(html.id)} onCheckedChange={checked => { setHtmlIds(values => checked === true ? [...values, html.id] : values.filter(id => id !== html.id)); setConfirmed(false); }}/><span>{t('html')}<small>{t('htmlScope')}</small></span></label>}
            {group.resources.map(resource => <React.Fragment key={resource.id}>
          {resource.kind === 'source_archive' && <label className="pa-resource-download"><Checkbox checked={sourceIds.includes(resource.id)} disabled={saving || !selected.includes(resource.id) || !!resource.workIdentity && !resource.revision || /\.zip(?:[?#]|$)/i.test(resource.url)} onCheckedChange={checked => { setSourceIds(values => checked === true ? [...values, resource.id] : values.filter(id => id !== resource.id)); setConfirmed(false); }}/><span>{t('tex')}<small>{resource.workIdentity && !resource.revision ? t('needsVersion') : t('texScope')}</small></span></label>}

          {resource.kind === 'pdf_candidate' && <label className="pa-resource-download"><Checkbox checked={pdfIds.includes(resource.id)} disabled={saving || !selected.includes(resource.id)} onCheckedChange={checked => { setPdfIds(values => checked === true ? [...values, resource.id] : values.filter(id => id !== resource.id)); setConfirmed(false); }}/><span>{t('pdf')}<small>{group.resources.filter(value => value.kind === resource.kind).length > 1 && <a href={resource.originalUrl} target="_blank" rel="noreferrer">{resource.originalUrl}</a>}{t('pdfScope')}</small></span></label>}
          {resource.assets.map(asset => <label className="pa-resource-download" key={asset.id}><Checkbox checked={downloadIds.includes(asset.id)} disabled={saving || !selected.includes(resource.id)} onCheckedChange={checked => { setDownloadIds(values => checked === true ? [...values, asset.id] : values.filter(id => id !== asset.id)); setConfirmed(false); }}/><span>{t('download')} {asset.filename} <small>{assetSize(asset.size)} / {asset.license}</small></span></label>)}
            </React.Fragment>)}
          </div>
        </li>;
      })}</ul>
      <footer className="pa-import-footer">
        {downloadIds.length + pdfIds.length + sourceIds.length + htmlIds.length > 0 ? <label className="pa-download-confirm"><Checkbox checked={confirmed} disabled={saving} onCheckedChange={checked => setConfirmed(checked === true)}/><span>{t('confirm')} ({downloadIds.length + pdfIds.length + sourceIds.length + htmlIds.length})<small>{downloadIds.length > 0 && `${assetSize(selectedAssets.reduce((total, asset) => total + asset.size, 0))}. `}{t('noExecution')}</small></span></label> : <p className="pa-muted">{t('referenceScope')}</p>}
        <Toolbar><Button variant="primary" busy={saving} disabled={!selected.length || (downloadIds.length + pdfIds.length + sourceIds.length + htmlIds.length) > 0 && !confirmed} onClick={() => void save()}>{saving ? t('saving') : downloadIds.length + pdfIds.length + sourceIds.length + htmlIds.length ? (downloadIds.length + pdfIds.length + sourceIds.length ? t('saveFiles') : t('saveHtml')) : t('references')}</Button><Button disabled={saving} onClick={() => void inspect(undefined, true)}>{t('again')}</Button></Toolbar>
      </footer>
    </section>}
    {!draft && !busy && <section className="pa-research-drafts" aria-label="Saved import reviews">
      {draftsError && <Feedback kind="error">{draftsError}<Button onClick={() => void loadDrafts()}>{t('retryReviews')}</Button></Feedback>}
      {!!drafts.length && <Disclosure variant="inline" summary={<>{t('resume')} ({drafts.length})</>}><ul>{drafts.map(item => <li key={item.id}><Button variant="ghost" onClick={() => void inspect(item)}>{item.seedUrl}</Button><span className="pa-muted">{item.status}</span></li>)}</ul></Disclosure>}
    </section>}
  </div>;
}
