import base64
from dataclasses import replace
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from catalog import Catalog, ImportFile
from canvas import projection, archive, status, CanvasOperation
from datasets import DatasetEdit


class CanvasTests(unittest.TestCase):
    def test_real_projection_and_atomic_replayed_archive_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            catalog = Catalog(directory)
            asset = catalog.import_file(ImportFile.parse({'name': 'actual.csv', 'kind': 'dataset', 'content': base64.b64encode(b'x,y\n1,2\n').decode()}))
            dataset = catalog.datasets[0]
            inputs = {'datasetId': dataset.id}
            before = (Path(directory) / 'catalog.json').read_bytes()
            view = projection(catalog, inputs)
            self.assertEqual(view['rows'][0], [asset.id, asset.sha256, 'present'])
            self.assertEqual((Path(directory) / 'catalog.json').read_bytes(), before)
            request = {'operationId': 'op-1', 'inputs': inputs, 'params': {'archived': True}}
            receipt = archive(catalog, request)
            self.assertTrue(catalog.dataset(dataset.id).archived)
            self.assertEqual(status(catalog, request), {'state': 'completed', 'result': receipt})
            self.assertEqual(status(catalog, {**request, 'operationId': 'not-started'}), {'state': 'not-started'})
            reopened = Catalog(directory)
            self.assertEqual(archive(reopened, request), receipt)
            # An old retry returns its original receipt, never overwrites a later user decision.
            reopened.edit_dataset(DatasetEdit(dataset.id, dataset.name, dataset.projectRef, False))
            self.assertEqual(archive(reopened, request), receipt)
            self.assertFalse(reopened.dataset(dataset.id).archived)
            self.assertEqual(Catalog(directory).canvas_receipts['op-1'], receipt)
            for call in (archive, status):
                with self.assertRaisesRegex(ValueError, 'different inputs'):
                    call(reopened, {**request, 'params': {'archived': False}})
            with self.assertRaises(ValueError):
                status(reopened, {'operationId': 'op-1', 'inputs': inputs})
            for bad in ({'datasetId': '../private'}, {'datasetId': dataset.id, 'path': '/api/state'}):
                with self.assertRaises(ValueError):
                    projection(reopened, bad)


    def test_receipts_remain_bounded_for_large_dataset_histories(self):
        with tempfile.TemporaryDirectory() as directory:
            catalog = Catalog(directory)
            original = catalog.import_file(ImportFile.parse({'name': 'actual.csv', 'kind': 'dataset', 'content': base64.b64encode(b'x\n1\n').decode()}))
            assets = [replace(original, id=f'{index:032x}') for index in range(2000)]
            dataset = replace(catalog.datasets[0], versions=tuple(asset.id for asset in assets))
            catalog._save(assets, [dataset], [])
            reopened = Catalog(directory)
            request = dict(operationId='many-versions', inputs={'datasetId': dataset.id}, params={'archived': True})
            receipt = archive(reopened, request)
            self.assertEqual(receipt['dataset']['versionCount'], 2000)
            self.assertEqual(receipt['dataset']['lastVersion'], assets[-1].id)
            self.assertLess(len(json.dumps(status(Catalog(directory), request)).encode()), 4096)
            self.assertEqual(len(Catalog(directory).dataset(dataset.id).versions), 2000)

    def test_metadata_quick_edit_uses_observed_owner_state_and_atomic_receipts(self):
        from canvas import update
        with tempfile.TemporaryDirectory() as directory:
            catalog = Catalog(directory)
            asset = catalog.import_file(ImportFile.parse({'name': 'actual.csv', 'kind': 'dataset', 'content': base64.b64encode(b'x\n1\n').decode()}))
            dataset = catalog.datasets[0]
            action = next(action for action in projection(catalog, {'datasetId': dataset.id})['actions'] if action['name'] == 'canvas-update')
            request = dict(operationId='rename-1', inputs={'datasetId': dataset.id}, params={**action['params'], 'name': '测量 A', 'projectRef': 'Local project label'})
            original_versions = dataset.versions
            before = (Path(directory) / 'catalog.json').read_bytes()
            # Validation/stale refusal leaves owner data and receipts untouched.
            for params in ({**request['params'], 'name': ' '}, {**request['params'], 'name': 'x' * 201},
                           {**request['params'], 'approved': True}):
                with self.assertRaises(ValueError):
                    update(catalog, {**request, 'params': params})
                self.assertEqual((Path(directory) / 'catalog.json').read_bytes(), before)
            receipt = update(catalog, request)
            changed = catalog.dataset(dataset.id)
            self.assertEqual((changed.name, changed.projectRef, changed.archived, changed.versions), ('测量 A', 'Local project label', False, original_versions))
            self.assertEqual(Catalog(directory).dataset(dataset.id), changed)
            self.assertEqual(status(Catalog(directory), request), {'state': 'completed', 'result': receipt})
            catalog.edit_dataset(DatasetEdit(dataset.id, 'Later user title', '', True))
            self.assertEqual(update(catalog, request), receipt)
            self.assertEqual(catalog.dataset(dataset.id).name, 'Later user title')
            stale = update(catalog, {**request, 'operationId': 'rename-2'})
            self.assertEqual(stale['outcome'], 'not-applied')
            self.assertIn('metadata changed', stale['reason'])
            self.assertEqual(catalog.dataset(dataset.id).name, 'Later user title')
            self.assertEqual(status(Catalog(directory), {**request, 'operationId': 'rename-2'}), {'state': 'completed', 'result': stale})
            self.assertEqual(update(catalog, {**request, 'operationId': 'rename-2'}), stale)
            with self.assertRaises(ValueError):
                archive(catalog, request)
            with self.assertRaisesRegex(ValueError, 'different inputs'):
                status(catalog, {**request, 'params': {**request['params'], 'name': 'different'}})
            self.assertEqual(catalog.availability(asset), 'present')
