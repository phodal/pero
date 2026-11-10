import { NOTEBOOK_FORMULA_INSPECTOR_EVENT } from './notebook-reference-controls';
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from 'react';
import { closeHistory } from '@tiptap/pm/history';
import { useEditorState, type NodeViewProps } from '@tiptap/react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Feedback, Icon, IconButton, Input, Select, Table } from '@pero/app-sdk/ui';
import { spreadsheetLimits } from '@pero/notebook';
import { cellAddress, evaluateSpreadsheet, formulaFunctions, type Spreadsheet } from '@pero/notebook/spreadsheet';
import {
  cellRangeLabel, clearCellRange, encodeCellRange, fillCellRange, normalizeCellRange, parseCellClipboard,
  admitCellEdit, pasteCellGrid, rangeContains, type CellPosition, type RangeEditError,
} from '@pero/notebook/spreadsheet-range';
import {
  clipboardTarget, emptyGridPresentation, exportWorksheetCsv, formatCellRange, formatCellValue, gridDimensionLimits,
  gridWriteConflicts, mergeCellRange, mergedCell, resizeGridAxis, unmergeCellRange,
  type CellColor, type CellFormat, type WorksheetGrid,
} from '@pero/notebook/grid-presentation';
import { changeWorksheetStructure, mapWorksheetPosition, type AxisChange, type StructuredWorksheet } from '@pero/notebook/worksheet-structure';
import { formulaHelp, inspectWorksheetCell } from '@pero/notebook/formula-inspection';
import { asOperableGrid, hiddenRows } from '@pero/notebook/sheet-operations';
import { writeWorkbook } from '@pero/notebook/workbook';
import { BlockFrame } from './block-frame';
import { SheetOperations } from './sheet-operations';
import { CellLinkControl } from './cell-link-control';
import { RenameColumnDialog } from './column-heading';
import { useGridAxisControls } from './grid-axis-controls';
import { FormulaInput } from './formula-input';
import { FormulaSourceTree } from './formula-source-tree';
import './grid-interactions.css';

