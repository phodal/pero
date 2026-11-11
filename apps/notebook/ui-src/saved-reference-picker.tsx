import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Select } from '@pero/app-sdk/ui';
import { scientificReferenceState, type NotebookEntry, type NotebookEntrySummary, type NotebookNode, type ReferenceSnapshot, type ScientificReference } from '@pero/notebook';
import { notebookContentRoots } from '@pero/notebook/workspace';
import type { ImportedReference } from './reference-import';

const messages = {
  notebook: { en: 'Saved notebook', zh: '已保存的笔记' },
  choose: { en: 'Choose a notebook', zh: '选择笔记' },
  source: { en: 'Saved snapshot', zh: '已保存的快照' },
  select: { en: 'Choose a snapshot', zh: '选择快照' },
  scope: { en: 'Reuse a fixed snapshot from a saved notebook revision.', zh: '复用笔记已保存修订中的固定快照。' },
  empty: { en: 'No matching snapshots in this revision. Choose another notebook or import a report below.', zh: '此修订中没有对应快照。请选择其他笔记，或在下方导入报告。' },
  none: { en: 'No saved notebooks. Import a report below to attach evidence.', zh: '暂无已保存的笔记，可在下方导入报告并附加证据。' },
  loading: { en: 'Loading saved snapshots…', zh: '正在加载已保存的快照…' },
  attach: { en: 'Attach snapshot', zh: '附加快照' },
  replace: { en: 'Replace snapshot', zh: '替换快照' },
  retry: { en: 'Retry', zh: '重试' },
} as const;

export function SavedReferencePicker({ kind, replacing, onAttach }: {
  kind: 'evidence' | 'experiment'; replacing: boolean; onAttach(value: ImportedReference): void;
}) {
  const { t } = useAppI18n(messages), api = useAppApi();
  const [entries, setEntries] = useState<NotebookEntrySummary[]>([]), [entryId, setEntryId] = useState('');
  const [options, setOptions] = useState<ImportedReference[]>([]), [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const request = useRef(0);
  useEffect(() => {
    let live = true;
    setBusy(true); setError('');
    void api.get<{ entries: NotebookEntrySummary[] }>('/api/entries').then(result => {
      if (live) setEntries(result.entries);
    }).catch(cause => { if (live) setError(String(cause)); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; request.current++; };
  }, [api, retry]);
  const load = async (id: string) => {
    const generation = ++request.current;
    setEntryId(id); setOptions([]); setSelection(''); setError('');
    const summary = entries.find(entry => entry.id === id);
    if (!summary) return;
    setBusy(true);
    try {
      const entry = await api.get<NotebookEntry>(`/api/entries/${encodeURIComponent(id)}/revisions/${summary.revision}`);
      const saved: ImportedReference[] = [];
      const visit = (node: NotebookNode) => {
        if (node.type === kind) {
          const snapshot = node.attrs?.snapshot as ReferenceSnapshot | null;
          const reference = node.attrs?.source as ScientificReference | null;
          if (snapshot?.kind === (kind === 'evidence' ? 'paper-report' : 'control-receipt') && scientificReferenceState(reference) === 'pinned') {
            saved.push({ label: String(node.attrs?.label || summary.title), reference: reference!, snapshot });
          }
        }
        node.content?.forEach(visit);
      };
      notebookContentRoots(entry.document).forEach(visit);
      if (request.current === generation) { setOptions(saved); setSelection(saved.length === 1 ? '0' : ''); }
    } catch (cause) { if (request.current === generation) setError(String(cause)); }
    finally { if (request.current === generation) setBusy(false); }
  };
  const selected = selection === '' ? undefined : options[Number(selection)];
  return <div className="notebook-reference-picker">
    <p className="notebook-note">{t('scope')}</p>
    {!!entries.length && <Select label={t('notebook')} placeholder={t('choose')} value={entryId} onChange={id => void load(id)}
      options={entries.map(entry => ({ value: entry.id, label: entry.title, hint: `r${entry.revision}` }))} showHint />}
    {busy && <p role="status">{t('loading')}</p>}
    {error && <Feedback kind="error">{error} <Button variant="ghost" onClick={() => entryId ? void load(entryId) : setRetry(value => value + 1)}>{t('retry')}</Button></Feedback>}
    {!busy && !error && (!entries.length || (entryId && !options.length)) && <p className="notebook-note">{t(entries.length ? 'empty' : 'none')}</p>}
    {!!options.length && <Select label={t('source')} placeholder={t('select')} value={selection} onChange={setSelection} showHint
      options={options.map((item, index) => ({ value: String(index), label: item.label,
        hint: item.snapshot.kind === 'paper-report' ? item.snapshot.quote.slice(0, 160) : item.snapshot.verdict }))} />}
    {selected && <div className="notebook-reference-preview"><strong>{selected.label}</strong><p>
      {selected.snapshot.kind === 'paper-report' ? selected.snapshot.quote : selected.snapshot.verdict}
    </p><Button variant="primary" onClick={() => onAttach(selected)}>{t(replacing ? 'replace' : 'attach')}</Button></div>}
  </div>;
}
