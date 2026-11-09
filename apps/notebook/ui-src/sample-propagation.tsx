import { useState } from 'react';
import { useEditorState, type NodeViewProps } from '@tiptap/react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, NativeSelect } from '@pero/app-sdk/ui';
import { applyIntakePropagation, stageIntakePropagation, type IntakePropagation, type SampleIntake } from '@pero/notebook/sample-intake';

const messages = {
  title: { en: 'Propagate selected source bindings', zh: '传播已选择的来源绑定' },
  scope: { en: 'Stage and review copies of these pinned bindings in another sample-intake block. This changes local notebook associations only, never stock, locations or instrument worklists.', zh: '将这些固定版本的绑定暂存并复核后复制到另一个样品来源块。仅修改本地笔记关联，不更改库存、位置或仪器工作清单。' },
  target: { en: 'Destination intake block', zh: '目标样品来源块' }, choose: { en: 'Choose a destination', zh: '选择目标' },
  empty: { en: 'Add another sample-intake block to receive bindings.', zh: '请添加另一个样品来源块以接收绑定。' },
  stage: { en: 'Stage propagation', zh: '暂存传播' }, apply: { en: 'Apply staged bindings', zh: '应用暂存绑定' }, cancel: { en: 'Cancel staged propagation', zh: '取消暂存传播' },
  preview: { en: '{count} pinned bindings will be appended to {target}. Existing destination bindings are retained.', zh: '将向 {target} 添加 {count} 个固定版本的绑定，并保留目标已有绑定。' },
  applied: { en: 'Bindings copied to the destination. No physical inventory was changed.', zh: '绑定已复制到目标，未修改物理库存。' },
  missing: { en: 'The source or destination was removed. Choose a destination and stage again.', zh: '来源或目标已被删除，请重新选择目标并暂存。' },
} as const;

export function SamplePropagation({ view }: { view: NodeViewProps }) {
  const { t } = useAppI18n(messages);
  const [targetId, setTargetId] = useState(''), [plan, setPlan] = useState<IntakePropagation | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const sources = useEditorState({ editor: view.editor, selector: ({ editor }) => {
    const entries: { id: string; pos: number; intake: SampleIntake }[] = [];
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'sampleIntake') entries.push({ id: node.attrs.blockId, pos, intake: node.attrs.intake }); });
    return entries;
  } });
  const sourceId = view.node.attrs.blockId as string, destinations = sources.filter(item => item.id && item.id !== sourceId);
  const editable = view.editor.isEditable;
  function stage() {
    setError(''); setNotice('');
    try {
      const source = sources.find(item => item.id === sourceId), target = sources.find(item => item.id === targetId);
      if (!source || !target) throw new Error(t('missing'));
      setPlan(stageIntakePropagation(sourceId, source.intake, targetId, target.intake));
    } catch (cause) { setPlan(null); setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function apply() {
    if (!plan || !editable) return;
    try {
      // Re-read live document identities, not stale positions retained by a preview.
      const current = new Map<string, { pos: number; intake: SampleIntake }>();
      view.editor.state.doc.descendants((node, pos) => { if (node.type.name === 'sampleIntake') current.set(node.attrs.blockId, { pos, intake: node.attrs.intake }); });
      const source = current.get(plan.sourceId), target = current.get(plan.targetId);
      if (!source || !target) throw new Error(t('missing'));
      const intake = applyIntakePropagation(plan, source.intake, target.intake), node = view.editor.state.doc.nodeAt(target.pos)!;
      view.editor.view.dispatch(view.editor.state.tr.setNodeMarkup(target.pos, undefined, { ...node.attrs, intake }));
      setPlan(null); setError(''); setNotice(t('applied'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <details><summary>{t('title')}</summary><p>{t('scope')}</p>
    {!destinations.length ? <p>{t('empty')}</p> : <>
      <Field label={t('target')}>{control => <NativeSelect {...control} value={targetId} disabled={!editable} onChange={event => { setTargetId(event.target.value); setPlan(null); setNotice(''); setError(''); }}>
        <option value="">{t('choose')}</option>{destinations.map(item => <option key={item.id} value={item.id}>{item.intake.name || item.id}</option>)}
      </NativeSelect>}</Field>
      <Button variant="ghost" disabled={!editable || !targetId} onClick={stage}>{t('stage')}</Button>
    </>}
    {error && <Feedback kind="error">{error}</Feedback>}{notice && <Feedback kind="success">{notice}</Feedback>}
    {plan && <div>
      <p>{t('preview', { count: plan.bindingCount, target: plan.targetAfter.name || plan.targetId })}</p>
      <ul>{plan.targetAfter.bindings.slice(-plan.bindingCount).map((binding, index) => <li key={index}>{binding.snapshot.records[0].name} / {binding.snapshot.records[0].id} / v{binding.snapshot.records[0].version} · {binding.source.well || '∅'} · {binding.snapshot.catalogId}</li>)}</ul>
      <Button disabled={!editable} onClick={apply}>{t('apply')}</Button><Button variant="ghost" onClick={() => { setPlan(null); setError(''); }}>{t('cancel')}</Button>
    </div>}
  </details>;
}
