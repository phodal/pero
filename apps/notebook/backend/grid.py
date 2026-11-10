"""Validated visual grid metadata, independent of stored cell inputs.

Notes and row filters are sheet-operation state: they do not change formula
inputs. Lengths match sheetOperationLimits in packages/notebook/src/sheet-operations.ts.
"""
from dataclasses import dataclass
import re


@dataclass(frozen=True)
class GridPresentation:
    formats: dict
    row_heights: dict
    column_widths: dict
    merges: tuple

    @classmethod
    def parse(cls, value, rows, columns):
        # Import at the parsing boundary to keep Notebook's schema composition acyclic.
        from document import check_coordinates, fields, integer, string
        formats = value.get('formats', {})
        check_coordinates(formats, rows, columns)
        for style in formats.values():
            fields(style, set(), {'bold', 'italic', 'underline', 'strike', 'foreground', 'background', 'align', 'precision'})
            for key, setting in style.items():
                if key in {'bold', 'italic', 'underline', 'strike'} and type(setting) is not bool:
                    raise ValueError('Invalid cell text style')
                if key in {'foreground', 'background'} and setting not in {'default', 'blue', 'green', 'rose'}:
                    raise ValueError('Invalid cell color')
                if key == 'align' and setting not in {'left', 'center', 'right'}:
                    raise ValueError('Invalid cell alignment')
                if key == 'precision':
                    integer(setting, 'cell precision', 12, minimum=0)
        dimensions = []
        for name, count, minimum, maximum in [('rowHeights', rows, 24, 240), ('columnWidths', columns, 64, 640)]:
            sizes = value.get(name, {})
            if not isinstance(sizes, dict) or len(sizes) > count:
                raise ValueError('Invalid grid dimensions')
            for index, pixels in sizes.items():
                if not isinstance(index, str) or not re.fullmatch(r'0|[1-9][0-9]*', index) or int(index) >= count:
                    raise ValueError('Invalid grid dimension index')
                integer(pixels, 'grid pixels', maximum, minimum=minimum)
            dimensions.append(sizes)
        names = value.get('columnNames', {})
        if not isinstance(names, dict) or len(names) > columns:
            raise ValueError('Invalid column names')
        for index, name in names.items():
            if not isinstance(index, str) or not re.fullmatch(r'0|[1-9][0-9]*', index) or int(index) >= columns:
                raise ValueError('Invalid column name index')
            string(name, 'column name', 80, required=True)
        merges = value.get('merges', [])
        if not isinstance(merges, list) or len(merges) > rows * columns // 2:
            raise ValueError('Invalid merged ranges')
        occupied = set()
        for merge in merges:
            fields(merge, {'start', 'end'})
            for point in merge.values():
                fields(point, {'column', 'row'})
                integer(point['column'], 'merge column', columns - 1, minimum=0)
                integer(point['row'], 'merge row', rows - 1, minimum=0)
            start, end = merge['start'], merge['end']
            if start['column'] > end['column'] or start['row'] > end['row'] or start == end:
                raise ValueError('Invalid merged range')
            cells = {(row, column) for row in range(start['row'], end['row'] + 1)
                     for column in range(start['column'], end['column'] + 1)}
            if cells & occupied:
                raise ValueError('Merged ranges overlap')
            occupied.update(cells)
        parse_sheet_operations(value, rows, columns)
        return cls(formats, *dimensions, tuple(merges))


def parse_sheet_operations(value, rows, columns):
    """Accept cell notes and a row filter. Both are optional on older sheets."""
    from document import check_coordinates, fields, integer, string
    notes = value.get('notes', {})
    if not isinstance(notes, dict):
        raise ValueError('Invalid cell notes')
    check_coordinates(notes, rows, columns)
    for note in notes.values():
        text = string(note, 'cell note', 500, required=True)
        if text != text.strip() or any(ord(character) < 32 for character in text):
            raise ValueError('Invalid cell note')
    row_filter = value.get('rowFilter', None)
    if row_filter is None:
        return
    fields(row_filter, {'column', 'query'})
    integer(row_filter['column'], 'filter column', columns - 1, minimum=0)
    query = string(row_filter['query'], 'row filter', 200, required=True)
    if query != query.strip() or any(ord(character) < 32 for character in query):
        raise ValueError('Invalid row filter')
