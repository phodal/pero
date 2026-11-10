import { useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Disclosure, Feedback, Field, Input, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import type { NotebookEntry, NotebookNode } from '@pero/notebook';
import { notebookContentRoots } from '@pero/notebook/workspace';
import type { Spreadsheet } from '@pero/notebook/spreadsheet';
import { messages } from './messages';

interface AmendmentReceipt { id: string; worksheetId: string; baseRevision: number; revision: number; author: string; reason: string; recordedAt: string; changes: { address: string; before: string; after: string }[] }
export function WorksheetAmendments({ entry, dirty, readonly = false, onCommitted }: { entry: NotebookEntry; dirty: boolean; readonly?: boolean; onCommitted(entry: NotebookEntry): void }) {
  const { t } = useAppI18n(messages);
  const api = useAppApi();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [worksheetId, setWorksheet] = useState(''), [address, setAddress] = useState('A1'), [value, setValue] = useState('');
  const [author, setAuthor] = useState(''), [reason, setReason] = useState(''), [preview, setPreview] = useState(false);
  const [receipts, setReceipts] = useState<AmendmentReceipt[]>([]), [operationId, setOperationId] = useState('');
  const worksheets: { id: string; label: string; sheet: Spreadsheet }[] = [];
  const visit = (node: NotebookNode) => { if (node.type === 'spreadsheet') worksheets.push({ id: String(node.attrs!.blockId), label: String(node.attrs!.label || node.attrs!.blockId), sheet: node.attrs!.sheet as Spreadsheet }); node.content?.forEach(visit); };
  notebookContentRoots(entry.document).forEach(visit);
  const selected = worksheets.find(sheet => sheet.id === worksheetId);
  const previous = selected?.sheet.cells[address] ?? '';
  const changed = () => { setPreview(false); setOperationId(''); setError(''); };
  const load = async () => { setBusy(true); setError(''); try { setReceipts((await api.get<{ amendments: AmendmentReceipt[] }>(`/api/entries/${entry.id}/amendments`)).amendments); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } };
  return <>
    <Button variant="ghost" onClick={() => { setOpen(true); changed(); setWorksheet(worksheets[0]?.id ?? ''); void load(); }}>{t('worksheetAmendments')}</Button>
    {open && <Dialog title={t('worksheetAmendments')} closeLabel={t('closeAmendments')} size="lg" onClose={() => setOpen(false)}>
      <p>{t('amendmentHint')}</p>
      {(dirty || readonly) && <Feedback kind="warning">{readonly ? t('amendmentReadonly') : t('amendmentDirty')}</Feedback>}
      {!worksheets.length && <Feedback kind="info">{t('amendmentNoWorksheet')}</Feedback>}
      {!!worksheets.length && <fieldset disabled={busy || dirty || readonly} className="notebook-amendment-fields"><legend>{t('amendRevision', { revision: entry.revision })}</legend>
        <Field label={t('amendmentWorksheet')}>{control => <NativeSelect {...control} value={worksheetId} onChange={event => { setWorksheet(event.target.value); changed(); }}>{worksheets.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.label}</option>)}</NativeSelect>}</Field>
        <Field label={t('amendmentCellAddress')}>{control => <Input {...control} value={address} onChange={event => { setAddress(event.target.value.toUpperCase()); changed(); }} />}</Field>
        <p>{t('amendmentCurrentRaw', { value: previous || t('amendmentBlank') })}</p>
        <Field label={t('amendmentNewRaw')}>{control => <Textarea {...control} maxLength={4096} value={value} onChange={event => { setValue(event.target.value); changed(); }} />}</Field>
        <Field label={t('amendmentAuthor')}>{control => <Input {...control} maxLength={200} value={author} onChange={event => { setAuthor(event.target.value); changed(); }} />}</Field>
        <Field label={t('amendmentReason')}>{control => <Textarea {...control} maxLength={4000} value={reason} onChange={event => { setReason(event.target.value); changed(); }} />}</Field>
        <Button disabled={!author.trim() || !reason.trim() || previous === value} onClick={() => { setPreview(true); setOperationId(crypto.randomUUID()); }}>{t('reviewAmendment')}</Button>
        {preview && <><p>Revision {entry.revision} → {entry.revision + 1}: {selected?.label}!{address}</p><pre>{JSON.stringify({ before: previous, after: value, author, reason }, null, 2)}</pre>
          <Button variant="primary" busy={busy} onClick={async () => { setBusy(true); setError(''); try {
            const result = await api.post<{ entry: NotebookEntry; amendment: AmendmentReceipt }>(`/api/entries/${entry.id}/amendments`, { operationId, expectedRevision: entry.revision, worksheetId, edits: { [address]: value }, author, reason });
            setReceipts(previous => [result.amendment, ...previous.filter(item => item.id !== result.amendment.id)]); setPreview(false); setReason(''); onCommitted(result.entry);
          } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }}>{t('createAuditedRevision')}</Button>
          <Button onClick={changed}>{t('cancelAmendment')}</Button></>}
      </fieldset>}
      {error && <Feedback kind="error">{error}</Feedback>}
      <h3>{t('amendmentHistory')}</h3><Button disabled={busy} onClick={() => void load()}>{t('refreshAmendmentHistory')}</Button>
      {!receipts.length && !busy && <p>{t('noAmendments')}</p>}
      {receipts.map(receipt => <Disclosure key={receipt.id} summary={`r${receipt.baseRevision} → r${receipt.revision} · ${receipt.author}`}><p>{receipt.reason}</p><time>{receipt.recordedAt}</time><pre>{JSON.stringify(receipt.changes, null, 2)}</pre></Disclosure>)}
    </Dialog>}
  </>;
}