const rowIndexWidth = 40;
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
  format: { en: 'Cell formatting', zh: '单元格格式' },
  bold: { en: 'Bold', zh: '加粗' }, italic: { en: 'Italic', zh: '斜体' }, underline: { en: 'Underline', zh: '下划线' },
  strike: { en: 'Strikethrough', zh: '删除线' },
  renameColumn: { en: 'Rename column', zh: '重命名列' },
  openLink: { en: 'Open link', zh: '打开链接' },
  invalidColumnName: { en: 'Enter a column name up to 80 characters.', zh: '请输入不超过 80 个字符的列名。' },
  invalidCellLink: { en: 'Enter an http or https address, or leave it empty to remove the link.', zh: '请输入 http 或 https 地址，留空则移除链接。' },
  foreground: { en: 'Text color', zh: '文字颜色' }, background: { en: 'Cell background', zh: '单元格背景' },
  default: { en: 'Default', zh: '默认' }, blue: { en: 'Blue', zh: '蓝色' }, green: { en: 'Green', zh: '绿色' }, rose: { en: 'Rose', zh: '玫红' },
  alignment: { en: 'Alignment', zh: '对齐' }, left: { en: 'Left', zh: '左对齐' }, center: { en: 'Center', zh: '居中' }, right: { en: 'Right', zh: '右对齐' },
  precision: { en: 'Decimal places', zh: '小数位数' }, auto: { en: 'Automatic', zh: '自动' },
  clearFormat: { en: 'Clear formatting', zh: '清除格式' },
  structure: { en: 'Rows and columns', zh: '行与列' },
  tableSettings: { en: 'Table settings', zh: '表格设置' },
  insertRow: { en: 'Insert row before', zh: '在前面插入行' }, insertColumn: { en: 'Insert column before', zh: '在前面插入列' },
  deleteRow: { en: 'Delete row', zh: '删除行' }, deleteColumn: { en: 'Delete column', zh: '删除列' },
  rowUp: { en: 'Move row up', zh: '上移行' }, rowDown: { en: 'Move row down', zh: '下移行' },
  columnLeft: { en: 'Move column left', zh: '左移列' }, columnRight: { en: 'Move column right', zh: '右移列' },
  resizeRow: { en: 'Resize row', zh: '调整行高' }, resizeColumn: { en: 'Resize column', zh: '调整列宽' },
  pixels: { en: 'Size in pixels', zh: '像素尺寸' },
  merge: { en: 'Merge selected cells', zh: '合并选中单元格' }, unmerge: { en: 'Unmerge cells', zh: '取消合并' },
  mergePolicy: { en: 'Only the upper-left cell is shown. All covered values, formulas, formatting and evidence are retained, continue calculating, and reappear when you unmerge. Merge this range?', zh: '仅显示左上角单元格。被覆盖的值、公式、格式和证据均保留并继续计算，取消合并后重新显示。是否合并？' },
  deletePolicy: { en: 'This removes the selected row or column, including its values, formatting and evidence. References are updated; references to deleted cells become #REF!. You can undo this change.', zh: '这将删除所选行或列及其值、格式和证据，同时更新引用；指向已删除单元格的引用变为 #REF!。可以撤销此操作。' },
  mergeConflict: { en: 'Unmerge the affected cells before pasting, filling or merging this range.', zh: '请先取消受影响单元格的合并，再粘贴、填充或合并此区域。' },
  structuralError: { en: 'The change was not applied. A formula or merged range cannot be rewritten safely: {detail}', zh: '未应用此修改。有公式或合并区域无法安全更新：{detail}' },
  cutRange: { en: 'Cut range', zh: '剪切区域' },
  cutChanged: { en: 'The cells changed while copying. Their current contents were kept.', zh: '复制期间单元格发生变化，当前内容已保留。' },
  exportCsv: { en: 'Export evaluated CSV', zh: '导出计算结果 CSV' },
  functionHelp: { en: 'Function search and help', zh: '函数搜索与帮助' },
  searchFunctions: { en: 'Search functions', zh: '搜索函数' }, insertFunction: { en: 'Insert function', zh: '插入函数' },
  inspector: { en: 'Formula inspector', zh: '公式检查器' },
  rawSource: { en: 'Source input', zh: '原始输入' }, evaluated: { en: 'Calculated value', zh: '计算值' }, valueType: { en: 'Value type', zh: '值类型' },
  dependencies: { en: 'Dependencies read by the evaluator', zh: '计算引擎读取的依赖' },
  noDependencies: { en: 'No cell references were read for this result.', zh: '此结果未读取单元格引用。' },
  dependencyHint: { en: 'These are references observed during calculation, not a reconstructed syntax tree. Conditional or dynamic formulas may read only some references.', zh: '这里展示计算时实际读取的引用，并非重建的语法树。条件或动态公式可能只读取部分引用。' },
  selectedError: { en: '{address} evaluates to {value}. Check the source input and referenced cells.', zh: '{address} 的计算结果为 {value}，请检查原始输入及引用单元格。' },
  confirm: { en: 'Confirm', zh: '确认' }, cancel: { en: 'Cancel', zh: '取消' }, close: { en: 'Close', zh: '关闭' },
  copyRange: { en: 'Copy range', zh: '复制区域' },
  rowCount: { en: '{rows} rows', zh: '{rows} 行' },
  addRows: { en: 'Add rows', zh: '添加多行' },
  rowsToAdd: { en: 'Rows to add', zh: '添加行数' },
  worksheetTools: { en: 'Worksheet tools', zh: '工作表工具' },
  cellDetails: { en: 'Cell details', zh: '单元格详情' },
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
  const [dialog, setDialog] = useState<'merge' | 'deleteRow' | 'deleteColumn' | 'resizeRow' | 'resizeColumn' | 'functions' | null>(null);
  const [size, setSize] = useState('');
  const [columnRename, setColumnRename] = useState<string | null>(null);
  const [functionName, setFunctionName] = useState('SUM');
  const [inspector, setInspector] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rowBatch, setRowBatch] = useState('1');
  useEffect(() => {
    const toggle = (event: Event) => { if ((event as CustomEvent).detail === view.node.attrs.blockId) setInspector(value => !value); };
    const element = view.editor.view.dom; element.addEventListener(NOTEBOOK_FORMULA_INSPECTOR_EVENT, toggle);
    return () => element.removeEventListener(NOTEBOOK_FORMULA_INSPECTOR_EVENT, toggle);
  }, [view.editor, view.node.attrs.blockId]);
  const [worksheetName, setWorksheetName] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const keepRangeFocus = useRef(false);
  const separateNextEdit = useRef(false);
  const formulaInput = useRef<HTMLInputElement>(null);
  const editSession = useRef<{ cell: string; baseline: string; admitted: string; lock: string | null } | null>(null);
  const draftRef = useRef<{ cell: string; text: string } | null>(null);
  const [editEpoch, setEditEpoch] = useState(0);
  const calculation = useEditorState({ editor: view.editor, selector: ({ editor }) => worksheetCalculation(editor.state.doc, blockId) });
  const values = useMemo(() => calculation?.values ?? evaluateSpreadsheet(sheet), [calculation, sheet]);
  const hasMultipleSheets = useEditorState({ editor: view.editor, selector: ({ editor }) => worksheetBlocks(editor.state.doc).length > 1 });
  const editable = view.editor.isEditable;
  const clamp = ({ column, row }: CellPosition): CellPosition => ({
    column: Math.max(0, Math.min(column, sheet.columns - 1)),
    row: Math.max(0, Math.min(row, sheet.rows - 1)),
  });
  const presentation = asOperableGrid({ ...emptyGridPresentation(), ...view.node.attrs, sheet, annotations: view.node.attrs.annotations ?? {} } as WorksheetGrid);
  const skippedRows = new Set(hiddenRows(presentation));
  const shownRowSpan = (start: number, end: number) => {
    let count = 0;
    for (let index = start; index <= end; index += 1) if (!skippedRows.has(index)) count += 1;
    return count;
  };
  const selectedMerge = mergedCell(presentation.merges, clamp(selection.anchor));
  const active = selectedMerge?.start ?? clamp(selection.anchor);
  const endpoint = clamp(selection.focus);
  const range = normalizeCellRange(active, endpoint);
  const rangeAddress = cellRangeLabel(range);
  const isRange = range.start.column !== range.end.column || range.start.row !== range.end.row;
  const address = cellAddress(active.column, active.row);
  const storedSource = sheet.cells[address] ?? '';
  const source = draftRef.current?.cell === address ? draftRef.current.text : storedSource;
  void editEpoch;
  const beginEdit = (position: CellPosition) => {
    const cell = cellAddress(position.column, position.row);
    if (editSession.current?.cell === cell) return;
    const value = sheet.cells[cell] ?? '';
    editSession.current = { cell, baseline: value, admitted: value, lock: null };
  };
  const finishEdit = (cell: string) => {
    if (editSession.current?.cell === cell) editSession.current = null;
    if (draftRef.current?.cell === cell) draftRef.current = null;
    setEditEpoch(value => value + 1);
  };
  const editCell = (position: CellPosition, value: string, batch = false) => {
    if (!view.editor.isEditable) return value;
    const cell = cellAddress(position.column, position.row);
    if (editSession.current?.cell !== cell) {
      const current = sheet.cells[cell] ?? '';
      editSession.current = { cell, baseline: current, admitted: current, lock: null };
    }
    const session = editSession.current;
    if (session.lock !== null) {
      if (value === session.lock || session.lock.startsWith(value)) session.lock = null;
      else {
        draftRef.current = session.lock === (sheet.cells[cell] ?? '') ? null : { cell, text: session.lock };
        setEditEpoch(epoch => epoch + 1);
        setError(t('externalFormula'));
        return session.lock;
      }
    }
    const decision = admitCellEdit(session.baseline, session.admitted, value);
    session.admitted = decision.stored;
    if (decision.external) session.lock = decision.display;
    draftRef.current = decision.display === decision.stored ? null : { cell, text: decision.display };
    setSheet(current => {
      const now = current.cells[cell] ?? '';
      if (now === decision.stored) return current;
      const cells = { ...current.cells };
      if (decision.stored) cells[cell] = decision.stored;
      else delete cells[cell];
      return { ...current, cells };
    }, batch);
    setEditEpoch(epoch => epoch + 1);
    if (decision.external) setError(t('externalFormula'));
    else setError(previous => previous === t('externalFormula') ? '' : previous);
    return decision.display;
  };
  const setGrid = (edit: (current: WorksheetGrid) => WorksheetGrid | null, batch = false) => view.editor.commands.command(({ tr }) => {
    if (!view.editor.isEditable) return false;
    const position = view.getPos();
    const node = typeof position === 'number' ? tr.doc.nodeAt(position) : null;
    if (typeof position !== 'number' || node?.type.name !== 'spreadsheet') return false;
    const current = asOperableGrid({ ...emptyGridPresentation(), ...node.attrs, annotations: node.attrs.annotations ?? {} } as WorksheetGrid);
    const next = edit(current);
    if (!next) return false;
    if (next !== current) {
      if (batch || separateNextEdit.current) closeHistory(tr);
      separateNextEdit.current = batch;
      tr.setNodeMarkup(position, undefined, { ...node.attrs, ...next });
    }
    return true;
  });
  const setSheet = (edit: (current: Spreadsheet) => Spreadsheet | null, batch = false) => setGrid(current => {
    const next = edit(current.sheet);
    if (!next) return null;
    return next === current.sheet ? current : { ...current, sheet: next };
  }, batch);
  const structure = (change: AxisChange) => view.editor.commands.command(({ tr }) => {
    if (!view.editor.isEditable) return false;
    const worksheets: StructuredWorksheet[] = worksheetBlocks(tr.doc).map(worksheet => {
      let attrs = {};
      tr.doc.descendants(node => { if (node.type.name === 'spreadsheet' && node.attrs.blockId === worksheet.id) attrs = node.attrs; });
      return { ...emptyGridPresentation(), annotations: {}, ...attrs, ...worksheet };
    });
    const result = changeWorksheetStructure(worksheets, blockId, change);
    if (result.status !== 'ok') { setError(t('structuralError', { detail: result.detail ?? result.status })); return false; }
    closeHistory(tr);
    separateNextEdit.current = true;
    const changes = new Map(result.worksheets.map(worksheet => [worksheet.id, worksheet]));
    tr.doc.descendants((node, position) => {
      if (node.type.name !== 'spreadsheet') return;
      const changed = changes.get(node.attrs.blockId);
      if (changed) {
        const { sheet: next, annotations, formats, rowHeights, columnWidths, columnNames, merges, notes, rowFilter } = changed;
        tr.setNodeMarkup(position, undefined, {
          ...node.attrs, sheet: next, annotations, formats, rowHeights, columnWidths, columnNames, merges,
          notes: notes ?? node.attrs.notes ?? {}, rowFilter: rowFilter === undefined ? node.attrs.rowFilter ?? null : rowFilter,
        });
      }
    });
    setSelection(current => ({ anchor: mapWorksheetPosition(current.anchor, change), focus: mapWorksheetPosition(current.focus, change) }));
    setError('');
    return true;
  });
  const structureItems = () => <>
    <DropdownMenuItem disabled={sheet.rows >= spreadsheetLimits.rows} onSelect={() => structure({ kind: 'insert', axis: 'row', index: active.row })}>{t('insertRow')}</DropdownMenuItem>
    <DropdownMenuItem disabled={sheet.columns >= spreadsheetLimits.columns} onSelect={() => structure({ kind: 'insert', axis: 'column', index: active.column })}>{t('insertColumn')}</DropdownMenuItem>
    <DropdownMenuItem disabled={sheet.rows <= 1} onSelect={() => setDialog('deleteRow')}>{t('deleteRow')}</DropdownMenuItem>
    <DropdownMenuItem disabled={sheet.columns <= 1} onSelect={() => setDialog('deleteColumn')}>{t('deleteColumn')}</DropdownMenuItem>
    <DropdownMenuItem disabled={active.row === 0} onSelect={() => structure({ kind: 'move', axis: 'row', index: active.row, to: active.row - 1 })}>{t('rowUp')}</DropdownMenuItem>
    <DropdownMenuItem disabled={active.row === sheet.rows - 1} onSelect={() => structure({ kind: 'move', axis: 'row', index: active.row, to: active.row + 1 })}>{t('rowDown')}</DropdownMenuItem>
    <DropdownMenuItem disabled={active.column === 0} onSelect={() => structure({ kind: 'move', axis: 'column', index: active.column, to: active.column - 1 })}>{t('columnLeft')}</DropdownMenuItem>
    <DropdownMenuItem disabled={active.column === sheet.columns - 1} onSelect={() => structure({ kind: 'move', axis: 'column', index: active.column, to: active.column + 1 })}>{t('columnRight')}</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => { setSize(String(presentation.rowHeights[active.row] ?? gridDimensionLimits.row.default)); setDialog('resizeRow'); }}>{t('resizeRow')}</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => { setSize(String(presentation.columnWidths[active.column] ?? gridDimensionLimits.column.default)); setDialog('resizeColumn'); }}>{t('resizeColumn')}</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setColumnRename(presentation.columnNames[String(active.column)] ?? '')}>{t('renameColumn')}</DropdownMenuItem>
  </>;
  const addRows = () => {
    const requested = Number(rowBatch);
    if (!Number.isInteger(requested) || requested < 1) return;
    const count = Math.min(requested, spreadsheetLimits.rows - sheet.rows);
    for (let index = 0; index < count; index += 1) structure({ kind: 'insert', axis: 'row', index: sheet.rows });
  };
  const axisControls = useGridAxisControls(grid, presentation, editable,
    (axis, index, pixels) => setGrid(current => resizeGridAxis(current, axis, index, pixels), true),
    (axis, index, to) => structure({ kind: 'move', axis, index, to }),
    index => setColumnRename(presentation.columnNames[String(index)] ?? ''));
  const format = (patch: CellFormat | null) => setGrid(current => formatCellRange(current, range, patch), true);
  const currentFormat = presentation.formats[address] ?? {};
  const align = currentFormat.align ?? (typeof values[address] === 'number' ? 'right' : 'left');
  const inspection = useMemo(() => (inspector || isFormulaError(values[address])) && !calculation?.ambiguous
    ? inspectWorksheetCell(worksheetBlocks(view.editor.state.doc), calculation?.name ?? label, address) : null,
  [inspector, calculation, values, address, label, view.editor]);
  const insertFunction = (name: string) => {
    editCell(active, `=${name}()`);
    requestAnimationFrame(() => {
      formulaInput.current?.focus();
      formulaInput.current?.setSelectionRange(name.length + 2, name.length + 2);
    });
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
  const copyRange = async (cut = false) => {
    const snapshot = encodeCellRange(sheet, range);
    try {
      await navigator.clipboard.writeText(snapshot);
      if (cut && view.editor.isEditable) {
        const cleared = setSheet(current => encodeCellRange(current, range) === snapshot ? clearCellRange(current, range) : null, true);
        setError(cleared ? '' : t('cutChanged'));
      } else setError('');
    } catch {
      setError(t('copyFailed'));
    }
  };
  const cut = (event: ClipboardEvent<HTMLInputElement>) => {
    if (!isRange || !editable) return;
    copy(event);
    setSheet(current => clearCellRange(current, range), true);
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
    const target = isRange ? range.start : position;
    const pastedRange = clipboardTarget(target, data);
    if (pastedRange && gridWriteConflicts(presentation, pastedRange)) { setError(t('mergeConflict')); return; }
    let failure: RangeEditError | null = null;
    if (!setSheet(current => {
      const result = pasteCellGrid(current, target, data);
      if ('error' in result) {
        failure = result.error;
        return null;
      }
      return result.sheet;
    }, true)) {
      setError(t(failure === 'external' ? 'externalFormula' : 'gridPasteLimit'));
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
    if (gridWriteConflicts(presentation, selection)) { setError(t('mergeConflict')); return; }
    let failure: RangeEditError | null = null;
    const filled = setSheet(current => {
      const result = fillCellRange(current, selection, direction);
      if ('error' in result) {
        failure = result.error;
        return null;
      }
      return result.sheet;
    }, true);
    setError(filled ? '' : t(failure === 'external' ? 'externalFormula' : 'fillLimit'));
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
    if (event.key === 'Tab') {
      event.preventDefault();
      const next = clamp({ column: position.column + (event.shiftKey ? -1 : 1), row: position.row });
      selectCell(next); focusCell(next); return;
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
    actions={editable && <IconButton className="notebook-sheet-download" label={t('exportCsv')} disabled={exporting} onClick={() => downloadFile(`${(calculation?.name ?? label).replace(/[<>|"\u0000-\u001f]/g, '_')}.csv`, exportWorksheetCsv(sheet, values), 'text/csv;charset=utf-8')}><Icon name="download" /></IconButton>}
    menuActions={<>
      {editable && <DropdownMenuItem onSelect={() => setToolsOpen(value => !value)}>{t('worksheetTools')}</DropdownMenuItem>}
      {editable && <DropdownMenuItem onSelect={() => setDetailsOpen(value => !value)}>{t('cellDetails')}</DropdownMenuItem>}
      <DropdownMenuItem disabled={exporting} onSelect={() => void exportExcel()}>{t(hasMultipleSheets ? 'exportWorkbook' : 'exportExcel')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => downloadFile(`${(calculation?.name ?? label).replace(/[<>|"\u0000-\u001f]/g, '_')}.csv`, exportWorksheetCsv(sheet, values), 'text/csv;charset=utf-8')}>{t('exportCsv')}</DropdownMenuItem>
    </>}
    title={editable ? <Input unstyled className="notebook-block-name" aria-label={t('sheetName')} value={worksheetName ?? calculation?.name ?? label}
        onChange={event => setWorksheetName(event.target.value)} onBlur={applyWorksheetName} maxLength={31}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === 'Escape') { event.preventDefault(); setWorksheetName(null); }
        }} /> : <strong>{calculation?.name || label || t('spreadsheet')}</strong>}>
    {toolsOpen && <div className="notebook-sheet-tools">
          <div className="notebook-sheet-controls">
            <Select className="notebook-color-select" label={t('precision')} value={currentFormat.precision === undefined ? 'auto' : String(currentFormat.precision)}
              onChange={value => format({ precision: value === 'auto' ? undefined : Number(value) })}
              options={[{ value: 'auto', label: t('auto') }, ...Array.from({ length: 13 }, (_, index) => ({ value: String(index), label: String(index) }))]} />
            <Button variant="ghost" aria-label={t('clearFormat')} onClick={() => format(null)}>{t('clearFormat')}</Button>
            <Button variant="ghost" aria-label={t('copyRange')} onClick={() => void copyRange()}><Icon name="copy" /></Button>
            <Button variant="ghost" aria-label={t('cutRange')} onClick={() => void copyRange(true)}>✂</Button>
            <Button variant="ghost" aria-label={t('fillDown')} disabled={range.start.row === range.end.row} onClick={() => fill('down')}>↓</Button>
            <Button variant="ghost" aria-label={t('fillRight')} disabled={range.start.column === range.end.column} onClick={() => fill('right')}>→</Button>
            <Button variant="ghost" aria-label={t('clearCells')} onClick={clear}><Icon name="trash" /></Button>
            <Button variant="ghost" onClick={() => structure({ kind: 'insert', axis: 'row', index: sheet.rows })} disabled={sheet.rows >= spreadsheetLimits.rows}>{t('addRow')}</Button>
            <Button variant="ghost" onClick={() => structure({ kind: 'insert', axis: 'column', index: sheet.columns })} disabled={sheet.columns >= spreadsheetLimits.columns}>{t('addColumn')}</Button>
            <Button variant="ghost" disabled={isRange || active.row === sheet.rows - 1 || !source} onClick={() =>
              fill('down', normalizeCellRange(active, { column: active.column, row: active.row + 1 }))}>{t('fillNext')}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost">{t('structure')}</Button></DropdownMenuTrigger>
              <DropdownMenuContent>{structureItems()}</DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" disabled={!presentation.merges.some(merge => rangeContains(range, merge.start) || rangeContains(merge, active))}
              onClick={() => setGrid(current => unmergeCellRange(current, range), true)}>{t('unmerge')}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" aria-label={t('functions')}>Σ</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDialog('functions')}>{t('functionHelp')}</DropdownMenuItem>
                {formulaFunctions.map(name => <DropdownMenuItem key={name} onSelect={() => insertFunction(name)}>{name}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="notebook-note">{t('gridHint')} {t('rangeHint')} {axisControls.instructions}</p>
    </div>}
    {(detailsOpen || !editable) && <CellAnnotations view={view} address={address} editable={editable} />}
    <div className="notebook-sheet-format" role="group" aria-label={t('format')}>
      {editable && <>
      {(['bold', 'italic'] as const).map(key => <Button key={key} variant="ghost" aria-label={t(key)} aria-pressed={!!currentFormat[key]}
        onClick={() => format({ [key]: !currentFormat[key] })}><Icon name={key} /></Button>)}
      <Button variant="ghost" aria-label={t('underline')} aria-pressed={!!currentFormat.underline}
        onClick={() => format({ underline: !currentFormat.underline })}><u aria-hidden="true">U</u></Button>
      <Button variant="ghost" aria-label={t('strike')} aria-pressed={!!currentFormat.strike}
        onClick={() => format({ strike: !currentFormat.strike })}><s aria-hidden="true">S</s></Button>
      <CellLinkControl variant="button" address={address} url={presentation.annotations[address]?.url}
        commit={edit => setGrid(edit, true)} onInvalid={() => setError(t('invalidCellLink'))} />
      <span className="notebook-format-divider" aria-hidden="true" />
      <Select className="notebook-color-select" label={t('foreground')} value={currentFormat.foreground ?? 'default'}
        leading={<span aria-hidden="true" className={`notebook-text-${currentFormat.foreground ?? 'default'}`}>A</span>} onChange={value => format({ foreground: value as CellColor })}
        options={(['default', 'blue', 'green', 'rose'] as const).map(value => ({ value, label: t(value) }))} />
      <span className="notebook-format-divider" aria-hidden="true" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" className="notebook-format-menu" aria-label={t(align)}><span aria-hidden="true" className="notebook-align-mark" data-align={align}><i /><i /><i /></span><Icon name="chevron-down" size={12} /></Button></DropdownMenuTrigger>
        <DropdownMenuContent>
          {(['left', 'center', 'right'] as const).map(value => <DropdownMenuItem key={value} onSelect={() => format({ align: value })}>{t(value)}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="notebook-format-divider" aria-hidden="true" />
      <Button variant="ghost" aria-label={t('merge')} disabled={!isRange} onClick={() => setDialog('merge')}><Icon name="table" /></Button>
      <span className="notebook-format-divider" aria-hidden="true" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" className="notebook-format-menu" aria-label={t('tableSettings')}><Icon name="gear" /><Icon name="chevron-down" size={12} /></Button></DropdownMenuTrigger>
        <DropdownMenuContent>
          {(['default', 'blue', 'green', 'rose'] as const).map(value => <DropdownMenuItem key={value} onSelect={() => format({ background: value })}>{t('background')}: {t(value)}</DropdownMenuItem>)}
          {structureItems()}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="notebook-format-divider" aria-hidden="true" />
      </>}
      <div className="notebook-formula">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" className="notebook-formula-fx" aria-label={t('insertFunction')}>ƒx<Icon name="chevron-down" size={12} /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setInspector(value => !value)}>{t('inspector')}</DropdownMenuItem>
          {formulaFunctions.map(name => <DropdownMenuItem key={name} onSelect={() => insertFunction(name)}>{name}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="notebook-formula-field">
      <output aria-label={t(isRange ? 'selectedRange' : 'cell', { address: rangeAddress })}>{rangeAddress}</output>
      <FormulaInput ref={formulaInput} onComplete={value => editCell(active, value, true)} aria-label={t('rawCell')} placeholder="" value={source} readOnly={!editable}
        maxLength={spreadsheetLimits.cellLength} onFocus={() => beginEdit(active)} onBlur={() => finishEdit(address)} onChange={event => {
          const shown = editCell(active, event.target.value);
          if (event.target.value !== shown) event.target.value = shown;
        }}
        onPaste={event => paste(event, active)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); focusCell(active); }
        }} />
      </div>
      </div>
    </div>
    <div ref={grid} onScrollCapture={axisControls.rememberScroll}
      style={{ '--notebook-grid-width': `${rowIndexWidth + Array.from({ length: sheet.columns }, (_, column) => axisControls.size('column', column)).reduce((sum, width) => sum + width, 0)}px` } as CSSProperties}>
      <Table label={t('spreadsheet')} density="compact" layout="fixed" className="notebook-grid-scroll" tableClassName="notebook-grid">
        <colgroup><col style={{ width: rowIndexWidth }} />{Array.from({ length: sheet.columns }, (_, column) => <col key={column} style={{ width: axisControls.size('column', column) }} />)}</colgroup>
        <thead><tr><th scope="col" aria-label="#" />
          {Array.from({ length: sheet.columns }, (_, column) => axisControls.header('column', column, column >= range.start.column && column <= range.end.column))}
        </tr></thead>
        <tbody>{Array.from({ length: sheet.rows }, (_, row) => skippedRows.has(row) ? null : <tr key={row} style={{ height: axisControls.size('row', row) }}>
          {axisControls.header('row', row, row >= range.start.row && row <= range.end.row)}
          {Array.from({ length: sheet.columns }, (_, column) => {
            const key = cellAddress(column, row);
            const raw = sheet.cells[key] ?? '';
            const computed = values[key];
            const cellFormat = presentation.formats[key];
            const text = formatCellValue(computed, cellFormat);
            const position = { column, row };
            const merge = mergedCell(presentation.merges, position);
            const drawMerge = merge && !skippedRows.has(merge.start.row) ? merge : undefined;
            if (drawMerge && (drawMerge.start.column !== column || drawMerge.start.row !== row)) return null;
            return <td key={key} rowSpan={drawMerge ? shownRowSpan(drawMerge.start.row, drawMerge.end.row) : undefined} colSpan={drawMerge ? drawMerge.end.column - column + 1 : undefined}
              data-foreground={cellFormat?.foreground} data-background={cellFormat?.background}
              data-bold={cellFormat?.bold || undefined} data-italic={cellFormat?.italic || undefined} data-underline={cellFormat?.underline || undefined} data-strike={cellFormat?.strike || undefined}
              data-align={cellFormat?.align ?? (typeof computed === 'number' ? 'right' : undefined)} data-active={key === address || undefined}
              data-range-selected={isRange && rangeContains(range, position) || undefined} data-error={isFormulaError(computed) || undefined}>
              <span className="notebook-cell-display" aria-hidden="true"><span>{text}</span></span>
              {presentation.annotations[key]?.url && <a className="notebook-cell-link" href={presentation.annotations[key].url} target="_blank" rel="noreferrer">{t('openLink')}</a>}
              <FormulaInput unstyled onComplete={value => editCell(position, value, true)} className="notebook-cell" aria-label={t('cell', { address: key })} data-cell={key}
                value={editable && focused === key ? (draftRef.current?.cell === key ? draftRef.current.text : raw) : text} readOnly={!editable} maxLength={spreadsheetLimits.cellLength}
                onMouseDown={event => {
                  if (event.button !== 0) return;
                  if (event.shiftKey) {
                    event.preventDefault();
                    setSelection({ anchor: active, focus: position });
                    focusCell(position);
                  } else selectCell(position);
                }}
                onFocus={() => { beginEdit(position); if (!keepRangeFocus.current) selectCell(position); setFocused(key); }} onBlur={() => { finishEdit(key); setFocused(null); }}
                onChange={event => {
                  if (isRange) selectCell(position);
                  const shown = editCell(position, event.target.value);
                  if (event.target.value !== shown) event.target.value = shown;
                }}
                onKeyDown={event => onKey(event, position)} onCopy={copy} onCut={cut} onPaste={event => paste(event, position)} />
            </td>;
          })}
        </tr>)}</tbody>
      </Table>
    </div>
    {editable && <div className="notebook-sheet-foot">
      <div className="notebook-add-rows">
        <Input aria-label={t('rowsToAdd')} inputMode="numeric" value={rowBatch} onChange={event => setRowBatch(event.target.value.replace(/\D/g, '').slice(0, 4))} />
        <Button variant="ghost" disabled={sheet.rows >= spreadsheetLimits.rows || !Number(rowBatch)} onClick={addRows}>{t('addRows')}</Button>
      </div>
      <span className="notebook-sheet-size">{t('rowCount', { rows: sheet.rows })}</span>
    </div>}
    <SheetOperations grid={presentation} sheetName={calculation?.name ?? label} address={address} readonly={!editable}
      onChange={next => { setGrid(() => next, true); }} />
    <div className="notebook-grid-status" role="status">{axisControls.announcement}</div>
    {inspection?.type === 'error' && <Feedback kind="error">{t('selectedError', { address, value: String(values[address]) })}</Feedback>}
    {inspector && inspection && <section className="notebook-formula-inspector" aria-label={t('inspector')}>
      <dl><dt>{t('rawSource')}</dt><dd>{inspection.source || '∅'}</dd><dt>{t('evaluated')}</dt><dd>{formatCellValue(inspection.value)}</dd>
        <dt>{t('valueType')}</dt><dd>{inspection.type}</dd></dl>
      <strong>{t('dependencies')}</strong>
      {inspection.dependencies.length ? <ul>{inspection.dependencies.map((dependency, index) => <li key={index}>
        {dependency.sheet}!{cellRangeLabel({ start: dependency.from, end: dependency.to })}
      </li>)}</ul> : <p>{t('noDependencies')}</p>}
      <p className="notebook-note">{t('dependencyHint')}</p>
      <FormulaSourceTree syntax={inspection.syntax} />
    </section>}
    {columnRename !== null && <RenameColumnDialog column={active.column} initialName={columnRename}
      commit={edit => setGrid(edit, true)} onInvalid={() => setError(t('invalidColumnName'))} onClose={() => setColumnRename(null)} />}
    {dialog && dialog !== 'functions' && <Dialog title={t(dialog)} closeLabel={t('close')} onClose={() => setDialog(null)}
      onSubmit={event => {
        event.preventDefault();
        if (dialog === 'merge') {
          const result = mergeCellRange(presentation, range, true);
          if (result.status !== 'ok') { setError(t('mergeConflict')); setDialog(null); return; }
          setGrid(current => { const latest = mergeCellRange(current, range, true); return latest.status === 'ok' ? latest.grid : null; }, true);
        } else if (dialog === 'deleteRow' || dialog === 'deleteColumn') {
          structure({ kind: 'delete', axis: dialog === 'deleteRow' ? 'row' : 'column', index: dialog === 'deleteRow' ? active.row : active.column });
        } else {
          const axis = dialog === 'resizeRow' ? 'row' : 'column';
          setGrid(current => resizeGridAxis(current, axis, active[axis], Number(size)), true);
        }
        setDialog(null);
      }} footer={<><Button variant="ghost" onClick={() => setDialog(null)}>{t('cancel')}</Button><Button type="submit">{t('confirm')}</Button></>}>
      {dialog === 'merge' ? <p>{t('mergePolicy')}</p> : dialog.startsWith('delete') ? <p>{t('deletePolicy')}</p> :
        <label className="notebook-field">{t('pixels')}<Input type="number" required step={1}
          min={gridDimensionLimits[dialog === 'resizeRow' ? 'row' : 'column'].min}
          max={gridDimensionLimits[dialog === 'resizeRow' ? 'row' : 'column'].max} value={size} onChange={event => setSize(event.target.value)} /></label>}
    </Dialog>}
    {dialog === 'functions' && <Dialog title={t('functionHelp')} closeLabel={t('close')} onClose={() => setDialog(null)}
      footer={<Button onClick={() => { editCell(active, `=${functionName}()`); setDialog(null); requestAnimationFrame(() => {
        formulaInput.current?.focus(); formulaInput.current?.setSelectionRange(functionName.length + 2, functionName.length + 2);
      }); }}>{t('insertFunction')}</Button>}>
      <Select label={t('searchFunctions')} searchable showHint value={functionName} onChange={setFunctionName}
        options={formulaFunctions.map(value => ({ value, label: value, hint: formulaHelp[value].description }))} />
      <p>{formulaHelp[functionName].syntax}</p><p>{formulaHelp[functionName].description}</p>
    </Dialog>}
    {calculation?.ambiguous && <Feedback kind="error">{t('workbookNameConflict')}</Feedback>}
    {error && <Feedback kind="error">{error}</Feedback>}
  </BlockFrame>;
}
