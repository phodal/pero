import { useAppI18n } from '@pero/app-sdk';
import type { EntryNotice } from '@pero/notebook/entry-record';

const messages = {
  mention: { en: 'Mention someone', zh: '提及某人' },
  mentionLocal: { en: 'Kept on this entry. No invitation or message is sent.', zh: '只保存在本条目。不会发送邀请或消息。' },
} as const;

/** Mentions recorded on this entry. They are not invitations or messages. */
export function EntryNotices({ notices }: { notices: readonly EntryNotice[] }) {
  const { t } = useAppI18n(messages);
  if (!notices.length) return null;
  return <ul className="notebook-relevant-list" aria-label={t('mention')}>
    {notices.map(item => <li key={item.id}><strong>@{item.name}</strong> <span>{item.note}</span> <p className="notebook-note">{t('mentionLocal')}</p></li>)}
  </ul>;
}
