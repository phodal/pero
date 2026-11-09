"""Durable UI proposal recovery. Host remains the sole agent/session executor."""
from contextlib import closing
from dataclasses import dataclass
from hashlib import sha256
import json
import re

from document import block_id, fields, integer
from catalog import StructuredTableDraft

STATUSES = {'starting', 'unknown', 'running', 'needs_input', 'cancelling', 'completed', 'failed', 'cancelled', 'unavailable'}
TERMINAL = {'completed', 'failed', 'cancelled'}


def bounded_text(value, name, limit):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f'Invalid {name}')
    return value


@dataclass(frozen=True)
class ProposalRecovery:
    value: dict

    @classmethod
    def parse(cls, value, entry_id):
        data = fields(value, {'frozen', 'sessionId', 'status', 'transcript', 'decisions', 'application'})
        frozen = fields(data['frozen'], {'requestId', 'agentId', 'target', 'content', 'prompt'}, {'mode', 'table', 'sources', 'goal', 'emptyOnly'})
        if 'mode' in frozen:
            fields(frozen, {'requestId', 'agentId', 'target', 'content', 'prompt', 'mode', 'table', 'sources', 'goal', 'emptyOnly'})
            if frozen['mode'] != 'cells' or type(frozen['emptyOnly']) is not bool:
                raise ValueError('Invalid typed proposal mode')
            bounded_text(frozen['goal'], 'proposal goal', 4000)
            table = fields(frozen['table'], {'blockId', 'kind', 'table'})
            block_id(table['blockId'])
            if table['kind'] not in ('inputTable', 'registrationTable'):
                raise ValueError('Source snapshots cannot be AI targets')
            StructuredTableDraft.parse(table['table'])
            sources = frozen['sources']
            if not isinstance(sources, list) or not 1 <= len(sources) <= 8:
                raise ValueError('Select 1–8 sources')
            total, identities = 0, set()
            for source in sources:
                fields(source, {'id', 'name', 'kind', 'sha256', 'bytes', 'text'})
                identity = block_id(source['id'])
                if identity in identities:
                    raise ValueError('Duplicate source identity')
                identities.add(identity)
                bounded_text(source['name'], 'source name', 255)
                text = bounded_text(source['text'], 'source text', 65_536)
                size = integer(source['bytes'], 'source bytes', 65_536)
                digest = bounded_text(source['sha256'], 'source digest', 64)
                if source['kind'] not in ('block', 'file', 'attachment') or not re.fullmatch(r'[a-f0-9]{64}', digest):
                    raise ValueError('Invalid selected source')
                # Keep the BOM and every other UTF-8 byte; text is never normalized.
                raw = text.encode('utf-8')
                if len(raw) != size or sha256(raw).hexdigest() != digest:
                    raise ValueError('Selected source text does not match its UTF-8 byte count or SHA-256')
                total += size
            if total > 96 * 1024:
                raise ValueError('Selected sources exceed 96 KiB')
        elif set(frozen) != {'requestId', 'agentId', 'target', 'content', 'prompt'}:
            raise ValueError('Unexpected frozen proposal fields')
        request_id = bounded_text(frozen['requestId'], 'request identity', 128)
        if not re.fullmatch(r'[A-Za-z0-9_-]+', request_id):
            raise ValueError('Invalid request identity')
        if not bounded_text(frozen['agentId'], 'agent identity', 200):
            raise ValueError('Missing Host agent')
        target = fields(frozen['target'], {'entryId', 'revision'})
        if target['entryId'] != entry_id:
            raise ValueError('Proposal belongs to another entry')
        integer(target['revision'], 'proposal revision')
        content = bounded_text(frozen['content'], 'frozen draft', 2_000_000)
        if not isinstance(json.loads(content), dict):
            raise ValueError('Invalid frozen draft')
        prompt = bounded_text(frozen['prompt'], 'frozen prompt', 128_000)
        if not prompt or len(prompt.encode()) > 128_000:
            raise ValueError('Frozen Host prompt exceeds 128 KB')
        if not isinstance(data['status'], str) or data['status'] not in STATUSES or not isinstance(data['application'], str) or data['application'] not in {'reviewing', 'applying', 'applied', 'dismissed'}:
            raise ValueError('Invalid proposal observation or application state')
        bounded_text(data['sessionId'], 'session identity', 256)
        bounded_text(data['transcript'], 'Host transcript', 500_000)
        if not isinstance(data['decisions'], dict) or len(data['decisions']) > 200:
            raise ValueError('Invalid cell review decisions')
        for key, decision in data['decisions'].items():
            bounded_text(key, 'cell identity', 500)
            if decision not in ('pending', 'accepted', 'rejected'):
                raise ValueError('Invalid cell review decision')
        if len(json.dumps(data, ensure_ascii=False).encode()) > 3_000_000:
            raise ValueError('AI recovery exceeds 3 MB')
        return cls(data)


