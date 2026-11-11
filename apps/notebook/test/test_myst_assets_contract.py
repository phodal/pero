"""Same binary corpus across SDK and real Notebook persistence."""
import base64
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import scientific_block
from myst_assets import MystImageData, MAX_ASSET_BYTES
from myst_project import MystProjectSnapshot
from document import NotebookDocument
from store import EntryStore
FIXTURES = Path(__file__).resolve().parents[3] / 'packages/notebook/test/fixtures'


class MystAssetsContractTests(unittest.TestCase):
    def test_shared_binary_corpus(self):
        for case in json.loads((FIXTURES / 'myst-assets-contract.json').read_text())['cases']:
            with self.subTest(case=case['name']):
                if not case['accepted']:
                    with self.assertRaises(ValueError):
                        MystImageData.parse(case['mediaType'], case['base64'])
                    continue
                asset = MystImageData.parse(case['mediaType'], case['base64'])
                self.assertEqual(asset.base64, case['base64'])
                self.assertEqual(asset.renderable, case['renderable'])
                self.assertEqual(asset.byte_length, len(base64.b64decode(case['base64'])))
                if asset.renderable:
                    self.assertEqual((asset.width, asset.height), (2, 3))
        self.assertEqual(MystImageData.parse('application/octet-stream', base64.b64encode(bytes(MAX_ASSET_BYTES)).decode()).byte_length, MAX_ASSET_BYTES)
        with self.assertRaises(ValueError):
            MystImageData.parse('application/octet-stream', base64.b64encode(bytes(MAX_ASSET_BYTES + 1)).decode())

    def test_assets_survive_real_revisions_and_reopen(self):
        cases = json.loads((FIXTURES / 'myst-assets-contract.json').read_text())['cases']
        assets = [{'path': f'images/{i}.bin', 'mediaType': item['mediaType'], 'base64': item['base64']} for i, item in enumerate(cases) if item['accepted']]
        snapshot = {'format': 'pero-myst-project', 'version': 2, 'entry': 'a.md', 'files': [{'path': 'a.md', 'text': 'Exact\r\n🧪'}], 'assets': assets}
        self.assertEqual(MystProjectSnapshot.from_wire(snapshot).wire(), snapshot)
        document = json.loads((FIXTURES / 'myst-project-contract.json').read_text())['document']
        wire = {**document, 'content': {'type': 'doc', 'content': [{'type': 'mystProject', 'attrs': {'blockId': 'asset-project', 'schemaVersion': 1, 'snapshot': json.dumps(snapshot)}}]}}
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            created = store.create(NotebookDocument.parse(wire))
            def edit(current):
                changed = current.wire()
                attrs = changed['content']['content'][0]['attrs']
                project = json.loads(attrs['snapshot'])
                project['files'][0]['text'] = 'Revised'
                attrs['snapshot'] = json.dumps(project)
                return NotebookDocument.parse(changed)
            saved = store.commit(created.identity, 1, edit)
            self.assertEqual(saved.revision, 2)
            reopened = EntryStore(directory)
            self.assertEqual(reopened.read(created.identity, 1).document.wire(), wire)
            latest = reopened.read(created.identity).document.wire()
            self.assertEqual(json.loads(latest['content']['content'][0]['attrs']['snapshot'])['assets'], assets)
        for invalid in [{**snapshot, 'version': 1}, {key: value for key, value in snapshot.items() if key != 'assets'}, {**snapshot, 'assets': [assets[0], assets[0]]}, {**snapshot, 'assets': [{**assets[0], 'path': 'a.md'}]}, {**snapshot, 'assets': [{**assets[0], 'path': '../a.png'}]}, {**snapshot, 'assets': [{**assets[0], 'path': f'{i}.png'} for i in range(32)]}]:
            with self.assertRaises(ValueError):
                MystProjectSnapshot.from_wire(invalid)
