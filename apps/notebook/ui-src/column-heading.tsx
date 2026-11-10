import { useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Input } from '@pero/app-sdk/ui';
import { columnHeading, renameGridColumn, type WorksheetGrid } from '@pero/notebook/grid-presentation';

const messages = {
  renameColumn: { en: 'Rename column', zh: '重命名列' },
  columnName: { en: 'Column name', zh: '列名' },
  confirm: { en: 'Confirm', zh: '确认' },
  cancel: { en: 'Cancel', zh: '取消' },
  close: { en: 'Close', zh: '关闭' },
} as const;

/** The visible heading. Formula addresses stay A/B/C; this text is the domain name. */
export function ColumnHeading({ index, names }: { index: number; names: Record<string, string> }) {
  return columnHeading(index, names);
}

/** Rename stays a dialog. The document edit is the caller's commit of renameGridColumn. */
export function RenameColumnDialog({ column, initialName, commit, onInvalid, onClose }: {
  column: number;
  initialName: string;
  commit: (edit: (current: WorksheetGrid) => WorksheetGrid | null) => boolean;
  onInvalid: () => void;
  onClose: () => void;
}) {
  const { t } = useAppI18n(messages);
  const [name, setName] = useState(initialName);
  return <Dialog title={t('renameColumn')} closeLabel={t('close')} onClose={onClose}
    onSubmit={event => {
      event.preventDefault();
      const applied = commit(current => renameGridColumn(current, column, name));
      if (!applied) { onInvalid(); return; }
      onClose();
    }}
    footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button type="submit">{t('confirm')}</Button></>}>
    <label className="notebook-field">{t('columnName')}
      <Input value={name} maxLength={80} onChange={event => setName(event.target.value)} />
    </label>
  </Dialog>;
}
