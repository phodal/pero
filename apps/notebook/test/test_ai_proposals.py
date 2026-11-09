"""Recovery tests use real SQLite; no model invocation is claimed."""
import copy
import json
from contextlib import closing
from hashlib import sha256
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from ai_proposals import AIProposalStore, ProposalConflict
from ai_routes import ai_route
from document import NotebookDocument
from store import EntryStore


class AIProposalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.entries = EntryStore(self.temp.name)
        self.entry = self.entries.create(NotebookDocument.parse({'schemaVersion': 1, 'title': 'AI test', 'content': {'type': 'doc', 'content': [{'type': 'paragraph'}]}}))
        self.store = AIProposalStore(self.entries)
        self.record = {'frozen': {'requestId': 'request-1', 'agentId': 'host-agent', 'target': {'entryId': self.entry.identity, 'revision': 1}, 'content': '{"type":"doc","content":[]}', 'prompt': 'Frozen bounded input'}, 'sessionId': '', 'status': 'starting', 'transcript': '', 'decisions': {}, 'application': 'reviewing'}

    def save(self, version, record):
        return self.store.save(self.entry.identity, {'expectedVersion': version, 'record': record})

    def test_recovery_is_durable_idempotent_and_bound_to_frozen_request(self):
        saved = self.save(0, self.record)
        self.assertEqual(saved, AIProposalStore(self.entries).read(self.entry.identity))
        self.assertEqual(self.save(0, self.record), saved)
        changed = copy.deepcopy(self.record); changed['frozen']['prompt'] = 'changed'
        with self.assertRaises(ProposalConflict): self.save(1, changed)
        changed = copy.deepcopy(self.record); changed['sessionId'] = 'actual-session'; changed['status'] = 'running'
        self.save(1, changed)
        changed['sessionId'] = 'different-session'
        with self.assertRaises(ProposalConflict): self.save(2, changed)
        changed['sessionId'] = 'actual-session'; changed['status'] = 'completed'; changed['transcript'] = '{"cells":[]}'
        with self.assertRaises(ProposalConflict): self.save(1, changed)
        self.save(2, changed)
        changed['decisions'] = {'["b","r","c"]': 'rejected'}
        self.save(3, changed)
        self.assertEqual(AIProposalStore(self.entries).read(self.entry.identity)['record']['decisions'], changed['decisions'])

    def test_new_request_requires_resolved_prior_review_and_old_identity_cannot_replay(self):
        self.save(0, self.record)
        next_record = copy.deepcopy(self.record); next_record['frozen']['requestId'] = 'request-2'
        with self.assertRaises(ProposalConflict): self.save(1, next_record)
        completed = copy.deepcopy(self.record); completed['status'] = 'completed'; completed['application'] = 'dismissed'
        self.save(1, completed); self.save(2, next_record)
        next_record['status'] = 'cancelled'; next_record['application'] = 'dismissed'; self.save(3, next_record)
        with self.assertRaises(ProposalConflict): self.save(4, self.record)
        self.assertEqual(self.store.archive(self.entry.identity)['requests'][0]['requestId'], 'request-1')
        self.assertEqual(self.store.archive(self.entry.identity, 'request-1')['record']['application'], 'dismissed')

    def typed_record(self, text):
        record = copy.deepcopy(self.record)
        raw = text.encode('utf-8')
        source = {'id': 'source', 'name': 'source.txt', 'kind': 'file', 'sha256': sha256(raw).hexdigest(), 'bytes': len(raw), 'text': text}
        table = {'id': 'table', 'name': 'Inputs', 'schema': {'id': 'schema', 'revision': 1, 'columns': [{'id': 'value', 'name': 'Value', 'type': 'text', 'required': False, 'options': [], 'units': []}]}, 'rows': [{'id': 'row', 'cells': {}}]}
        record['frozen'].update({'mode': 'cells', 'goal': 'Extract selected source', 'emptyOnly': True, 'table': {'blockId': 'block', 'kind': 'inputTable', 'table': table}, 'sources': [source]})
        return record

    def test_selected_source_byte_count_and_digest_are_verified_before_storage(self):
        original = self.typed_record('original')
        for patch in ({'text': 'tampered'}, {'bytes': 9}, {'bytes': 7}, {'sha256': 'f' * 64}):
            with self.subTest(patch=patch):
                changed = copy.deepcopy(original)
                changed['frozen']['sources'][0].update(patch)
                with self.assertRaisesRegex(ValueError, 'UTF-8 byte count or SHA-256'):
                    self.save(0, changed)
                self.assertEqual(self.store.read(self.entry.identity), {'version': 0, 'record': None})
        saved = self.save(0, original)
        self.assertEqual(AIProposalStore(self.entries).read(self.entry.identity), saved)

    def test_bom_unicode_and_line_endings_retain_original_utf8_bytes(self):
        record = self.typed_record('\ufeff质量: 2.5 mg\r\n')
        source = record['frozen']['sources'][0]
        self.assertEqual(source['bytes'], len(source['text'].encode('utf-8')))
        for patch in ({'text': source['text'].lstrip('\ufeff')}, {'bytes': len(source['text'])}, {'text': source['text'].replace('\r\n', '\n')}):
            changed = copy.deepcopy(record); changed['frozen']['sources'][0].update(patch)
            with self.assertRaisesRegex(ValueError, 'UTF-8 byte count or SHA-256'):
                self.save(0, changed)
        self.save(0, record)
        self.assertEqual(AIProposalStore(self.entries).read(self.entry.identity)['record']['frozen']['sources'][0], source)

    def test_mismatched_stored_and_archived_provenance_is_rejected_without_overwrite(self):
        record = self.typed_record('original')
        self.save(0, record)
        corrupted = copy.deepcopy(record); corrupted['frozen']['sources'][0]['text'] = 'tampered'
        raw = json.dumps(corrupted)
        with closing(self.entries._connect()) as connection, connection:
            connection.execute('UPDATE ai_proposal_workspace SET record = ? WHERE entry_id = ?', (raw, self.entry.identity))
            connection.execute('INSERT INTO ai_proposal_archive VALUES (?, ?, ?)', (self.entry.identity, 'archived-corrupt', raw))
        with self.assertRaisesRegex(ValueError, 'UTF-8 byte count or SHA-256'):
            AIProposalStore(self.entries).read(self.entry.identity)
        with self.assertRaisesRegex(ValueError, 'UTF-8 byte count or SHA-256'):
            self.save(1, record)
        with self.assertRaisesRegex(ValueError, 'UTF-8 byte count or SHA-256'):
            self.store.archive(self.entry.identity, 'archived-corrupt')
        with closing(self.entries._connect()) as connection:
            self.assertEqual(connection.execute('SELECT record FROM ai_proposal_workspace WHERE entry_id = ?', (self.entry.identity,)).fetchone()['record'], raw)

    def test_invalid_or_cross_entry_record_is_rejected_and_route_does_not_read_unrelated_body(self):
        broken = copy.deepcopy(self.record); broken['frozen']['target']['entryId'] = 'b' * 32
        with self.assertRaises(ValueError): self.save(0, broken)
        broken = copy.deepcopy(self.record); broken['decisions'] = {'cell': 'verified'}
        with self.assertRaises(ValueError): self.save(0, broken)
        broken = copy.deepcopy(self.record); broken['frozen']['prompt'] = 'é' * 100_000
        with self.assertRaises(ValueError): self.save(0, broken)
        self.assertIsNone(ai_route(self.store, 'GET', '/other', lambda: self.fail('read unrelated body')))
        self.assertEqual(ai_route(self.store, 'GET', f'/api/entries/{self.entry.identity}/ai-workspace', None), (200, {'version': 0, 'record': None}))


if __name__ == '__main__': unittest.main()
