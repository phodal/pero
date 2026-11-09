import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { closeHistory } from '@tiptap/pm/history';
import { useEditorState, type NodeViewProps } from '@tiptap/react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Disclosure, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Feedback, Input, Table } from '@pero/app-sdk/ui';
import { spreadsheetLimits } from '@pero/notebook';
import { cellAddress, evaluateSpreadsheet, formulaFunctions, isExternalFormula, type Spreadsheet } from '@pero/notebook/spreadsheet';
import {
  cellRangeLabel, clearCellRange, encodeCellRange, fillCellRange, normalizeCellRange, parseCellClipboard,
  pasteCellGrid, rangeContains, type CellPosition,
} from '@pero/notebook/spreadsheet-range';
import { writeWorkbook } from '@pero/notebook/workbook';
import { BlockFrame } from './block-frame';
import { CellAnnotations } from './cell-annotations';
import { messages } from './messages';
import { renameWorksheet, worksheetBlocks, worksheetCalculation } from './worksheet-model';

type CellSelection = { anchor: CellPosition; focus: CellPosition };
const origin: CellPosition = { column: 0, row: 0 };
const arrows: Partial<Record<string, CellPosition>> = {
  ArrowUp: { column: 0, row: -1 }, ArrowDown: { column: 0, row: 1 },
  ArrowLeft: { column: -1, row: 0 }, ArrowRight: { column: 1, row: 0 },
};
const gridMessages = {
  ...messages,
  copyRange: { en: 'Copy range', zh: '复制区域' },
  copyFailed: { en: 'Clipboard access failed. Use the keyboard copy shortcut in the grid.', zh: '无法访问剪贴板，请在表格中使用键盘复制快捷键。' },
  fillDown: { en: 'Fill down', zh: '向下填充' },
  fillRight: { en: 'Fill right', zh: '向右填充' },
  fillLimit: { en: 'A filled formula exceeds the cell length limit.', zh: '填充后的公式超出单元格长度限制。' },
  clearCells: { en: 'Clear cells', zh: '清空单元格' },
  selectedRange: { en: 'Selected range {address}', zh: '已选区域 {address}' },
  rangeHint: {
    en: 'Shift-click or use Shift with the arrow keys to select a range.',
    zh: '按住 Shift 单击或使用 Shift 加方向键来选择区域。',
  },
} as const;
const isFormulaError = (value: unknown) => typeof value === 'string' &&
  /^#(?:REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|NULL!|CIRC!|ERROR!|SPILL!)$/.test(value);

