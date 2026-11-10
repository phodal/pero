import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Icon, Input } from '@pero/app-sdk/ui';
import { parseCellUrl } from '@pero/notebook';
import { setCellLink, type WorksheetGrid } from '@pero/notebook/grid-presentation';

const messages = {
  cellLink: { en: 'Cell link', zh: '单元格链接' },
  linkAddress: { en: 'Link address', zh: '链接地址' },
  url: { en: 'Link', zh: '链接' },
  confirm: { en: 'Confirm', zh: '确认' },
  cancel: { en: 'Cancel', zh: '取消' },
  close: { en: 'Close', zh: '关闭' },
} as const;

type Commit = (edit: (current: WorksheetGrid) => WorksheetGrid | null) => boolean;

/** Format-bar button. The dialog is portaled so the bar's icon rules do not restyle it. */
function CellLinkButton({ address, url, commit, onInvalid }: {
  address: string;
  url?: string;
  commit: Commit;
  onInvalid: () => void;
}) {
  const { t } = useAppI18n(messages);
  const [draft, setDraft] = useState<string | null>(null);
  const close = () => setDraft(null);
  return <>
    <Button variant="ghost" aria-label={t('cellLink')} aria-pressed={!!url}
      onClick={() => setDraft(url ?? '')}><Icon name="link" /></Button>
    {draft !== null && createPortal(<Dialog title={t('cellLink')} closeLabel={t('close')} onClose={close}
      onSubmit={event => {
        event.preventDefault();
        const parsed = parseCellUrl(draft);
        const applied = commit(current => setCellLink(current, address, draft));
        if (parsed === null || !applied) { onInvalid(); return; }
        close();
      }}
      footer={<><Button variant="ghost" onClick={close}>{t('cancel')}</Button><Button type="submit">{t('confirm')}</Button></>}>
      <label className="notebook-field">{t('linkAddress')}
        <Input type="url" value={draft} maxLength={2048} onChange={event => setDraft(event.target.value)} />
      </label>
    </Dialog>, document.body)}
  </>;
}

/** Cell-details field. Invalid text, including non-http(s) URLs, is restored and not stored. */
function CellLinkField({ address, grid, editable, onAnnotations }: {
  address: string;
  grid: WorksheetGrid;
  editable: boolean;
  onAnnotations: (annotations: WorksheetGrid['annotations']) => void;
}) {
  const { t } = useAppI18n(messages);
  const url = grid.annotations[address]?.url ?? '';
  return <label className="notebook-field">{t('url')}
    <Input key={`${address}:${url}`} defaultValue={url} readOnly={!editable} maxLength={2048}
      onBlur={event => {
        const raw = event.target.value;
        const parsed = parseCellUrl(raw);
        const next = setCellLink(grid, address, raw);
        if (parsed === null || !next) { event.target.value = url; return; }
        onAnnotations(next.annotations);
      }} />
  </label>;
}

export function CellLinkControl(props:
  | ({ variant: 'button' } & Parameters<typeof CellLinkButton>[0])
  | ({ variant: 'field' } & Parameters<typeof CellLinkField>[0])) {
  if (props.variant === 'field') return <CellLinkField address={props.address} grid={props.grid} editable={props.editable} onAnnotations={props.onAnnotations} />;
  return <CellLinkButton address={props.address} url={props.url} commit={props.commit} onInvalid={props.onInvalid} />;
}
