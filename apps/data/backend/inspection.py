"""Bounded tabular inspection using the existing exact-value core. No I/O."""
from dataclasses import dataclass, asdict, replace
from decimal import Decimal
import json
import re
import csv
from hashlib import sha256
from io import StringIO
from dataset import Cell, Dataset as Records, Field, Invalid, Kind, Record
from view import DatasetView
from datasets import (ConversionExample, Duplicate, FieldProfile, MAX_FIELDS, MAX_ROWS, PARSER_VERSION,
                      PREVIEW_BYTES, PreviewRequest, QualityReport, ViewSpec)


@dataclass(frozen=True)
class Inspection:
    records: Records
    report: QualityReport
    delimited: bool = False
    duplicates: tuple[Duplicate, ...] = ()

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
        seen, duplicates = {}, []
        for row in records.records:
            for key, cell in row.cells:
                empty[key] += int(cell.kind == Kind.STRING and cell.display == '')
            # Duplicate means identical top-level fields and exact value tokens.
            signature = tuple(sorted((key, cell.kind.value, cell.token) for key, cell in row.cells))
            if signature in seen:
                duplicates.append(Duplicate(row.ordinal + 1, seen[signature], row.line))
            else:
                seen[signature] = row.ordinal + 1
        profiles = tuple(FieldProfile(f.name, tuple(k.value for k in f.kinds), f.missing, f.nulls, empty[f.name])
                         for f in records.fields)
        report = QualityReport(PARSER_VERSION, 'full', len(records.records), profiles,
                               sum(f.missing for f in profiles), sum(f.nulls for f in profiles),
                               sum(empty.values()), len(duplicates), tuple(duplicates[:10]), blank_lines)
        return cls(records, report, format in ('csv', 'tsv'), tuple(duplicates))

    def admit(self, spec: ViewSpec, offset=0, limit=50):
        """Apply Data's interpretation and issue rules once, before the shared view."""
        columns = spec.admitted_columns([field.name for field in self.records.fields])
        if spec.interpretations and not self.delimited:
            raise ValueError('Decimal interpretation is available for CSV and TSV; JSON keeps its declared types')
        interpreted = {item.field for item in spec.interpretations}
        if spec.issue and spec.issue.kind == 'conversion' and (not interpreted or
                (spec.issue.field is not None and spec.issue.field not in interpreted)):
            raise ValueError('Apply a decimal interpretation before inspecting conversion failures')
        failures, records = [], []
        for row in self.records.records:
            cells = []
            for name, cell in row.cells:
                if name in interpreted:
                    # Locale, whitespace and identifiers are never inferred. Empty is
                    # a failed conversion, not zero or null. Original display survives.
                    number = None
                    if re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?', cell.display):
                        try:
                            number = Decimal(cell.display)
                        except ArithmeticError:
                            pass
                    if number is None or not number.is_finite():
                        failures.append(ConversionFailure(row.ordinal, name))
                    else:
                        cell = Cell(Kind.NUMBER, str(number), cell.display, number)
                cells.append((name, cell))
            records.append(replace(row, cells=tuple(cells)))
        failure_keys = {(failure.ordinal, failure.field) for failure in failures}
        profiles = []
        failure_counts, failure_examples = {}, {}
        for failure in failures:
            failure_counts[failure.field] = failure_counts.get(failure.field, 0) + 1
            examples = failure_examples.setdefault(failure.field, [])
            if len(examples) < 5:
                row = self.records.records[failure.ordinal]
                examples.append(ConversionExample(row.ordinal + 1, row.line, row.cell(failure.field).display[:240]))
        for profile in self.report.fields:
            profiles.append(replace(profile, interpretation='number' if profile.name in interpreted else None,
                                    conversionFailures=failure_counts.get(profile.name, 0),
                                    conversionExamples=tuple(failure_examples.get(profile.name, ()))))
        report = replace(self.report, fields=tuple(profiles), conversionFailures=len(failures))
        # Reject unsupported numeric comparisons before filtering, even when another
        # operation would hide the text rows. A legitimate empty result stays 'ok'.
        if spec.filter and spec.filter.operator in ('gte', 'lte') and spec.filter.field not in interpreted:
            field = next(field for field in self.records.fields if field.name == spec.filter.field)
            if any(kind not in (Kind.NUMBER, Kind.NULL) for kind in field.kinds):
                raise ValueError(f'Field "{spec.filter.field}" contains text or nonnumeric values; explicitly interpret CSV/TSV as decimal numbers before numeric filtering')
        identity = self.records.id
        if spec.interpretations or spec.issue:
            identity = sha256((identity + json.dumps(dict(interpretations=spec.public()['interpretations'],
                                                         issue=spec.public()['issue']), sort_keys=True)).encode()).hexdigest()
        admitted_records = replace(self.records, id=identity, records=tuple(records))
        try:
            view = DatasetView.admit(spec.query_body(columns, offset, limit), admitted_records)
        except Invalid as error:
            raise ValueError(str(error)) from error
        if spec.issue:
            issue = spec.issue
            duplicates = {duplicate.row - 1 for duplicate in self.duplicates}
            names = (issue.field,) if issue.field else tuple(field.name for field in self.records.fields)
            matching = set()
            for row in self.records.records:
                if issue.kind == 'duplicate':
                    match = row.ordinal in duplicates
                elif issue.kind == 'conversion':
                    match = any((row.ordinal, name) in failure_keys for name in names)
                else:
                    cells = tuple(row.cell(name) for name in names)
                    if issue.kind == 'missing':
                        match = any(cell is None for cell in cells)
                    elif issue.kind == 'null':
                        match = any(cell is not None and cell.kind == Kind.NULL for cell in cells)
                    else:
                        match = any(cell is not None and cell.kind == Kind.STRING and cell.display == '' for cell in cells)
                if match:
                    matching.add(row.ordinal)
            admitted_records = replace(admitted_records, records=tuple(row for row in records if row.ordinal in matching))
        return AdmittedInspection(admitted_records, report, view, tuple(failures), spec)

    def page(self, request: PreviewRequest):
        admitted = self.admit(request.view, request.offset, request.limit)
        return admitted.page()


@dataclass(frozen=True)
class ConversionFailure:
    ordinal: int
    field: str


@dataclass(frozen=True)
class AdmittedInspection:
    records: Records
    report: QualityReport
    view: DatasetView
    failures: tuple[ConversionFailure, ...]
    spec: ViewSpec

    def page(self):
        view = self.view
        try:
            rows = view.query.apply(self.records)
            selected = view.selection.apply(rows)
        except Invalid as error:
            raise ValueError(str(error)) from error
        failures = {(failure.ordinal, failure.field) for failure in self.failures}
        page = rows[view.offset:view.offset + view.limit]
        return dict(report=asdict(self.report), columns=list(view.columns), matched=len(rows), selected=len(selected),
                    offset=view.offset, viewId=view.identity(self.records),
                    issueScope='full-input-intersect-current-filter' if self.spec.issue else None,
                    nextOffset=view.offset + view.limit if view.offset + view.limit < len(rows) else None,
                    rows=[dict(row=row.ordinal + 1, pointer=row.pointer, line=row.line,
                               cells=[(dict(kind=cell.kind.value, text=cell.display)
                                       | (dict(exact=str(cell.number)) if cell.number is not None else {})
                                       | (dict(conversionError='Not a finite decimal number') if (row.ordinal, key) in failures else {}))
                                      if (cell := row.cell(key)) is not None else dict(kind='missing', text='')
                                      for key in view.columns]) for row in page])
