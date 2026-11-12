import { MetadataView } from './notebook-metadata';
import { NotebookProjectAssociations } from './notebook-projects';
import { useEffect, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Dialog, Disclosure, Feedback } from '@pero/app-sdk/ui';
import { scientificReferenceState, type NotebookDocument, type NotebookEntry, type ScientificReference } from '@pero/notebook';
import { notebookContentRoots, type NotebookMetadata } from '@pero/notebook/workspace';
import type { TemplateOrigin } from '@pero/notebook/templates';
import type { AttachmentAttributes } from '@pero/notebook/attachment';
import { messages } from './messages';

interface HomeEntry { entryId: string; title: string; revision: number; project: string; author: string }
interface HomeLibrary { scope: 'local-display-labels'; entries: HomeEntry[]; limited: boolean }
export interface NotebookHomeProps {
  embedded?: boolean; entry: NotebookEntry; document: NotebookDocument; dirty: boolean; readonly: boolean;
  onOpenEntry(id: string): void; onMetadata?(metadata: NotebookMetadata): void;
}

export function NotebookHomeTools(props: NotebookHomeProps) {
  const { t } = useAppI18n(messages);
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" onClick={() => setOpen(true)}>{t('notebookHome')}</Button>{open && <NotebookHome {...props} onClose={() => setOpen(false)} />}</>;
}

export function NotebookHome({ entry, document, dirty, readonly, onOpenEntry, onMetadata, onClose, embedded }: NotebookHomeProps & { onClose(): void }) {
  const { t } = useAppI18n(messages);

  const api = useAppApi();
  const [library, setLibrary] = useState<HomeLibrary | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api.get<HomeLibrary>('/api/notebook-home').then(value => { if (active) setLibrary(value); }).catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [api]);
  const choices = { project: [...new Set(library?.entries.map(item => item.project).filter(Boolean))].sort(), author: [...new Set(library?.entries.map(item => item.author).filter(Boolean))].sort() };
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
  const content = <>
    <NotebookProjectAssociations entryId={entry.id} revision={entry.revision} readonly={readonly} dirty={dirty} onOpenEntry={id => { onOpenEntry(id); onClose(); }} />
    <MetadataView choices={choices} metadata={document.metadata ?? { project: '', author: '', tags: [] }} readonly={readonly} onChange={value => onMetadata?.(value)} />
    {!!origins.size && <Disclosure summary={t('templateProvenance', { count: origins.size })}><ul>{[...origins.values()].map(origin => <li key={origin.instanceId}>{origin.templateId} · v{origin.revision} · instance {origin.instanceId}<pre className="notebook-science-json">{JSON.stringify({ parameters: origin.parameterValues, identities: origin.idMap }, null, 2)}</pre></li>)}</ul></Disclosure>}
    {!!sources.length && <Disclosure summary={t('scientificSourceIdentities', { count: sources.length })}><ul>{sources.map(({ blockId, source }, index) => <li key={index}>{blockId} · {source.app} / {source.kind} / {source.id} · {source.version || t('unpinnedVersion')} <Badge>{scientificReferenceState(source)}</Badge><p>{source.locator}</p></li>)}</ul><p>{t('recordedIdentitiesHint')}</p></Disclosure>}
    {!!files.length && <Disclosure summary={t('embeddedFileProvenance', { count: files.length })}><ul>{files.map(({ blockId, file }) => <li key={blockId}>{file.filename} · {file.mime}<p style={{ overflowWrap: 'anywhere' }}>SHA-256: {file.sha256}</p><p>{t('recordedImageEdits', { count: file.derivation?.steps.length ?? 0 })}</p></li>)}</ul></Disclosure>}
    <Disclosure variant="inline" summary={t('recordIdentifiers')}><p>{entry.id} · schema {document.schemaVersion}</p><p>{t('homeOwnershipHint')}</p></Disclosure>
    {error && <Feedback kind="error">{error}</Feedback>}
  </>;
  return embedded ? content : <Dialog title={t('notebookHomeTitle')} closeLabel={t('closeAction')} size="lg" onClose={onClose}>{content}</Dialog>;
}
