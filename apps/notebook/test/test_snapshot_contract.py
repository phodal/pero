"""The portable evidence snapshots accepted across TypeScript and Python."""

import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument

FIXTURE = Path(__file__).resolve().parents[3] / 'packages/notebook/test/fixtures/snapshot-contract.json'


class SnapshotContractTests(unittest.TestCase):
    def test_fisher_evidence_and_finding_round_trip_with_exact_reference(self):
        receipt = json.loads(FIXTURE.with_name('fisher-evidence-receipt.json').read_text())
        snapshot = receipt['snapshot']
        digest = receipt['id']
        identity = snapshot['itemId']
        source = dict(app='paper-agent', kind='fisher-attempt', id=identity, version=digest,
                      locator=f"pero-app-location://paper-agent/main/fisher/{identity}/attempt/{snapshot['attemptId']}/receipt/{digest}")
        finding = dict(type='finding', attrs=dict(blockId='finding', claim='Exact numeric result matched.',
                                                  limitations='Paper not assessed.', evidenceIds=['source']))
        def document(snap, reference):
            evidence = dict(type='evidence', attrs=dict(blockId='source', label='Fisher', source=reference, snapshot=snap))
            return dict(schemaVersion=1, title='Fisher reproduction', content=dict(type='doc', content=[evidence, finding]))
        original = document(snapshot, source)
        self.assertEqual(NotebookDocument.parse(original).wire(), original)
        for changes in ({'exactNumerator': 5}, {'page': 3}, {'paperVerdict': 'PASS'}, {'exactDenominator': 2**53}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                NotebookDocument.parse(document({**snapshot, **changes}, source))
        with self.assertRaises(ValueError):
            NotebookDocument.parse(document(snapshot, {**source, 'locator': source['locator'] + '?latest=1'}))

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
