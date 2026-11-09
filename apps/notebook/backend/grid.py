"""Validated visual grid metadata, independent of stored cell inputs."""
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
        from document import check_coordinates, fields, integer
        formats = value.get('formats', {})
        check_coordinates(formats, rows, columns)
        for style in formats.values():
            fields(style, set(), {'bold', 'italic', 'underline', 'foreground', 'background', 'align', 'precision'})
            for key, setting in style.items():
                if key in {'bold', 'italic', 'underline'} and type(setting) is not bool:
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
        return cls(formats, *dimensions, tuple(merges))
