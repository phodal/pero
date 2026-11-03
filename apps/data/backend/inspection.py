"""Bounded tabular inspection using the existing exact-value core. No I/O."""
from dataclasses import dataclass, asdict
import csv
from hashlib import sha256
from io import StringIO
from dataset import Cell, Dataset as Records, Field, Invalid, Kind, Record
from view import DatasetView
from datasets import (Duplicate, FieldProfile, MAX_FIELDS, MAX_ROWS, PARSER_VERSION,
                      PREVIEW_BYTES, PreviewRequest, QualityReport)


@dataclass(frozen=True)
class Inspection:
    records: Records
    report: QualityReport

    @classmethod
    def parse(cls, content: bytes, name: str, format: str):
        if len(content) > PREVIEW_BYTES:
            raise ValueError('Inspection is limited to 10 MiB; the original remains stored')
        source = content.decode('utf-8-sig')
        blank_lines = 0
        if format in ('csv', 'tsv'):
            reader = csv.reader(StringIO(source, newline=''), delimiter='\t' if format == 'tsv' else ',', strict=True)
            try:
                header = next(reader, [])
                if not header or any(not key or len(key) > 300 for key in header) or len(set(header)) != len(header):
                    raise ValueError('CSV headers must be nonempty, unique and at most 300 characters')
                if len(header) > MAX_FIELDS:
                    raise ValueError('Inspection is limited to 256 fields')
                rows = []
                while True:
                    line = reader.line_num + 1
                    values = next(reader, None)
                    if values is None:
                        break
                    if values == []:
                        blank_lines += 1
                        continue
                    if len(values) != len(header):
                        raise ValueError(f'Line {line}: expected {len(header)} fields, found {len(values)}')
                    if len(rows) >= MAX_ROWS:
                        raise ValueError('Inspection is limited to 100,000 records')
                    rows.append(Record(len(rows), '', line,
                                       tuple((key, Cell.admit(value)) for key, value in zip(header, values))))
                records = Records(sha256(content).hexdigest(), name, source, False, tuple(rows),
                                  tuple(Field(key, (Kind.STRING,), 0, 0) for key in header))
            except csv.Error as error:
                raise ValueError(f'Line {reader.line_num}: {error}') from error
        elif format in ('json', 'jsonl', 'ndjson'):
            records = Records.parse(source, name, format != 'json')
            if format != 'json':
                blank_lines = sum(not line.strip() for line in source.splitlines())
        else:
            raise ValueError('Preview supports CSV, TSV, JSON and JSONL; this file remains opaque')
        if len(records.fields) > MAX_FIELDS or any(not f.name or len(f.name) > 300 for f in records.fields):
            raise ValueError('Inspection supports up to 256 fields with names of 1–300 characters')
        empty = dict.fromkeys((f.name for f in records.fields), 0)
        seen, examples, duplicates = {}, [], 0
        for row in records.records:
            for key, cell in row.cells:
                empty[key] += int(cell.kind == Kind.STRING and cell.display == '')
            # Duplicate means identical top-level fields and exact value tokens.
            signature = tuple(sorted((key, cell.kind.value, cell.token) for key, cell in row.cells))
            if signature in seen:
                duplicates += 1
                if len(examples) < 10:
                    examples.append(Duplicate(row.ordinal + 1, seen[signature], row.line))
            else:
                seen[signature] = row.ordinal + 1
        profiles = tuple(FieldProfile(f.name, tuple(k.value for k in f.kinds), f.missing, f.nulls, empty[f.name])
                         for f in records.fields)
        report = QualityReport(PARSER_VERSION, 'full', len(records.records), profiles,
                               sum(f.missing for f in profiles), sum(f.nulls for f in profiles),
                               sum(empty.values()), duplicates, tuple(examples), blank_lines)
        return cls(records, report)

    def page(self, request: PreviewRequest):
        columns = request.view.admitted_columns([field.name for field in self.records.fields])
        try:
            view = DatasetView.admit(request.view.query_body(columns, request.offset, request.limit), self.records)
            rows = view.query.apply(self.records)
            selected = view.selection.apply(rows)
        except Invalid as error:
            raise ValueError(str(error)) from error
        page = rows[request.offset:request.offset + request.limit]
        return dict(report=asdict(self.report), columns=list(columns), matched=len(rows), selected=len(selected),
                    offset=request.offset, viewId=view.identity(self.records),
                    nextOffset=request.offset + request.limit if request.offset + request.limit < len(rows) else None,
                    rows=[dict(row=row.ordinal + 1, pointer=row.pointer, line=row.line,
                               cells=[dict(kind=cell.kind.value, text=cell.display)
                                      if (cell := row.cell(key)) is not None else dict(kind='missing', text='')
                                      for key in columns]) for row in page])