export function SpreadsheetView(view: NodeViewProps) {
  const { t } = useAppI18n(gridMessages);
  const { blockId, sheet, label } = view.node.attrs as { blockId: string; sheet: Spreadsheet; label: string };
  const [selection, setSelection] = useState<CellSelection>({ anchor: origin, focus: origin });
  const [focused, setFocused] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [worksheetName, setWorksheetName] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const keepRangeFocus = useRef(false);
  const separateNextEdit = useRef(false);
  const formulaInput = useRef<HTMLInputElement>(null);
  const calculation = useEditorState({ editor: view.editor, selector: ({ editor }) => worksheetCalculation(editor.state.doc, blockId) });
  const values = useMemo(() => calculation?.values ?? evaluateSpreadsheet(sheet), [calculation, sheet]);
  const hasMultipleSheets = useEditorState({ editor: view.editor, selector: ({ editor }) => worksheetBlocks(editor.state.doc).length > 1 });
  const editable = view.editor.isEditable;
  const clamp = ({ column, row }: CellPosition): CellPosition => ({
    column: Math.max(0, Math.min(column, sheet.columns - 1)),
    row: Math.max(0, Math.min(row, sheet.rows - 1)),
  });
  const active = clamp(selection.anchor);
  const endpoint = clamp(selection.focus);
  const range = normalizeCellRange(active, endpoint);
  const rangeAddress = cellRangeLabel(range);
  const isRange = range.start.column !== range.end.column || range.start.row !== range.end.row;
  const address = cellAddress(active.column, active.row);
  const source = sheet.cells[address] ?? '';
  const setSheet = (edit: (current: Spreadsheet) => Spreadsheet | null, batch = false) => view.editor.commands.command(({ tr }) => {
    const position = view.getPos();
    const node = typeof position === 'number' ? tr.doc.nodeAt(position) : null;
    if (typeof position !== 'number' || node?.type.name !== 'spreadsheet') return false;
    const current = node.attrs.sheet as Spreadsheet;
    const next = edit(current);
    if (!next) return false;
    if (next !== current) {
      if (batch || separateNextEdit.current) closeHistory(tr);
      separateNextEdit.current = batch;
      tr.setNodeMarkup(position, undefined, { ...node.attrs, sheet: next });
    }
    return true;
  });
  const updateCell = (cell: string, value: string) => {
    if (isExternalFormula(value)) {
      setError(t('externalFormula'));
      return;
    }
    setSheet(current => {
      const cells = { ...current.cells };
      if (value) cells[cell] = value;
      else delete cells[cell];
      return { ...current, cells };
    });
    setError(previous => previous === t('externalFormula') ? '' : previous);
  };
  const selectCell = (position: CellPosition) => setSelection({ anchor: position, focus: position });
  const focusCell = (position: CellPosition) => {
    keepRangeFocus.current = true;
    grid.current?.querySelector<HTMLInputElement>(`[data-cell="${cellAddress(position.column, position.row)}"]`)?.focus();
    keepRangeFocus.current = false;
  };
  const copy = (event: ClipboardEvent<HTMLInputElement>) => {
    if (!isRange) return;
    event.preventDefault();
    event.stopPropagation();
    event.clipboardData.setData('text/plain', encodeCellRange(sheet, range));
    setError('');
  };
  const copyRange = async () => {
    try {
      await navigator.clipboard.writeText(encodeCellRange(sheet, range));
      setError('');
    } catch {
      setError(t('copyFailed'));
    }
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>, position: CellPosition) => {
    if (!editable) return;
    const text = event.clipboardData.getData('text/plain');
    const isTable = /[\t\r\n]/.test(text);
    if (!isTable && !isRange) return;
    if (!text && !Array.from(event.clipboardData.types).includes('text/plain')) return;
    event.preventDefault();
    event.stopPropagation();
    const data = isTable ? parseCellClipboard(text) : [[text]];
    if (!data) { setError(t('gridPasteInvalid')); return; }
    if (data.some(row => row.some(isExternalFormula))) {
      setError(t('externalFormula'));
      return;
    }
    const target = isRange ? range.start : position;
    if (!setSheet(current => pasteCellGrid(current, target, data), true)) {
      setError(t('gridPasteLimit'));
      return;
    }
    setError('');
    setSelection({ anchor: target, focus: {
      column: target.column + Math.max(...data.map(line => line.length)) - 1,
      row: target.row + data.length - 1,
    } });
    focusCell(target);
  };
  const clear = () => {
    setSheet(current => clearCellRange(current, range), true);
    setError('');
  };
  const fill = (direction: 'down' | 'right', selection = range) => {
    const sources: string[] = [];
    if (direction === 'down') {
      for (let column = selection.start.column; column <= selection.end.column; column += 1)
        sources.push(sheet.cells[cellAddress(column, selection.start.row)] ?? '');
    } else {
      for (let row = selection.start.row; row <= selection.end.row; row += 1)
        sources.push(sheet.cells[cellAddress(selection.start.column, row)] ?? '');
    }
    if (sources.some(isExternalFormula)) {
      setError(t('externalFormula'));
      return;
    }
    const filled = setSheet(current => fillCellRange(current, selection, direction), true);
    setError(filled ? '' : t('fillLimit'));
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>, position: CellPosition) => {
    if (event.nativeEvent.isComposing) return;
    const step = arrows[event.key];
    if (event.shiftKey && step && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const focus = clamp({ column: endpoint.column + step.column, row: endpoint.row + step.row });
      setSelection({ anchor: active, focus });
      focusCell(focus);
      return;
    }
    if (isRange && editable && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      clear();
      return;
    }
    if (isRange && (event.key === 'Escape' || step)) {
      event.preventDefault();
      const next = step ? clamp({ column: position.column + step.column, row: position.row + step.row }) : active;
      selectCell(next);
      focusCell(next);
      return;
    }
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = step?.row ?? (event.shiftKey ? -1 : 1);
      const next = clamp({ column: position.column, row: position.row + offset });
      selectCell(next);
      focusCell(next);
    }
  };
  const exportExcel = async () => {
    setExporting(true);
    setError('');
    const sheets = worksheetBlocks(view.editor.state.doc);
    try {
      // A formula can cite another block's worksheet. Export the named workbook
      // together, rather than producing a single-sheet file with broken links.
      const workbook = await writeWorkbook(sheets);
      const name = sheets.length > 1 ? 'Notebook' : sheets[0].name;
      downloadFile(`${name.replace(/[<>|"\u0000-\u001f]/g, '_')}.xlsx`, workbook, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setExporting(false); }
  };
  const applyWorksheetName = () => {
    if (worksheetName === null) return;
    const result = renameWorksheet(view.editor, blockId, worksheetName);
    setError(result === 'invalid' ? t('invalidSheetName') : result === 'duplicate' ? t('workbookNameConflict') : '');
    setWorksheetName(null);
  };
  return <BlockFrame view={view} kind="spreadsheet"
    title={editable ? <Input unstyled className="notebook-block-name" aria-label={t('sheetName')} value={worksheetName ?? calculation?.name ?? label}
        onChange={event => setWorksheetName(event.target.value)} onBlur={applyWorksheetName} maxLength={31}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === 'Escape') { event.preventDefault(); setWorksheetName(null); }
        }} /> : <strong>{calculation?.name || label || t('spreadsheet')}</strong>}
    menuActions={<DropdownMenuItem disabled={exporting} onSelect={() => void exportExcel()}>{t(hasMultipleSheets ? 'exportWorkbook' : 'exportExcel')}</DropdownMenuItem>}>
    {editable && <Disclosure variant="inline" className="notebook-sheet-tools" summary={t('worksheetTools')}>
      <div className="notebook-sheet-controls">
      <Button variant="ghost" onClick={() => setSheet(current => ({ ...current, rows: Math.min(current.rows + 1, spreadsheetLimits.rows) }))} disabled={sheet.rows >= spreadsheetLimits.rows}>{t('addRow')}</Button>
      <Button variant="ghost" onClick={() => setSheet(current => ({ ...current, columns: Math.min(current.columns + 1, spreadsheetLimits.columns) }))} disabled={sheet.columns >= spreadsheetLimits.columns}>{t('addColumn')}</Button>
      <Button variant="ghost" disabled={isRange || active.row === sheet.rows - 1 || !source} onClick={() =>
        fill('down', normalizeCellRange(active, { column: active.column, row: active.row + 1 }))}>{t('fillNext')}</Button>
      </div>
      <p className="notebook-note">{t('gridHint')} {t('rangeHint')}</p>
    </Disclosure>}
    <div className="notebook-formula">
      <output aria-label={t(isRange ? 'selectedRange' : 'cell', { address: rangeAddress })}>{rangeAddress}</output>
      <Input ref={formulaInput} aria-label={t('rawCell')} placeholder={t('rawCell')} value={source} readOnly={!editable}
        maxLength={spreadsheetLimits.cellLength} onChange={event => updateCell(address, event.target.value)}
        onPaste={event => paste(event, active)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); focusCell(active); }
        }} />
      {editable && <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost">{t('functions')}</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {formulaFunctions.map(name => <DropdownMenuItem key={name} onSelect={() => {
            updateCell(address, `=${name}()`);
            requestAnimationFrame(() => {
              formulaInput.current?.focus();
              formulaInput.current?.setSelectionRange(name.length + 2, name.length + 2);
            });
          }}>{name}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
    {isRange && <div className="notebook-sheet-controls">
      <Button variant="ghost" onClick={() => void copyRange()}>{t('copyRange')}</Button>
      {editable && <>
        <Button variant="ghost" disabled={range.start.row === range.end.row} onClick={() => fill('down')}>{t('fillDown')}</Button>
        <Button variant="ghost" disabled={range.start.column === range.end.column} onClick={() => fill('right')}>{t('fillRight')}</Button>
        <Button variant="ghost" onClick={clear}>{t('clearCells')}</Button>
      </>}
    </div>}
    <div ref={grid}>
      <Table label={t('spreadsheet')} density="compact" className="notebook-grid-scroll" tableClassName="notebook-grid">
        <thead><tr><th scope="col" aria-label="#" />
          {Array.from({ length: sheet.columns }, (_, column) => <th scope="col" key={column}>{cellAddress(column, 0).slice(0, -1)}</th>)}
        </tr></thead>
        <tbody>{Array.from({ length: sheet.rows }, (_, row) => <tr key={row}>
          <th scope="row">{row + 1}</th>
          {Array.from({ length: sheet.columns }, (_, column) => {
            const key = cellAddress(column, row);
            const raw = sheet.cells[key] ?? '';
            const computed = values[key];
            const text = computed === undefined ? '' : typeof computed === 'boolean' ? (computed ? 'TRUE' : 'FALSE') : String(computed);
            const position = { column, row };
            return <td key={key} data-active={key === address || undefined}
              data-range-selected={isRange && rangeContains(range, position) || undefined} data-error={isFormulaError(computed) || undefined}>
              <Input unstyled className="notebook-cell" aria-label={t('cell', { address: key })} data-cell={key}
                value={editable && focused === key ? raw : text} readOnly={!editable} maxLength={spreadsheetLimits.cellLength}
                onMouseDown={event => {
                  if (event.button !== 0) return;
                  if (event.shiftKey) {
                    event.preventDefault();
                    setSelection({ anchor: active, focus: position });
                    focusCell(position);
                  } else selectCell(position);
                }}
                onFocus={() => { if (!keepRangeFocus.current) selectCell(position); setFocused(key); }} onBlur={() => setFocused(null)}
                onChange={event => { if (isRange) selectCell(position); updateCell(key, event.target.value); }}
                onKeyDown={event => onKey(event, position)} onCopy={copy} onPaste={event => paste(event, position)} />
            </td>;
          })}
        </tr>)}</tbody>
      </Table>
    </div>
    <CellAnnotations view={view} address={address} editable={editable} />
    {calculation?.ambiguous && <Feedback kind="error">{t('workbookNameConflict')}</Feedback>}
    {error && <Feedback kind="error">{error}</Feedback>}
  </BlockFrame>;
}
