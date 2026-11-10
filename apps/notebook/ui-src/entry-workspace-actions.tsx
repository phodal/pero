import { useAppI18n } from '@pero/app-sdk';
import { Button } from '@pero/app-sdk/ui';
import { changeProcedures, workspaceLimits, type NotebookProcedure } from '@pero/notebook/workspace';

const messages = {
  splitWorkspace: { en: 'Split workspace', zh: '拆分工作区' },
  addProtocol: { en: 'Add protocol', zh: '添加协议' },
  mention: { en: 'Mention someone', zh: '提及某人' },
  protocolLimit: { en: 'This entry already has the maximum number of protocols.', zh: '本条目的协议数量已达上限。' },
} as const;

/** Split, add protocol, and mention controls for the entry view menu. */
export function EntryWorkspaceActions({ readonly, split, procedures, onToggleSplit, onAdded, onError, onMention }: {
  readonly: boolean;
  split: boolean;
  procedures: NotebookProcedure[];
  onToggleSplit: () => void;
  onAdded: (procedures: NotebookProcedure[], id: string) => void;
  onError: (message: string) => void;
  onMention: () => void;
}) {
  const { t } = useAppI18n(messages);
  if (readonly) return null;
  const addProtocol = () => {
    const id = crypto.randomUUID();
    const result = changeProcedures(procedures, { type: 'add', id, title: t('addProtocol') });
    if (result.status !== 'ok') { onError(t('protocolLimit')); return; }
    onAdded(result.procedures, id);
  };
  return <>
    <Button variant="ghost" aria-pressed={split} onClick={onToggleSplit}>{t('splitWorkspace')}</Button>
    <Button variant="ghost" disabled={procedures.length >= workspaceLimits.procedures} onClick={addProtocol}>{t('addProtocol')}</Button>
    <Button variant="ghost" onClick={onMention}>{t('mention')}</Button>
  </>;
}
