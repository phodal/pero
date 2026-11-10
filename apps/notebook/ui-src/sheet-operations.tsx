import { useEffect, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, Input, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import { columnHeading, type WorksheetGrid } from '@pero/notebook/grid-presentation';
import { cellAddress } from '@pero/notebook/spreadsheet';
import {
  asOperableGrid, hiddenRows, setCellNote, setRowFilter, sheetOperationLimits, sortGridColumn,
  type OperableGrid, type SortDirection, type SortFailure,
} from '@pero/notebook/sheet-operations';

const messages = {
  label: { en: 'Table operations', zh: '表格操作' },
  sortColumn: { en: 'Sort by column', zh: '排序列' },
  sortHint: { en: 'Reorders every row by stored values. Blanks stay last. A formula that would keep an old address is not changed.', zh: '按存储的值重排每一行。空白行留在最后。会保留旧地址的公式不会被改写。' },
  ascending: { en: 'Sort ascending', zh: '升序' },
  descending: { en: 'Sort descending', zh: '降序' },
  filterColumn: { en: 'Filter column', zh: '筛选列' },
  filterHint: { en: 'Hides rows whose cell does not contain this text. Formulas also match their calculated result. Nothing is deleted.', zh: '隐藏单元格不包含这段文字的行。公式还会匹配计算结果。不会删除任何内容。' },
  filterQuery: { en: 'Row contains', zh: '行包含' },
  clearFilter: { en: 'Show all rows', zh: '显示全部行' },
  allRows: { en: 'Every row is visible.', zh: '当前显示全部行。' },
  hiddenRows: { en: 'Hiding {count} of {total}: rows {rows}', zh: '已隐藏 {total} 行中的 {count} 行：第 {rows} 行' },
  address: { en: 'Cell', zh: '单元格' },
  note: { en: 'Note for {address}', zh: '{address} 的备注' },
  noteHint: { en: 'Short text on this cell. It is stored apart from the unit, evidence, and link.', zh: '写在这个单元格上的短文本，与单位、证据和链接分开保存。' },
  saveNote: { en: 'Save note', zh: '保存备注' },
  removeNote: { en: 'Remove note', zh: '移除备注' },
  invalidColumn: { en: 'Choose a column inside this table.', zh: '请选择表内的列。' },
  splitMerge: { en: 'This sort would break a merged block that spans rows. Unmerge those rows first.', zh: '这次排序会拆开跨行的合并区域。请先取消这些行的合并。' },
  formulaSortKey: { en: '{address} contains a formula, so this column cannot be sorted as values.', zh: '{address} 含有公式，不能按值排序这一列。' },
  formulaReference: { en: '{address} names a row that would move, and the formula would still point at the old address.', zh: '{address} 指向将要移动的行，公式仍会使用原来的地址。' },
  formulaOpaque: { en: '{address} uses a formula this table cannot prove is safe to sort.', zh: '{address} 的公式无法证明排序后仍然正确。' },
  invalidNote: { en: 'Enter one line on a cell inside this table.', zh: '请为表内单元格填写一行备注。' },
  noteLimit: { en: 'A note can be at most {count} characters.', zh: '备注最多 {count} 个字符。' },
  invalidFilter: { en: 'Use one line of filter text.', zh: '筛选文字只能写在一行内。' },
  filterLimit: { en: 'A filter can be at most {count} characters.', zh: '筛选文字最多 {count} 个字符。' },
} as const;

export interface SheetOperationsProps {
  /** Worksheet grid. Pass notes and rowFilter back on the next render so they survive. */
  grid: WorksheetGrid & Partial<Pick<OperableGrid, 'notes' | 'rowFilter'>>;
  /** Next grid after a sort, a filter edit, or a note edit. */
  onChange: (grid: OperableGrid) => void;
  /** Selected cell for the note. When omitted, the panel asks for an address. */
  address?: string;
  /** Local formulas qualified with this sheet are checked against rows that move. */
  sheetName?: string;
  readonly?: boolean;
}

function sortFailure(t: (key: string, vars?: Record<string, string | number>) => string, failure: SortFailure): string {
  if (failure.status === 'invalid') return t('invalidColumn');
  if (failure.status === 'split-merge') return t('splitMerge');
  if (failure.reason === 'sort-key') return t('formulaSortKey', { address: failure.address });
  if (failure.reason === 'opaque') return t('formulaOpaque', { address: failure.address });
  return t('formulaReference', { address: failure.address });
}

export function SheetOperations({ grid, onChange, address, sheetName, readonly = false }: SheetOperationsProps) {
  const { t } = useAppI18n(messages);
  const operable = asOperableGrid(grid);
  const [sortColumn, setSortColumn] = useState(0);
  const [filterColumn, setFilterColumn] = useState(operable.rowFilter?.column ?? 0);
  const [query, setQuery] = useState(operable.rowFilter?.query ?? '');
  const [localAddress, setLocalAddress] = useState(address ?? 'A1');
  const selected = (address ?? localAddress).trim().toUpperCase();
  const storedNote = operable.notes[selected] ?? '';
  const [draft, setDraft] = useState(storedNote);
  const [sortError, setSortError] = useState<SortFailure | null>(null);
  const [filterError, setFilterError] = useState<'invalid' | 'limit' | null>(null);
  const [noteError, setNoteError] = useState<'invalid' | 'limit' | null>(null);
  const persistedQuery = operable.rowFilter?.query ?? '';
  const persistedColumn = operable.rowFilter?.column;
  useEffect(() => { setDraft(storedNote); }, [selected, storedNote]);
  useEffect(() => {
    setQuery(persistedQuery);
    if (persistedColumn !== undefined) setFilterColumn(persistedColumn);
  }, [persistedColumn, persistedQuery]);

  const column = sortColumn >= 0 && sortColumn < grid.sheet.columns ? sortColumn : 0;
  const activeFilterColumn = filterColumn >= 0 && filterColumn < grid.sheet.columns ? filterColumn : 0;
  const hidden = hiddenRows(operable);
  const hiddenLabels = hidden.map(row => String(row + 1));
  const hiddenText = hiddenLabels.length > 12 ? `${hiddenLabels.slice(0, 12).join(', ')}…` : hiddenLabels.join(', ');
  const options = Array.from({ length: grid.sheet.columns }, (_, index) => {
    const letter = cellAddress(index, 0).replace(/[0-9]+$/, '');
    const heading = columnHeading(index, grid.columnNames);
    return { value: String(index), label: heading === letter ? letter : `${letter} · ${heading}` };
  });
  const applyFilter = (nextColumn: number, nextQuery: string) => {
    setFilterColumn(nextColumn);
    setQuery(nextQuery);
    const result = setRowFilter(operable, nextColumn, nextQuery);
    if (result.status === 'ok') {
      setFilterError(null);
      if (result.grid !== operable) onChange(result.grid);
      return;
    }
    setFilterError(result.status);
  };
  const sort = (direction: SortDirection) => {
    const result = sortGridColumn(operable, column, direction, { sheetName });
    if (result.status === 'ok') {
      setSortError(null);
      if (result.grid !== operable) onChange(result.grid);
      return;
    }
    setSortError(result);
  };
  const saveNote = (text: string) => {
    const result = setCellNote(operable, selected, text);
    if (result.status === 'ok') {
      setNoteError(null);
      if (result.grid !== operable) onChange(result.grid);
      return;
    }
    setNoteError(result.status);
  };

  return <details className="notebook-sheet-operations" data-sheet-operations="">
    <summary>{t('label')}</summary>
    <section className="notebook-science-panel" aria-label={t('label')}>
    <div className="notebook-science-fields">
      <Field label={t('sortColumn')} description={t('sortHint')}>{control => <NativeSelect {...control} value={String(column)} disabled={readonly} onChange={event => setSortColumn(Number(event.target.value))}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect>}</Field>
    </div>
    <div className="notebook-science-actions">
      <Button disabled={readonly} onClick={() => sort('asc')}>{t('ascending')}</Button>
      <Button disabled={readonly} onClick={() => sort('desc')}>{t('descending')}</Button>
    </div>
    {sortError && <Feedback kind="error">{sortFailure(t, sortError)}</Feedback>}
    <div className="notebook-science-fields">
      <Field label={t('filterColumn')} description={t('filterHint')}>{control => <NativeSelect {...control} value={String(activeFilterColumn)} disabled={readonly} onChange={event => applyFilter(Number(event.target.value), query)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect>}</Field>
      <Field label={t('filterQuery')} error={filterError === 'limit' ? t('filterLimit', { count: sheetOperationLimits.query }) : filterError === 'invalid' ? t('invalidFilter') : undefined}>{control => <Input {...control} value={query} readOnly={readonly} maxLength={sheetOperationLimits.query} onChange={event => applyFilter(activeFilterColumn, event.target.value)} />}</Field>
    </div>
    <div className="notebook-science-actions">
      <Button disabled={readonly || !operable.rowFilter} onClick={() => applyFilter(activeFilterColumn, '')}>{t('clearFilter')}</Button>
    </div>
    {hidden.length
      ? <Feedback kind="info">{t('hiddenRows', { count: hidden.length, total: grid.sheet.rows, rows: hiddenText })}</Feedback>
      : <p className="notebook-note">{t('allRows')}</p>}
    <div className="notebook-science-fields">
      {address === undefined && <Field label={t('address')}>{control => <Input {...control} value={localAddress} readOnly={readonly} maxLength={8} onChange={event => setLocalAddress(event.target.value.toUpperCase())} />}</Field>}
      <Field label={t('note', { address: selected || '…' })} description={t('noteHint')} error={noteError === 'limit' ? t('noteLimit', { count: sheetOperationLimits.note }) : noteError === 'invalid' ? t('invalidNote') : undefined}>{control => <Textarea {...control} value={draft} readOnly={readonly} maxLength={sheetOperationLimits.note} rows={2} onChange={event => setDraft(event.target.value)} />}</Field>
    </div>
    <div className="notebook-science-actions">
      <Button disabled={readonly || draft.trim() === storedNote} onClick={() => saveNote(draft)}>{t('saveNote')}</Button>
      <Button disabled={readonly || !storedNote} onClick={() => saveNote('')}>{t('removeNote')}</Button>
    </div>
    </section>
  </details>;
}
