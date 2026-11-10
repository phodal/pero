import copy
import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'backend'))
from catalog import CatalogStore
from sample_intake import validate_sample_intake_attributes


class SampleIntakeTest(unittest.TestCase):
    def test_registered_record_snapshot_survives_and_rejects_forged_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            catalog = CatalogStore(pathlib.Path(directory) / 'catalog.db')
            table = dict(id='table', name='Samples', schema=dict(id='schema', revision=1, columns=[dict(id='barcode', name='Barcode', type='text', required=True, options=[], units=[])]), rows=[dict(id='row', cells=dict(barcode='00123'))])
            catalog.register(dict(submissionId='submission', table=table))
            snapshot = catalog.lookup(dict(schemaId='', text='00123', limit=200))
            source = dict(mode='barcode', input='00123', fileName='', row=1, well='', field='barcode')
            data = dict(name='Batch', mode='barcode', field='barcode', schemaId='', input='00123', fileName='', plateSize=dict(rows=8, columns=12), bindings=[dict(source=source, snapshot=snapshot)])
            validate_sample_intake_attributes(dict(intake=data))
            for mutation in ('input', 'duplicates', 'well', 'version', 'size'):
                invalid = copy.deepcopy(data)
                if mutation == 'input': invalid['bindings'][0]['source']['input'] = 'different'
                if mutation == 'duplicates': invalid['bindings'] *= 2
                if mutation == 'well': invalid['bindings'][0]['source'].update(mode='plate', well='I1')
                if mutation == 'version': invalid['bindings'][0]['snapshot']['records'][0]['version'] = 0
                if mutation == 'size': invalid['plateSize']['rows'] = True
                with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                    validate_sample_intake_attributes(dict(intake=invalid))
            table['rows'][0]['cells']['barcode'] = 'new'
            catalog.register(dict(submissionId='submission2', table=table))
            self.assertEqual(data['bindings'][0]['snapshot']['records'][0]['version'], 1)
            self.assertEqual(data['bindings'][0]['snapshot']['records'][0]['values']['barcode']['value'], '00123')
