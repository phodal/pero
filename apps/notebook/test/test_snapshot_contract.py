"""The portable evidence snapshots accepted across TypeScript and Python."""

import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument

FIXTURE = Path(__file__).resolve().parents[3] / 'packages/notebook/test/fixtures/snapshot-contract.json'


class SnapshotContractTests(unittest.TestCase):
    def test_portable_snapshot_shapes(self):
        fixture = json.loads(FIXTURE.read_text())
        for case in fixture['cases']:
            with self.subTest(owner=case['owner'], case=case['name']):
                snapshot = {**fixture['bases'][case['owner']], **case['changes']}
                if case['owner'] == 'paper':
                    identity = snapshot['reportId']
                    source = dict(app='paper-agent', kind='report-citation', id=identity, version=identity,
                                  locator=f"pero-app-location://paper-agent/main/report/{identity}/citation/{snapshot['citationIndex']}")
                    kind = 'evidence'
                else:
                    identity = fixture['controlExperimentId']
                    source = dict(app='control-lab', kind='verification-report', id=identity,
                                  version=snapshot['reportId'],
                                  locator=f"pero-app-location://control-lab/main/experiment/{identity}/trial/{snapshot['trialId']}")
                    kind = 'experiment'
                value = dict(schemaVersion=1, title='Snapshot contract', content=dict(type='doc', content=[
                    dict(type=kind, attrs=dict(blockId='source', label='Source', source=source, snapshot=snapshot)),
                ]))
                if case['accepted']:
                    self.assertEqual(NotebookDocument.parse(value).wire(), value)
                else:
                    with self.assertRaises(ValueError):
                        NotebookDocument.parse(value)
