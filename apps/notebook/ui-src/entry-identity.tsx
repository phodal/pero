import { useAppI18n } from '@pero/app-sdk';
import { Button } from '@pero/app-sdk/ui';
import { entryIdentity, type EntryIdentity as EntryIdentityValue } from '@pero/notebook/entry-record';

const messages = {
  in_progress: { en: 'In progress', zh: '进行中' },
  statusCompleted: { en: 'Completed', zh: '已完成' },
} as const;

/** Entry code derived from the entry id, plus the persisted in-progress / completed toggle. */
export function EntryIdentity({ entryId, stored, readonly, onChange }: {
  entryId: string;
  stored?: EntryIdentityValue | null;
  readonly: boolean;
  onChange: (partial: { identity: EntryIdentityValue }) => void;
}) {
  const { t } = useAppI18n(messages);
  const identity = entryIdentity(entryId, stored);
  if (!identity) return null;
  return <>
    <span className="notebook-entry-code">{identity.code}</span>
    <Button variant="ghost" className="notebook-entry-status" data-status={identity.status} disabled={readonly}
      onClick={() => onChange({ identity: { code: identity.code, status: identity.status === 'in_progress' ? 'completed' : 'in_progress' } })}>
      {t(identity.status === 'in_progress' ? 'in_progress' : 'statusCompleted')}
    </Button>
  </>;
}
