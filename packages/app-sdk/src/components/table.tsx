// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { useMemo } from 'react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { ensureUiStyles } from './ui-styles';

export type TableColumnMeta = {
  /** Keep cell content on one line; use with a sized column so the table scrolls instead of crushing neighbors. */
  nowrap?: boolean;
  align?: 'start' | 'end';
};

export type TableColumn<T> = {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Preferred width in px (TanStack column size). */
  size?: number;
  minSize?: number;
  maxSize?: number;
  meta?: TableColumnMeta;
};

export type TableProps<T> = {
  rows: readonly T[];
  rowId: (row: T) => string;
  columns: readonly TableColumn<T>[];
  label?: string;
  labelledBy?: string;
  className?: string;
  density?: 'compact' | 'comfortable';
  unstyled?: boolean;
};

type ColumnMeta = TableColumnMeta;

/** Data table driven by TanStack Table. Callers set column sizes so dense cells do not crush the rest. */
export function Table<T>({ rows, rowId, columns, label, labelledBy, className, density = 'comfortable', unstyled }: TableProps<T>) {
  const defs = useMemo<ColumnDef<T, unknown>[]>(() => columns.map(column => ({
    id: column.id,
    header: () => column.header,
    cell: info => column.cell(info.row.original),
    size: column.size,
    minSize: column.minSize,
    maxSize: column.maxSize,
    meta: column.meta,
    enableResizing: false,
  })), [columns]);

  const table = useReactTable({
    data: rows as T[],
    columns: defs,
    getCoreRowModel: getCoreRowModel(),
    getRowId: row => rowId(row),
    defaultColumn: { size: 140, minSize: 72, maxSize: 640 },
    enableColumnResizing: false,
  });
  const minWidth = table.getCenterTotalSize();

  return <div className={['pero-ui-table-wrap', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined} data-density={density}
    ref={node => { if (node) ensureUiStyles(node.ownerDocument); }}>
    <table className="pero-ui-table" style={{ minWidth }} aria-label={label} aria-labelledby={labelledBy}>
      <colgroup>{table.getAllLeafColumns().map(column => <col key={column.id} style={{ width: column.getSize() }} />)}</colgroup>
      <thead>{table.getHeaderGroups().map(group => <tr key={group.id}>
        {group.headers.map(header => {
          const meta = header.column.columnDef.meta as ColumnMeta | undefined;
          return <th key={header.id} scope="col" data-align={meta?.align} data-nowrap={meta?.nowrap || undefined}
            style={{ width: header.getSize() }}>
            {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
          </th>;
        })}
      </tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row => <tr key={row.id}>
        {row.getVisibleCells().map((cell, index) => {
          const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
          const style = { width: cell.column.getSize() } as React.CSSProperties;
          const content = flexRender(cell.column.columnDef.cell, cell.getContext());
          return index === 0
            ? <th key={cell.id} scope="row" data-align={meta?.align} data-nowrap={meta?.nowrap || undefined} style={style}>{content}</th>
            : <td key={cell.id} data-align={meta?.align} data-nowrap={meta?.nowrap || undefined} style={style}>{content}</td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}
