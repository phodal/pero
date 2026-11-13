import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { downloadFile, useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Disclosure, Feedback, Field, Select, Textarea } from '@pero/app-sdk/ui';
import { exportMystPublicationArchive } from '@pero/notebook/myst-publication-sdk';
import type { MystPublicationInput } from '@pero/notebook/myst-publication';
import { importMystProjectSnapshot, type MystProjectSnapshot } from '@pero/notebook/myst-project-snapshot';
import { publicationProvenance, type PublicationProvenance } from '@pero/notebook/publication-provenance';
import { useNotebookContext } from './notebook-context';

interface Build {
  id: string; entryId: string; revision: number; blockId: string; sourceSha256: string; archiveSha256: string;
  status: 'succeeded' | 'failed' | 'unavailable'; createdAt: string; engine: string | null; command: string[]; texCache?: string;
  pdfSha256?: string; log: string; diagnostics: { severity: string; message: string; path?: string; line?: number }[];
}
interface BuildDetail { build: Build; snapshot: string; archive: string; pdf?: string }
interface BuildPage { page: number; pages: number; base64: string; width: number; height: number; pdfSha256: string }
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const encode = (value: Uint8Array) => { let text = ''; for (const byte of value) text += String.fromCharCode(byte); return btoa(text); };
const messages = {
  title: { en: 'Publication builds', zh: '出版构建' }, build: { en: 'Compile saved revision to PDF', zh: '将已保存修订编译为 PDF' },
  building: { en: 'Compiling locally (up to 45 seconds)…', zh: '正在本地编译（最多 45 秒）…' },
  saved: { en: 'Save this revision before compiling. Existing builds keep their original inputs.', zh: '请先保存当前修订再编译。已有构建保留原始输入。' },
  history: { en: 'Build version', zh: '构建版本' },
  succeeded: { en: 'PDF compiled', zh: 'PDF 已编译' }, failed: { en: 'Compilation failed', zh: '编译失败' }, unavailable: { en: 'Compiler unavailable', zh: '编译器不可用' },
  loading: { en: 'Loading build history…', zh: '正在读取构建历史…' }, retry: { en: 'Reload builds', zh: '重新读取构建' },
  source: { en: 'Frozen build inputs', zh: '固定的构建输入' }, resource: { en: 'Build input resource', zh: '构建输入资源' },
  generated: { en: 'Generated LaTeX', zh: '生成的 LaTeX' }, log: { en: 'Compiler log and hashes', zh: '编译日志与哈希' },
  archive: { en: 'Download build source package', zh: '下载构建源码包' }, pdf: { en: 'Download this PDF', zh: '下载此 PDF' },
  snapshot: { en: 'Download frozen project', zh: '下载固定项目' },
  previous: { en: 'Open last compiled PDF', zh: '打开上次编译的 PDF' },
  stale: { en: 'The editor has newer inputs. This PDF and its diagnostics belong to revision {revision}.', zh: '编辑器已有更新的输入。此 PDF 及诊断属于修订 {revision}。' },
  meaning: { en: 'Compilation checks document generation. Review figure provenance, projection losses and scientific claims before sharing.', zh: '编译检查文档生成。分享前请审阅图表来源、格式转换损失和科学论断。' },
  diagnostics: { en: 'Build diagnostics', zh: '构建诊断' }, edit: { en: 'Edit {path}', zh: '编辑 {path}' },
  view: { en: 'View {path}', zh: '查看 {path}' },
  panels: { en: 'Figure sources', zh: '图表来源' }, checked: { en: 'Figure, code and data hashes match this snapshot.', zh: '图、代码和数据哈希与当前快照一致。' },
  checking: { en: 'Checking figure inputs…', zh: '正在检查图表输入…' },
  page: { en: 'PDF page', zh: 'PDF 页码' }, preview: { en: 'Compiled PDF preview', zh: '已编译 PDF 预览' },
  before: { en: 'Previous page', zh: '上一页' }, next: { en: 'Next page', zh: '下一页' },
};

/** A build is a receipt of one bounded compiler call, attached to existing saved
 * Entry revisions. Editing and scientific execution keep their existing owners. */
