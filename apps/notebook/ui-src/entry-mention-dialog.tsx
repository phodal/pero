import type { Editor } from '@tiptap/core';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Field, Input } from '@pero/app-sdk/ui';
import { recordMention, type EntryNotice } from '@pero/notebook/entry-record';

const messages = {
  mention: { en: 'Mention someone', zh: '提及某人' },
  mentionName: { en: 'Name', zh: '姓名' },
  mentionNote: { en: 'Note', zh: '备注' },
  mentionInvalid: { en: 'Enter a name. The mention stays on this entry and is not sent.', zh: '请输入姓名。提及只记在本条目上，不会发送。' },
  mentionLocal: { en: 'Kept on this entry. No invitation or message is sent.', zh: '只保存在本条目。不会发送邀请或消息。' },
  close: { en: 'Close', zh: '关闭' },
  cancel: { en: 'Cancel', zh: '取消' },
} as const;

export type MentionDraft = { name: string; note: string };

/** Records a name and note on the entry, then inserts @Name. Nothing is sent. */
export function EntryMentionDialog({ draft, notices, editor, onDraft, onClose, onSaved, onInvalid }: {
  draft: MentionDraft;
  notices: readonly EntryNotice[];
  editor: Editor;
  onDraft: (draft: MentionDraft) => void;
  onClose: () => void;
  onSaved: (notices: EntryNotice[]) => void;
  onInvalid: (message: string) => void;
}) {
  const { t } = useAppI18n(messages);
  const save = () => {
    const next = recordMention(notices, { id: crypto.randomUUID(), name: draft.name, note: draft.note, at: new Date().toISOString() });
    if (!next) { onInvalid(t('mentionInvalid')); return; }
    onSaved(next);
    const name = next[next.length - 1].name;
    if (!editor.isDestroyed && editor.isEditable) editor.chain().focus().insertContent(`@${name} `).run();
    onClose();
  };
  return <Dialog title={t('mention')} closeLabel={t('close')} onClose={onClose} onSubmit={event => { event.preventDefault(); save(); }}
    footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button type="submit">{t('mention')}</Button></>}>
    <p className="notebook-note">{t('mentionLocal')}</p>
    <Field label={t('mentionName')}>{control => <Input {...control} value={draft.name} maxLength={80} onChange={event => onDraft({ ...draft, name: event.target.value })} />}</Field>
    <Field label={t('mentionNote')}>{control => <Input {...control} value={draft.note} maxLength={500} onChange={event => onDraft({ ...draft, note: event.target.value })} />}</Field>
  </Dialog>;
}
