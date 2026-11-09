import { useState } from 'react';
import { useAppApi } from '@pero/app-sdk';
import { Button, Dialog, Disclosure, Feedback, Field, Input, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import type { NotebookEntry, NotebookNode } from '@pero/notebook';
import { notebookContentRoots } from '@pero/notebook/workspace';
import type { Spreadsheet } from '@pero/notebook/spreadsheet';

interface AmendmentReceipt { id: string; worksheetId: string; baseRevision: number; revision: number; author: string; reason: string; recordedAt: string; changes: { address: string; before: string; after: string }[] }
export function WorksheetAmendments({ entry, dirty, readonly = false, onCommitted }: { entry: NotebookEntry; dirty: boolean; readonly?: boolean; onCommitted(entry: NotebookEntry): void }) {
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
    <Button variant="ghost" onClick={() => { setOpen(true); changed(); setWorksheet(worksheets[0]?.id ?? ''); void load(); }}>Worksheet amendments / 工作表修订</Button>
    {open && <Dialog title="Worksheet amendments / 工作表修订" closeLabel="Close amendments / 关闭修订" size="lg" onClose={() => setOpen(false)}>
      <p>Every amendment creates a new saved entry revision with a reason and before/after cell audit. Historical sheets and receipts remain unchanged. Attribution is a local label, not an authenticated signature. / 每次更正创建新版本与前后值审计，不修改历史回执；本地署名不是认证签名。</p>
      {(dirty || readonly) && <Feedback kind="warning">{readonly ? 'Return to the latest entry to amend a worksheet. / 请返回最新版本。' : 'Save or discard the current draft before amending. / 请先保存或放弃草稿。'}</Feedback>}
      {!worksheets.length && <Feedback kind="info">This revision has no worksheet. / 当前版本没有工作表。</Feedback>}
      {!!worksheets.length && <fieldset disabled={busy || dirty || readonly} className="notebook-amendment-fields"><legend>Amend saved revision {entry.revision} / 更正已存版本 {entry.revision}</legend>
        <Field label="Worksheet / 工作表">{control => <NativeSelect {...control} value={worksheetId} onChange={event => { setWorksheet(event.target.value); changed(); }}>{worksheets.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.label}</option>)}</NativeSelect>}</Field>
        <Field label="Cell address / 单元格地址">{control => <Input {...control} value={address} onChange={event => { setAddress(event.target.value.toUpperCase()); changed(); }} />}</Field>
        <p>Current raw input / 当前原始输入: <code>{previous || '(blank / 空)'}</code></p>
        <Field label="New raw input / 新原始输入">{control => <Textarea {...control} maxLength={4096} value={value} onChange={event => { setValue(event.target.value); changed(); }} />}</Field>
        <Field label="Local author attribution / 本地署名">{control => <Input {...control} maxLength={200} value={author} onChange={event => { setAuthor(event.target.value); changed(); }} />}</Field>
        <Field label="Reason for amendment / 更正原因">{control => <Textarea {...control} maxLength={4000} value={reason} onChange={event => { setReason(event.target.value); changed(); }} />}</Field>
        <Button disabled={!author.trim() || !reason.trim() || previous === value} onClick={() => { setPreview(true); setOperationId(crypto.randomUUID()); }}>Review amendment / 复核更正</Button>
        {preview && <><p>Revision {entry.revision} → {entry.revision + 1}: {selected?.label}!{address}</p><pre>{JSON.stringify({ before: previous, after: value, author, reason }, null, 2)}</pre>
          <Button variant="primary" busy={busy} onClick={async () => { setBusy(true); setError(''); try {
            const result = await api.post<{ entry: NotebookEntry; amendment: AmendmentReceipt }>(`/api/entries/${entry.id}/amendments`, { operationId, expectedRevision: entry.revision, worksheetId, edits: { [address]: value }, author, reason });
            setReceipts(previous => [result.amendment, ...previous.filter(item => item.id !== result.amendment.id)]); setPreview(false); setReason(''); onCommitted(result.entry);
          } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }}>Create audited revision / 创建有审计的新版本</Button>
          <Button onClick={changed}>Cancel amendment / 取消更正</Button></>}
      </fieldset>}
      {error && <Feedback kind="error">{error}</Feedback>}
      <h3>Saved amendment history / 已存更正历史</h3><Button disabled={busy} onClick={() => void load()}>Refresh history / 刷新历史</Button>
      {!receipts.length && !busy && <p>No recorded amendments. / 暂无更正记录。</p>}
      {receipts.map(receipt => <Disclosure key={receipt.id} summary={`r${receipt.baseRevision} → r${receipt.revision} · ${receipt.author}`}><p>{receipt.reason}</p><time>{receipt.recordedAt}</time><pre>{JSON.stringify(receipt.changes, null, 2)}</pre></Disclosure>)}
    </Dialog>}
  </>;
}
