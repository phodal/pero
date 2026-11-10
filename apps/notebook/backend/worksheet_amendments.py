"""Audited cell amendments append an entry revision; historical receipts stay intact."""
from contextlib import closing
from dataclasses import dataclass
from copy import deepcopy
from datetime import datetime, timezone
import json
import re
from uuid import uuid4

from document import NotebookDocument, fields, integer, string, block_id, cell_values, MAX_CELL
from store import RevisionConflict
from templates import preserve_template_origins


@dataclass(frozen=True)
class WorksheetAmendment:
    operation_id: str
    expected_revision: int
    worksheet_id: str
    edits: dict
    author: str
    reason: str

    @classmethod
    def parse(cls, value):
        data = fields(value, {'operationId', 'expectedRevision', 'worksheetId', 'edits', 'author', 'reason'})
        operation = block_id(data['operationId'])
        revision = integer(data['expectedRevision'], 'expected revision')
        identity = block_id(data['worksheetId'])
        author = string(data['author'], 'author', 200).strip()
        reason = string(data['reason'], 'amendment reason', 4000).strip()
        edits = data['edits']
        if not author or not reason:
            raise ValueError('Author attribution and an amendment reason are required')
        if not isinstance(edits, dict) or not 1 <= len(edits) <= 1000:
            raise ValueError('An amendment needs 1–1,000 cell edits')
        # Grid bounds are validated once the authoritative worksheet is loaded.
        for address, raw in edits.items():
            if not isinstance(address, str) or not re.fullmatch(r'[A-Z]{1,2}[1-9][0-9]{0,2}', address):
                raise ValueError('Invalid amended cell address')
            string(raw, 'cell input', MAX_CELL)
        return cls(operation, revision, identity, dict(edits), author, reason)

    def wire(self):
        return {'operationId': self.operation_id, 'expectedRevision': self.expected_revision,
                'worksheetId': self.worksheet_id, 'edits': self.edits, 'author': self.author, 'reason': self.reason}

    def apply(self, document):
        candidate = deepcopy(document.wire())
        parsed = NotebookDocument.parse(candidate)
        target = parsed.block(self.worksheet_id)
        if not target or target['type'] != 'spreadsheet':
            raise ValueError('The selected worksheet does not exist in this revision')
        sheet = target['attrs']['sheet']
        cell_values(self.edits, sheet['rows'], sheet['columns'])
        changes = [{'address': address, 'before': sheet['cells'].get(address, ''), 'after': raw}
                   for address, raw in sorted(self.edits.items()) if sheet['cells'].get(address, '') != raw]
        if not changes:
            raise ValueError('The amendment does not change any cell inputs')
        for change in changes:
            if change['after']:
                sheet['cells'][change['address']] = change['after']
            else:
                sheet['cells'].pop(change['address'], None)
        updated = NotebookDocument.parse(parsed.wire())
        preserve_template_origins(document.wire(), updated.wire())
        return updated, changes


class WorksheetAmendmentStore:
    def __init__(self, entries):
        self.entries = entries
        with closing(entries._connect()) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS worksheet_amendments (
                entry_id TEXT NOT NULL, operation_id TEXT NOT NULL, request TEXT NOT NULL,
                receipt TEXT NOT NULL, PRIMARY KEY (entry_id, operation_id))''')

    def list(self, identity):
        with closing(self.entries._connect()) as connection:
            self.entries._read(connection, identity)
            return [json.loads(row['receipt']) for row in connection.execute(
                'SELECT receipt FROM worksheet_amendments WHERE entry_id = ? ORDER BY rowid DESC', (identity,))]

    def amend(self, identity, amendment):
        request = json.dumps(amendment.wire(), sort_keys=True, ensure_ascii=False)
        with closing(self.entries._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            prior = connection.execute('SELECT * FROM worksheet_amendments WHERE entry_id = ? AND operation_id = ?',
                                       (identity, amendment.operation_id)).fetchone()
            if prior:
                if prior['request'] != request:
                    raise ValueError('This amendment operation already has different inputs')
                receipt = json.loads(prior['receipt'])
                return {'entry': self.entries._read(connection, identity, receipt['revision']).wire(), 'amendment': receipt}
            current = self.entries._read(connection, identity)
            if current.revision != amendment.expected_revision:
                raise RevisionConflict(current.revision)
            if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='drafts'").fetchone():
                draft = connection.execute('SELECT 1 FROM drafts WHERE entry_id = ?', (identity,)).fetchone()
                if draft:
                    raise ValueError('Save or discard the recoverable draft before amending the saved worksheet')
            updated, changes = amendment.apply(current.document)
            entry = self.entries._insert(connection, identity, current.revision + 1, updated)
            receipt = {'id': uuid4().hex, 'operationId': amendment.operation_id, 'entryId': identity,
                       'baseRevision': current.revision, 'revision': entry.revision,
                       'worksheetId': amendment.worksheet_id, 'author': amendment.author, 'reason': amendment.reason,
                       'recordedAt': datetime.now(timezone.utc).isoformat(), 'changes': changes,
                       'attribution': 'local-user-label-not-authenticated-signature'}
            connection.execute('INSERT INTO worksheet_amendments VALUES (?, ?, ?, ?)',
                               (identity, amendment.operation_id, request, json.dumps(receipt, ensure_ascii=False)))
            return {'entry': entry.wire(), 'amendment': receipt}


def worksheet_amendment_route(owner, method, path, body):
    match = re.fullmatch(r'/api/entries/([a-f0-9]{32})/amendments', path)
    if not match:
        return None
    if method == 'GET':
        return 200, {'amendments': owner.list(match[1])}
    if method == 'POST':
        return 200, owner.amend(match[1], WorksheetAmendment.parse(body()))
    return None
