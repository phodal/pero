"""Saved Data query behavior, independent evidence and the authenticated HTTP boundary."""
import base64
from hashlib import sha256
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from catalog import Catalog, ImportFile
from semantic_domain import QueryDefinition
from semantic_queries import SemanticQueries, encoded


def definition(sql='SELECT AVG(n) AS value FROM sample'):
    return dict(name='Mean measurement', sql=sql, parameters={}, unit='cm', grain='sample', denominator='non-null n',
                joins='none', missing='exclude null n', seedPolicy='not applicable', reviewer='local reviewer', reviewed=True,
                check=dict(operation='mean', table='sample', column='n', resultColumn='value'))


class QueryTests(unittest.TestCase):
    def test_definition_review_and_binding(self):
        for patch, params, accepted in [({}, {}, True), ({'reviewed': False}, {}, False),
                ({'denominator': ''}, {}, False), ({'sql': 'SELECT :n', 'parameters': {'n': 'number'}}, {'n': True}, False),
                ({'sql': 'SELECT :n', 'parameters': {'n': 'number'}}, {'n': float('nan')}, False),
                ({'sql': 'SELECT :n', 'parameters': {'n': 'number'}}, {'n': 1.5}, True),
                ({'sql': 'SELECT :n'}, {}, False)]:
            with self.subTest(patch=patch, params=params):
                if accepted:
                    QueryDefinition.parse(definition() | patch).bind(params)
                else:
                    with self.assertRaises(ValueError):
                        QueryDefinition.parse(definition() | patch).bind(params)

    def test_fixed_queries_recompute_restart_and_failure_receipts(self):
        with tempfile.TemporaryDirectory() as home:
            catalog = Catalog(home)
            asset = catalog.import_file(ImportFile.parse(dict(name='values.csv', kind='dataset',
                content=base64.b64encode(b'n,label\n1,A\n3,B\n,C\n').decode(), source='Synthetic fixture')))
            queries = SemanticQueries(catalog)
            source = dict(datasetId=catalog.datasets[0].id, assetId=asset.id, table='sample', columns={'n': 'number', 'label': 'text'})
            snapshot = queries.snapshot([source])
            saved = queries.definition(definition())
            intent = dict(snapshotId=snapshot['id'], definitionId=saved['id'], parameters={}, question='Mean n?')
            result = queries.execute(intent)
            self.assertEqual(result['receipt']['rows'], [{'value': 2.0}])
            self.assertEqual(queries.check(result['id'])['status'], 'matched')
            restart = SemanticQueries(Catalog(home))
            self.assertEqual(restart.evidence(result['id']), {k: v for k, v in result.items() if k != 'receiptId'})
            for sql in ['UPDATE sample SET n=7', 'DROP TABLE sample', "ATTACH DATABASE ':memory:' AS other",
                        'SELECT load_extension(\'x\')', 'SELECT 1; SELECT 2', 'SELECT * FROM sqlite_master']:
                with self.subTest(sql=sql):
                    bad = queries.definition(definition(sql))
                    refused = queries.execute(intent | dict(definitionId=bad['id']))
                    self.assertEqual(refused['receipt']['status'], 'failed')
            wrong = queries.definition(definition('SELECT 7 AS value FROM sample LIMIT 1'))
            wrong_result = queries.execute(intent | dict(definitionId=wrong['id']))
            self.assertEqual(queries.check(wrong_result['id'])['status'], 'mismatch')
            pending = queries.save('intent', result['intent'] | dict(nonce='interrupted fixture'))
            self.assertEqual(restart.evidence(pending)['receipt']['status'], 'interrupted')
            # New reviewed definition never alters historical definition or results.
            queries.definition(definition('SELECT AVG(n)*10 AS value FROM sample') | dict(unit='mm'))
            self.assertEqual(restart.evidence(result['id'])['definition']['unit'], 'cm')
            export = queries.analysis.exports / (snapshot['sources'][0]['exportId'] + '.export.json')
            export.unlink()
            with self.assertRaisesRegex(ValueError, 'unavailable'):
                restart.check(result['id'])
            self.assertEqual(restart.evidence(result['id'])['receipt']['rows'], [{'value': 2.0}])
            rows = queries.root / (result['receipt']['resultId'] + '.rows.json')
            rows.write_text('[{"value":99}]')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                restart.evidence(result['id'])
