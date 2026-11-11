import { NotebookProjectAssociations } from './notebook-projects';
import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Dialog, Disclosure, Feedback, Field, Input } from '@pero/app-sdk/ui';
import { scientificReferenceState, type NotebookDocument, type NotebookEntry, type ScientificReference } from '@pero/notebook';
import { notebookContentRoots, type NotebookMetadata } from '@pero/notebook/workspace';
import type { TemplateOrigin } from '@pero/notebook/templates';
import type { AttachmentAttributes } from '@pero/notebook/attachment';
import { messages } from './messages';

interface HomeEntry { entryId: string; title: string; revision: number; project: string; author: string }
interface HomeLibrary { scope: 'local-display-labels'; entries: HomeEntry[]; limited: boolean }
export interface NotebookHomeProps {
  entry: NotebookEntry; document: NotebookDocument; dirty: boolean; readonly: boolean;
  onOpenEntry(id: string): void; onMetadata?(metadata: NotebookMetadata): void;
}

export function NotebookHomeTools(props: NotebookHomeProps) {
  const { t } = useAppI18n(messages);
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" onClick={() => setOpen(true)}>{t('notebookHome')}</Button>{open && <NotebookHome {...props} onClose={() => setOpen(false)} />}</>;
}

export function NotebookHome({ entry, document, dirty, readonly, onOpenEntry, onMetadata, onClose }: NotebookHomeProps & { onClose(): void }) {
  const { t, locale } = useAppI18n(messages);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const api = useAppApi(), initial = useRef(document.metadata ?? { project: '', author: '', tags: [] });
  const [project, setProject] = useState(initial.current.project), [author, setAuthor] = useState(initial.current.author);
  const [library, setLibrary] = useState<HomeLibrary | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const live = useRef(true), request = useRef(0);
  useEffect(() => () => { live.current = false; request.current++; }, []);
  const load = async () => {
    const generation = ++request.current; setBusy(true); setError('');
    try {
      const result = await api.get<HomeLibrary>('/api/notebook-home');
      if (live.current && generation === request.current) setLibrary(result);
    } catch (cause) { if (live.current && generation === request.current) setError(String(cause)); }
    finally { if (live.current && generation === request.current) setBusy(false); }
  };
  useEffect(() => { void load(); }, [api]);
  const origins = new Map<string, TemplateOrigin>(), sources: { blockId: string; source: ScientificReference }[] = [], files: { blockId: string; file: AttachmentAttributes }[] = [];
  if (document.templateOrigin) origins.set(document.templateOrigin.instanceId, document.templateOrigin);
  const walk = (node: NotebookDocument['content'] | NotebookDocument['content']['content'][number]) => {
    const attrs = node.attrs ?? {}, origin = attrs.templateOrigin as TemplateOrigin | null;
    if (origin) origins.set(origin.instanceId, origin);
    if (['evidence', 'experiment', 'referenceMention'].includes(node.type) && attrs.source) sources.push({ blockId: String(attrs.blockId ?? ''), source: attrs.source as ScientificReference });
    if (node.type === 'attachment') files.push({ blockId: String(attrs.blockId ?? ''), file: attrs as unknown as AttachmentAttributes });
    node.content?.forEach(walk);
  };
  notebookContentRoots(document).forEach(walk);
  const choices = (field: 'project' | 'author') => [...new Set((library?.entries ?? []).map(item => item[field]).filter(Boolean))].sort();
  const changed = project !== initial.current.project || author !== initial.current.author;
  return <Dialog title={t('notebookHomeTitle')} closeLabel={t('closeAction')} size="lg" onClose={onClose}>
    <h3>{document.title}</h3><p>{t('revision', { number: entry.revision })} · {new Date(entry.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}
      {dirty && <Badge>{t('draftChanges')}</Badge>}</p>
    <Disclosure variant="inline" summary={t('projectAssociations')} open={projectsOpen} onOpenChange={setProjectsOpen}>
      {projectsOpen && <NotebookProjectAssociations entryId={entry.id} revision={entry.revision} readonly={readonly} dirty={dirty} onOpenEntry={id => { onOpenEntry(id); onClose(); }} />}
    </Disclosure>
    <section aria-label={t('homeLabelsSection')}><h4>{t('homeLabelsSection')}</h4>
      <p>{t('homeLabelsHint')}</p>
      {(['project', 'author'] as const).map(field => <div key={field}>
        <Field label={field === 'project' ? t('projectLabel') : t('authorLabel')}>{control => <Input {...control} list={`notebook-${entry.id}-${field}`} disabled={readonly} maxLength={200} value={field === 'project' ? project : author} onChange={event => (field === 'project' ? setProject : setAuthor)(event.target.value)} />}</Field>
        <datalist id={`notebook-${entry.id}-${field}`}>{choices(field).map(value => <option key={value} value={value} />)}</datalist>
      </div>)}
      {!readonly && <Button variant="primary" disabled={!changed || !onMetadata} onClick={() => {
        if (JSON.stringify(document.metadata ?? { project: '', author: '', tags: [] }) !== JSON.stringify(initial.current)) { setError(t('homeMetadataChanged')); return; }
        onMetadata?.({ ...initial.current, project, author }); onClose();
      }}>{t('applyLabelsToDraft')}</Button>}
    </section>
    <Disclosure summary={t('templateProvenance', { count: origins.size })}><ul>{[...origins.values()].map(origin => <li key={origin.instanceId}>{origin.templateId} · v{origin.revision} · instance {origin.instanceId}<pre className="notebook-science-json">{JSON.stringify({ parameters: origin.parameterValues, identities: origin.idMap }, null, 2)}</pre></li>)}</ul>{!origins.size && <p>{t('noTemplateOrigin')}</p>}</Disclosure>
    <Disclosure summary={t('scientificSourceIdentities', { count: sources.length })}><ul>{sources.map(({ blockId, source }, index) => <li key={index}>{blockId} · {source.app} / {source.kind} / {source.id} · {source.version || t('unpinnedVersion')} <Badge>{scientificReferenceState(source)}</Badge><p>{source.locator}</p></li>)}</ul><p>{t('recordedIdentitiesHint')}</p></Disclosure>
    <Disclosure summary={t('embeddedFileProvenance', { count: files.length })}><ul>{files.map(({ blockId, file }) => <li key={blockId}>{file.filename} · {file.mime}<p style={{ overflowWrap: 'anywhere' }}>SHA-256: {file.sha256}</p><p>{t('recordedImageEdits', { count: file.derivation?.steps.length ?? 0 })}</p></li>)}</ul></Disclosure>
    <Disclosure variant="inline" summary={t('recordIdentifiers')}><p>{entry.id} · schema {document.schemaVersion}</p><p>{t('homeOwnershipHint')}</p></Disclosure>
    {error && <Feedback kind="error">{error}</Feedback>}
  </Dialog>;
}