export function PublicationBuilds({ blockId, snapshot, raw, publication, formatting, onEdit }: {
  blockId: string; snapshot: MystProjectSnapshot; raw: string; publication: MystPublicationInput | null;
  formatting: boolean; onEdit(path: string, line?: number): void;
}) {
  const context = useNotebookContext(), api = useAppApi(), { t } = useAppI18n(messages);
  const route = context ? `/api/entries/${context.entryId}/publication-builds` : '';
  const [builds, setBuilds] = useState<Build[]>([]), [detail, setDetail] = useState<BuildDetail | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [provenance, setProvenance] = useState<{ snapshot: MystProjectSnapshot; value?: PublicationProvenance; error?: string } | null>(null);
  const [inputPath, setInputPath] = useState(''), [generated, setGenerated] = useState('');
  const [pageNumber, setPageNumber] = useState(1), [renderedPage, setPage] = useState<{ buildId: string; value: BuildPage } | null>(null), [pageError, setPageError] = useState('');
  const generation = useRef(0), selection = useRef(0), running = useRef(false);
  const generatedSection = useRef<HTMLDetailsElement>(null), generatedEditor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let current = true;
    void publicationProvenance(snapshot).then(value => { if (current) setProvenance({ snapshot, value }); })
      .catch(cause => { if (current) setProvenance({ snapshot, error: String(cause.message ?? cause) }); });
    return () => { current = false; };
  }, [snapshot]);
  const load = async () => {
    if (!route) return;
    const request = generation.current; setLoading(true); setError('');
    try {
      const response = await api.get<{ builds: Build[] }>(`${route}?blockId=${encodeURIComponent(blockId)}`);
      if (request === generation.current) setBuilds(response.builds);
    } catch (cause) { if (request === generation.current) setError(String((cause as Error).message)); }
    finally { if (request === generation.current) setLoading(false); }
  };
  useEffect(() => {
    generation.current++; setBuilds([]); setDetail(null); setError('');
    void load();
    return () => { generation.current++; };
  }, [route, blockId]);
  const open = async (id: string) => {
    const request = generation.current, selected = ++selection.current; setError('');
    try {
      const value = await api.get<BuildDetail>(`${route}/${id}`);
      if (request === generation.current && selected === selection.current) { setDetail(value); setInputPath(''); setPageNumber(1); }
    } catch (cause) { if (request === generation.current && selected === selection.current) setError(String((cause as Error).message)); }
  };
  const currentProvenance = provenance?.snapshot === snapshot ? provenance : null;
  const problems = currentProvenance?.error ? [currentProvenance.error] : currentProvenance?.value?.problems ?? [];
  const build = async () => {
    if (!context || context.dirty || !publication || running.current || !currentProvenance || problems.length) return;
    running.current = true; setBusy(true); setError('');
    const request = generation.current; selection.current++;
    try {
      const projected = await exportMystPublicationArchive(publication, 'latex');
      const packageFiles = await JSZip.loadAsync(projected);
      packageFiles.file('project.myst-project.json', raw, { date: new Date('1980-01-01T00:00:00Z') });
      const archive = await packageFiles.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      const value = await api.post<BuildDetail>(route, { revision: context.revision, blockId, archive: encode(archive) });
      if (request === generation.current) { setDetail(value); setInputPath(''); setPageNumber(1); await load(); }
    } catch (cause) { if (request === generation.current) setError(String((cause as Error).message)); }
    finally { running.current = false; if (request === generation.current) setBusy(false); }
  };
  const frozen = useMemo(() => detail ? importMystProjectSnapshot(detail.snapshot) : null, [detail]);
  useEffect(() => {
    let current = true; setGenerated('');
    if (detail) void JSZip.loadAsync(decode(detail.archive)).then(zip => zip.file('article.tex')!.async('string')).then(text => { if (current) setGenerated(text); })
      .catch(cause => { if (current) setError(String(cause.message)); });
    return () => { current = false; };
  }, [detail]);
  useEffect(() => {
    const controller = new AbortController(); setPage(null); setPageError('');
    if (detail?.pdf) void api.get<BuildPage>(`${route}/${detail.build.id}/pages/${pageNumber}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setPage({ buildId: detail.build.id, value }); })
      .catch(cause => { if (!controller.signal.aborted) setPageError(String(cause.message)); });
    return () => controller.abort();
  }, [detail, route, pageNumber]);
  const previous = builds.find(item => item.status === 'succeeded');
  const page = renderedPage?.buildId === detail?.build.id && renderedPage?.value.page === pageNumber ? renderedPage.value : null;
  const stale = !!detail && (!!context?.dirty || detail.snapshot !== raw);
  return <section className="notebook-publication-builds" aria-label={t('title')}>
    {!!currentProvenance?.value?.figures.length && <section aria-label={t('panels')}>
      <h4>{t('panels')}</h4>
      {!problems.length && <p>{t('checked')}</p>}
      {currentProvenance.value.figures.map(figure => <div key={figure.id}>
        <strong>{figure.id} · {figure.path}</strong>
        {figure.panels.map(panel => <div key={panel.id} className="notebook-publication-panel">
          <span>{panel.id.toUpperCase()} · {panel.label}</span>
          {[...panel.data, ...panel.code].map(item => <Button key={item.path} variant="ghost" title={item.locator} onClick={() => {
            const name = item.locator?.match(/^function (\w+)$/)?.[1];
            const text = snapshot.files.find(file => file.path === item.path)?.text;
            const offset = name ? text?.indexOf(`def ${name}(`) : undefined;
            onEdit(item.path, offset !== undefined && offset >= 0 ? text!.slice(0, offset).split('\n').length : undefined);
          }}>{t(context?.readonly ? 'view' : 'edit', { path: item.path })}{item.locator ? ` · ${item.locator}` : ''}</Button>)}
        </div>)}
      </div>)}
    </section>}
    {problems.map(problem => <Feedback key={problem} kind="warning">{problem}</Feedback>)}
    {context && <>
      <h4>{t('title')}</h4>
      <p>{t('meaning')}</p>
      {context.dirty && <p>{t('saved')}</p>}
      <div className="notebook-myst-actions">
        {!context.readonly && <Button variant="primary" disabled={busy || context.dirty || formatting || !publication || !currentProvenance || !!problems.length} onClick={() => void build()}>{busy ? t('building') : t('build')}</Button>}
        <Button disabled={loading || busy} onClick={() => void load()}>{t('retry')}</Button>
      </div>
      {!currentProvenance && <p role="status">{t('checking')}</p>}
      {loading && <p role="status">{t('loading')}</p>}
      {error && <Feedback kind="error">{error}</Feedback>}
      {!!builds.length && <Select label={t('history')} disabled={busy} value={detail?.build.id ?? ''} options={builds.map(item => ({ value: item.id, label: `r${item.revision} · ${t(item.status)} · ${item.id.slice(0, 8)}` }))} onChange={id => void open(id)} />}
      {detail && <>
        <p role="status"><strong>{t(detail.build.status)}</strong> · r{detail.build.revision} · {detail.build.id.slice(0, 8)} · {detail.build.engine}</p>
        {stale && <Feedback kind="warning">{t('stale', { revision: detail.build.revision })}</Feedback>}
        <div className="notebook-myst-actions">
          {detail.pdf && <Button onClick={() => downloadFile(`publication-${detail.build.id}.pdf`, decode(detail.pdf!), 'application/pdf')}>{t('pdf')}</Button>}
          <Button onClick={() => downloadFile(`publication-${detail.build.id}.zip`, decode(detail.archive), 'application/zip')}>{t('archive')}</Button>
          <Button onClick={() => downloadFile(`publication-r${detail.build.revision}.myst-project.json`, new TextEncoder().encode(detail.snapshot), 'application/json')}>{t('snapshot')}</Button>
          {!detail.pdf && previous && <Button onClick={() => void open(previous.id)}>{t('previous')}</Button>}
          {!context.readonly && <Button onClick={() => onEdit(snapshot.entry)}>{t('edit', { path: snapshot.entry })}</Button>}
        </div>
        {!!detail.build.diagnostics.length && <section aria-label={t('diagnostics')}>
          <strong>{t('diagnostics')}</strong><ul>{detail.build.diagnostics.map((diagnostic, index) => <li key={index}>
            {diagnostic.path === 'article.tex' && diagnostic.line ? <Button variant="ghost" onClick={() => {
              if (generatedSection.current) generatedSection.current.open = true;
              const editor = generatedEditor.current;
              if (editor) {
                const start = generated.split('\n').slice(0, diagnostic.line! - 1).join('\n').length + (diagnostic.line! > 1 ? 1 : 0);
                editor.focus(); editor.setSelectionRange(start, generated.indexOf('\n', start) < 0 ? generated.length : generated.indexOf('\n', start));
                editor.scrollIntoView({ block: 'center', behavior: 'instant' });
              }
            }}>{diagnostic.path}:{diagnostic.line}</Button> : diagnostic.path}
            {' '}{diagnostic.message}</li>)}</ul>
        </section>}
        {detail.pdf && <section aria-label={t('preview')}>
          {pageError && <Feedback kind="error">{pageError}</Feedback>}
          {!page && !pageError && <p role="status">{t('loading')}</p>}
          {page && <>
            <div className="notebook-myst-actions"><Button disabled={page.page <= 1} onClick={() => setPageNumber(page.page - 1)}>{t('before')}</Button><span>{t('page')} {page.page} / {page.pages}</span><Button disabled={page.page >= page.pages} onClick={() => setPageNumber(page.page + 1)}>{t('next')}</Button></div>
            <img className="notebook-publication-page" src={`data:image/png;base64,${page.base64}`} alt={`${t('preview')} · r${detail.build.revision} · ${page.page}/${page.pages}`} />
          </>}
        </section>}
        {frozen && <Disclosure summary={t('source')}>
          <Select label={t('resource')} value={inputPath || frozen.entry} options={frozen.files.map(file => ({ value: file.path, label: file.path }))} onChange={setInputPath} />
          <Field label={t('source')}>{control => <Textarea {...control} rows={10} className="notebook-myst-source" readOnly value={frozen.files.find(file => file.path === (inputPath || frozen.entry))?.text ?? ''} />}</Field>
        </Disclosure>}
        <Disclosure ref={generatedSection} summary={t('generated')}><Field label={t('generated')}>{control => <Textarea {...control} ref={generatedEditor} rows={12} className="notebook-myst-source" readOnly value={generated} />}</Field></Disclosure>
        <Disclosure summary={t('log')}><p>Source SHA-256: {detail.build.sourceSha256}<br />Archive SHA-256: {detail.build.archiveSha256}<br />PDF SHA-256: {detail.build.pdfSha256 ?? '—'}<br />TeX cache: {detail.build.texCache ?? '—'}</p><pre>{detail.build.command.join(' ')}{'\n'}{detail.build.log}</pre></Disclosure>
      </>}
    </>}
  </section>;
}
