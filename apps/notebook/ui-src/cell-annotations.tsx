import { useEditorState, type NodeViewProps } from '@tiptap/react';
import { useAppI18n } from '@pero/app-sdk';
import { Checkbox, Input } from '@pero/app-sdk/ui';
import type { CellAnnotation } from '@pero/notebook';
import { notebookEvidence } from './evidence-model';

const messages = {
  metadata: { en: 'Cell details', zh: '单元格详情' },
  unit: { en: 'Unit', zh: '单位' },
  evidence: { en: 'Evidence', zh: '证据' },
  missing: { en: 'Missing evidence', zh: '证据缺失' },
  unpinned: { en: 'Source version missing', zh: '来源版本缺失' },
  empty: { en: 'Add an evidence block with a source version to link it here.', zh: '先添加带来源版本的证据块，再在此关联。' },
} as const;

export function CellAnnotations({ view, address, editable }: {
  view: NodeViewProps; address: string; editable: boolean;
}) {
  const { t } = useAppI18n(messages);
  const annotations = (view.node.attrs.annotations ?? {}) as Record<string, CellAnnotation>;
  const current = annotations[address] ?? { unit: '', evidenceIds: [] };
  const evidence = useEditorState({
    editor: view.editor,
    selector: ({ editor }) => notebookEvidence(editor.state.doc),
  });
  if (!editable && !annotations[address]) return null;

  const apply = (next: CellAnnotation) => {
    const updated = { ...annotations };
    if (next.unit || next.evidenceIds.length) updated[address] = next;
    else delete updated[address];
    view.updateAttributes({ annotations: updated });
  };
  const sources = evidence.filter(source => (editable && source.pinned) || current.evidenceIds.includes(source.id));
  const missing = current.evidenceIds.filter(id => !evidence.some(source => source.id === id));
  const setSource = (id: string, checked: boolean) => apply({
    ...current,
    evidenceIds: checked ? [...current.evidenceIds, id] : current.evidenceIds.filter(value => value !== id),
  });
  return <details className="notebook-cell-annotations">
    <summary>{t('metadata')} · {address}{current.unit && ` · ${current.unit}`}</summary>
    <label className="notebook-field">{t('unit')}
      <Input value={current.unit} readOnly={!editable} maxLength={128}
        onChange={event => apply({ ...current, unit: event.target.value })} />
    </label>
    <fieldset className="notebook-evidence-links">
      <legend>{t('evidence')}</legend>
      {editable && !sources.length && !missing.length && <p className="notebook-note">{t('empty')}</p>}
      {sources.map(source => <label key={source.id} className="notebook-checkbox">
        {editable && <Checkbox checked={current.evidenceIds.includes(source.id)}
          onCheckedChange={checked => setSource(source.id, checked === true)} />}
        <span>{source.label || source.id}{!source.pinned && ` · ${t('unpinned')}`}</span>
      </label>)}
      {missing.map(id => <label key={id} className="notebook-checkbox">
        {editable && <Checkbox checked onCheckedChange={() => setSource(id, false)} />}
        <span>{t('missing')} · <code>{id}</code></span>
      </label>)}
    </fieldset>
  </details>;
}
