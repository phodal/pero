import { useId, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Feedback, Field, Icon, IconButton, Input } from '@pero/app-sdk/ui';
import { changeMetadata, workspaceLimits, type MetadataChange, type NotebookMetadata } from '@pero/notebook/workspace';
const messages = {
  project: { en: 'Project label', zh: '项目标签' }, author: { en: 'Author label', zh: '作者标签' },
  tags: { en: 'Tags', zh: '标签' }, tag: { en: 'New tag', zh: '新标签' }, addTag: { en: 'Add tag', zh: '添加标签' },
  removeTag: { en: 'Remove tag {name}', zh: '移除标签 {name}' }, noTags: { en: 'No tags', zh: '暂无标签' },
  duplicate: { en: 'That tag already exists.', zh: '该标签已存在。' }, invalid: { en: 'Check the field value and its stated limit.', zh: '请检查字段值及其限制。' },
  limit: { en: 'This list has reached its size limit.', zh: '此列表已达到数量上限。' },
} as const;

export function MetadataView({ metadata, readonly, onChange, choices }: {
  metadata: NotebookMetadata; readonly: boolean; onChange: (metadata: NotebookMetadata) => void; choices?: { project: string[]; author: string[] };
}) {
  const { t } = useAppI18n(messages);
  const id = useId();
  const [tag, setTag] = useState(''), [error, setError] = useState('');
  const apply = (change: MetadataChange) => {
    if (readonly) return;
    const result = changeMetadata(metadata, change);
    if (result.status !== 'ok') { setError(t(result.status)); return; }
    setError(''); onChange(result.metadata);
    if (change.type === 'addTag') setTag('');
  };
  return <div className="notebook-workspace-form">

    {(['project', 'author'] as const).map(key => <Field key={key} label={t(key)}>{control =>
      <><Input {...control} list={`${id}-${key}`} data-notebook-document-edit value={metadata[key]} readOnly={readonly} maxLength={workspaceLimits.label}
        onChange={event => apply({ type: key, value: event.target.value })} /><datalist id={`${id}-${key}`}>{choices?.[key].map(value => <option key={value} value={value} />)}</datalist></>}</Field>)}
    <section aria-label={t('tags')}>
      <h3>{t('tags')}</h3>
      <ul className="notebook-tag-list">{metadata.tags.map((value, index) => <li key={`${index}:${value}`}>
        <Badge>{value}</Badge>{!readonly && <IconButton label={t('removeTag', { name: value })}
          onClick={() => apply({ type: 'removeTag', index })}><Icon name="close" /></IconButton>}
      </li>)}</ul>
      {!readonly && <form className="notebook-workspace-actions" onSubmit={event => { event.preventDefault(); apply({ type: 'addTag', value: tag }); }}>
        <Input aria-label={t('tag')} placeholder={t('tag')} maxLength={workspaceLimits.tagLength} value={tag} onChange={event => setTag(event.target.value)} />
        <Button type="submit" disabled={!tag.trim() || metadata.tags.length >= workspaceLimits.tags}>{t('addTag')}</Button>
      </form>}
    </section>
    {error && <Feedback kind="error">{error}</Feedback>}
  </div>;
}

