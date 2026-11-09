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