class ProposalConflict(Exception):
    pass


class AIProposalStore:
    def __init__(self, entries):
        self.entries = entries
        with closing(entries._connect()) as connection, connection:
            connection.execute('CREATE TABLE IF NOT EXISTS ai_proposal_workspace (entry_id TEXT PRIMARY KEY, version INTEGER NOT NULL, record TEXT NOT NULL)')
            connection.execute('CREATE TABLE IF NOT EXISTS ai_proposal_archive (entry_id TEXT NOT NULL, request_id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY (entry_id, request_id))')

    def _read(self, connection, identity):
        row = connection.execute('SELECT version, record FROM ai_proposal_workspace WHERE entry_id = ?', (identity,)).fetchone()
        if not row:
            return {'version': 0, 'record': None}
        record = json.loads(row['record'])
        ProposalRecovery.parse(record, identity)
        return {'version': row['version'], 'record': record}

    def read(self, identity):
        with closing(self.entries._connect()) as connection:
            self.entries._read(connection, identity)
            return self._read(connection, identity)

    def save(self, identity, body):
        data = fields(body, {'expectedVersion', 'record'})
        expected = integer(data['expectedVersion'], 'AI workspace version', minimum=0)
        record = ProposalRecovery.parse(data['record'], identity).value
        with closing(self.entries._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            self.entries._read(connection, identity)
            state = self._read(connection, identity)
            prior = state['record']
            # Idempotent response recovery after an interrupted write.
            if prior == record:
                return state
            if state['version'] != expected:
                raise ProposalConflict('AI recovery changed. Reload it before taking another action.')
            if prior:
                if prior['frozen']['requestId'] == record['frozen']['requestId']:
                    if prior['frozen'] != record['frozen'] or prior['sessionId'] and prior['sessionId'] != record['sessionId']:
                        raise ProposalConflict('A frozen request or established Host session cannot be replaced.')
                else:
                    if prior['status'] not in TERMINAL or prior['application'] not in ('applied', 'dismissed'):
                        raise ProposalConflict('Resolve or explicitly dismiss the original completed request before starting another.')
                    old_id = prior['frozen']['requestId']
                    connection.execute('INSERT OR REPLACE INTO ai_proposal_archive VALUES (?, ?, ?)', (identity, old_id, json.dumps(prior)))
                    if connection.execute('SELECT 1 FROM ai_proposal_archive WHERE entry_id = ? AND request_id = ?', (identity, record['frozen']['requestId'])).fetchone():
                        raise ProposalConflict('This request identity was already used. Recover its original session instead.')
            version = state['version'] + 1
            connection.execute('INSERT OR REPLACE INTO ai_proposal_workspace VALUES (?, ?, ?)', (identity, version, json.dumps(record)))
            return {'version': version, 'record': record}

    def archive(self, identity, request_id=None):
        with closing(self.entries._connect()) as connection:
            self.entries._read(connection, identity)
            if request_id is None:
                rows = connection.execute('SELECT request_id, record FROM ai_proposal_archive WHERE entry_id = ? ORDER BY rowid DESC LIMIT 50', (identity,))
                return {'requests': [{'requestId': row['request_id'], 'sessionId': json.loads(row['record'])['sessionId']} for row in rows]}
            row = connection.execute('SELECT record FROM ai_proposal_archive WHERE entry_id = ? AND request_id = ?', (identity, request_id)).fetchone()
            if not row:
                raise ValueError('Archived proposal was not found')
            return {'record': ProposalRecovery.parse(json.loads(row['record']), identity).value}
