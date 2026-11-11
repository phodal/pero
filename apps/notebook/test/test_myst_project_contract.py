"""Shared project wire corpus, tested through the real Notebook revision owner."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import scientific_block
from document import NotebookDocument
from store import EntryStore
from myst_project import MystProjectSnapshot
FIXTURE = Path(__file__).resolve().parents[3] / 'packages/notebook/test/fixtures/myst-project-contract.json'


class MystProjectContractTests(unittest.TestCase):
    def test_shared_project_corpus_persists_exact_snapshot(self):
        fixture = json.loads(FIXTURE.read_text())
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            for case in fixture['cases']:
                with self.subTest(case=case['name']):
                    attrs = {'blockId': 'project-contract', 'schemaVersion': 1, 'snapshot': json.dumps(case['snapshot'])}
                    wire = {**fixture['document'], 'content': {'type': 'doc', 'content': [{'type': 'mystProject', 'attrs': attrs}]}}
                    if not case['accepted']:
                        with self.assertRaises(ValueError):
                            NotebookDocument.parse(wire)
                        continue
                    created = store.create(NotebookDocument.parse(wire))
                    self.assertEqual(EntryStore(directory).read(created.identity).document.wire(), wire)

    def test_shared_block_contract(self):
        fixture = json.loads(FIXTURE.read_text())
        for case in fixture['blockCases']:
            with self.subTest(case=case['name']), self.assertRaises(ValueError):
                MystProjectSnapshot.parse({'blockId': 'contract', 'schemaVersion': 1,
                                           'snapshot': json.dumps(fixture['cases'][0]['snapshot']), **case['patch']})

    def test_resource_edit_uses_existing_revision_owner(self):
        fixture = json.loads(FIXTURE.read_text())
        snapshot = fixture['cases'][0]['snapshot']
        wire = {**fixture['document'], 'content': {'type': 'doc', 'content': [{'type': 'mystProject', 'attrs': {
            'blockId': 'project-revisions', 'schemaVersion': 1, 'snapshot': json.dumps(snapshot),
        }}]}}
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            created = store.create(NotebookDocument.parse(wire))
            def edit_bibliography(current):
                changed = current.wire()
                attrs = changed['content']['content'][0]['attrs']
                project = json.loads(attrs['snapshot'])
                project['files'][2]['text'] = '@article{A, title={Changed 原样}}\r\n'
                attrs['snapshot'] = json.dumps(project)
                return NotebookDocument.parse(changed)
            saved = store.commit(created.identity, 1, edit_bibliography)
            self.assertEqual(saved.revision, 2)
            reopened = EntryStore(directory)
            self.assertEqual(reopened.read(created.identity, 1).document.wire(), wire)
            latest = reopened.read(created.identity).document.wire()
            resources = json.loads(latest['content']['content'][0]['attrs']['snapshot'])['files']
            self.assertEqual(resources[2]['text'], '@article{A, title={Changed 原样}}\r\n')
            self.assertEqual(resources[:2], snapshot['files'][:2])
            self.assertEqual(len(reopened.history(created.identity)), 2)

    def test_utf8_and_count_limits(self):
        limits = json.loads(FIXTURE.read_text())['limits']
        def parse(files):
            return MystProjectSnapshot.from_wire({'format': 'pero-myst-project', 'version': 1, 'entry': files[0]['path'], 'files': files})
        text = '🧪' * (limits['resourceBytes'] // 4)
        files = [{'path': f'{i}.md', 'text': text} for i in range(4)]
        self.assertEqual(len(parse(files).files), 4)
        for invalid in [files + [{'path': 'extra.md', 'text': 'a'}], [{'path': 'a.md', 'text': text + 'a'}]]:
            with self.assertRaises(ValueError):
                parse(invalid)
        many = [{'path': f'{i}.md', 'text': ''} for i in range(limits['files'])]
        self.assertEqual(len(parse(many).files), limits['files'])
        with self.assertRaises(ValueError):
            parse(many + [{'path': 'extra.md', 'text': ''}])
        path = 'a' * (limits['pathBytes'] - 3) + '.md'
        parse([{'path': path, 'text': ''}])
        with self.assertRaises(ValueError):
            parse([{'path': 'a' + path, 'text': ''}])
        escaped = {'format': 'pero-myst-project', 'version': 1, 'entry': '0.md', 'files': [{**file, 'text': '\0' * limits['resourceBytes']} for file in files]}
        snapshot = json.dumps(escaped)
        self.assertLess(len(snapshot.encode()), limits['wireBytes'])
        with self.assertRaisesRegex(ValueError, 'persisted contribution'):
            MystProjectSnapshot.parse({'blockId': 'budget', 'schemaVersion': 1, 'snapshot': snapshot})
        with self.assertRaises(ValueError):
            MystProjectSnapshot.parse({'blockId': 'budget', 'schemaVersion': 1, 'snapshot': ' ' * (limits['wireBytes'] + 1)})

    def test_persisted_contribution_boundary_survives_real_entry_store(self):
        fixture = json.loads(FIXTURE.read_text())
        recipe, limit = fixture['persistedBoundary'], fixture['limits']['persistedBytes']
        project = {'format': 'pero-myst-project', 'version': 1, 'entry': 'a.md', 'files': [
            {'path': 'a.md', 'text': recipe['escapedUnit'] * recipe['repeat']}, {'path': 'b.md', 'text': ''}]}
        def serialize():
            return json.dumps(project, ensure_ascii=False, indent=2) + '\n'
        def size(raw):
            return len(json.dumps(raw, ensure_ascii=False).encode())
        project['files'][1]['text'] = recipe['paddingUnit'] * (limit - size(serialize()))
        raw = serialize()
        self.assertEqual(size(raw), limit)
        attrs = {'blockId': 'persisted-boundary', 'schemaVersion': 1, 'snapshot': raw}
        wire = {**fixture['document'], 'content': {'type': 'doc', 'content': [
            {'type': 'mystProject', 'attrs': attrs},
            {'type': 'paragraph', 'attrs': {'blockId': 'ordinary'}, 'content': [{'type': 'text', 'text': 'Ordinary notebook prose.'}]}]}}
        with tempfile.TemporaryDirectory() as directory:
            created = EntryStore(directory).create(NotebookDocument.parse(wire))
            self.assertEqual(EntryStore(directory).read(created.identity).document.wire(), wire)
        with self.assertRaisesRegex(ValueError, 'persisted contribution'):
            MystProjectSnapshot.parse({**attrs, 'snapshot': raw + ' '})
        project['files'][1]['text'] += 'a'
        with self.assertRaisesRegex(ValueError, 'persisted contribution'):
            MystProjectSnapshot.from_wire(project)
        small = json.dumps(fixture['cases'][0]['snapshot'], ensure_ascii=False, indent=2) + '\n'
        padded = small + ' ' * (limit - size(small))
        MystProjectSnapshot.parse({**attrs, 'snapshot': padded})
        with self.assertRaisesRegex(ValueError, 'persisted contribution'):
            MystProjectSnapshot.parse({**attrs, 'snapshot': padded + ' '})
