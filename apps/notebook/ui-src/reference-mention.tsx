import { Node, type Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Feedback, Input } from '@pero/app-sdk/ui';
import { type ScientificReference, scientificReferenceState } from '@pero/notebook';

export type ReferenceMentionAttributes = { label: string; source: ScientificReference };
/** The clipboard boundary accepts only a bounded, pinned identity; no HTML or href is executed. */
export function isReferenceMention(value: unknown): value is ReferenceMentionAttributes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { label, source } = value as ReferenceMentionAttributes;
  if (Object.keys(value).some(key => key !== 'label' && key !== 'source') || typeof label !== 'string' ||
    !label.trim() || Array.from(label).length > 200 || !source || typeof source !== 'object' || Array.isArray(source)) return false;
  const fields = ['app', 'kind', 'id', 'version', 'locator'];
  if (Object.keys(source).length !== fields.length || fields.some(key => {
    const field = source[key as keyof ScientificReference];
    return typeof field !== 'string' || field.length > 1024 || /[\u0000-\u001f\u007f]/.test(field);
  })) return false;
  return scientificReferenceState(source) === 'pinned';
}

export const ReferenceMention = Node.create({
  name: 'referenceMention', group: 'inline', inline: true, atom: true,
  addAttributes() { return {
    label: { default: '', rendered: false, parseHTML: () => null },
    source: { default: null, rendered: false, parseHTML: () => null },
  }; },
  parseHTML() { return [{ tag: 'span[data-notebook-reference]', getAttrs: element => {
    try {
      const attrs = JSON.parse(element.getAttribute('data-notebook-reference') ?? 'null');
      return isReferenceMention(attrs) ? attrs : false;
    } catch { return false; }
  } }]; },
  renderHTML({ node }) {
    const { label, source } = node.attrs;
    if (!isReferenceMention({ label, source })) return ['span', {}, label || ''];
    return ['span', { class: 'notebook-reference-mention', 'data-notebook-reference': JSON.stringify({ label, source }),
      title: `${source.app} / ${source.kind} / ${source.id} @ ${source.version}`, contenteditable: 'false' }, `@${label}`];
  },
  renderText({ node }) { return `@${node.attrs.label}`; },
});

const messages = {
  insert: { en: 'Mention reference', zh: '引用本地实体' },
  close: { en: 'Close', zh: '关闭' },
  search: { en: 'Search references in this notebook', zh: '搜索此笔记中的引用' },
  empty: { en: 'No matching pinned references. Add evidence with an ID and version to this notebook first.', zh: '未找到匹配的固定版本引用。请先在此笔记中添加具有 ID 和版本的证据。' },
};

/** Select actual versioned evidence already in this document, never invented catalog entries. */
export function NotebookReferenceMentionPicker({ editor }: { editor: Editor }) {
  const { t } = useAppI18n(messages);
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null);
  const [query, setQuery] = useState('');
  const state = useEditorState({ editor, selector: ({ editor: instance }) => {
    const references: ReferenceMentionAttributes[] = [];
    const seen = new Set<string>();
    instance.state.doc.descendants(node => {
      if (node.type.name !== 'evidence' && node.type.name !== 'experiment') return;
      const value = { label: node.attrs.label || node.attrs.source?.id, source: node.attrs.source };
      if (!isReferenceMention(value)) return;
      const key = JSON.stringify(value.source);
      if (!seen.has(key)) { seen.add(key); references.push(value); }
    });
    return { references, editable: instance.isEditable, inline: instance.state.selection.$from.parent.inlineContent };
  } });
  if (!state.editable) return null;
  const matches = state.references.filter(item => `${item.label} ${Object.values(item.source).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <Button variant="ghost" disabled={!state.inline} onMouseDown={event => event.preventDefault()}
      onClick={() => { setSelection({ from: editor.state.selection.from, to: editor.state.selection.to }); setQuery(''); }}>{t('insert')}</Button>
    {selection && <Dialog title={t('insert')} closeLabel={t('close')} onClose={() => setSelection(null)} size="sm">
      <Input aria-label={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
      {!matches.length && <Feedback kind="info">{t('empty')}</Feedback>}
      {matches.map((item, index) => <Button key={index} variant="ghost" title={`${item.source.id} @ ${item.source.version}`}
        onClick={() => {
          if (editor.isEditable) editor.chain().focus().setTextSelection(selection)
            .insertContent({ type: 'referenceMention', attrs: item }).run();
          setSelection(null);
        }}>{item.label} · {item.source.version}</Button>)}
    </Dialog>}
  </>;
}
