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
from semantic_domain import QueryDefinition, Recalculation
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

    def test_independent_arithmetic(self):
        for operation, values, count, actual, scalar, expected in [
            ('count', (), 3, 3, True, 'matched'), ('count', (), 3, 2, True, 'mismatch'),
            ('mean', ('1', '3', None, ''), 4, 2, True, 'matched'),
            ('sum', ('1', '3'), 2, 4, True, 'matched'),
            ('sum', (None, ''), 2, None, True, 'matched'),
            ('mean', ('1', '3'), 2, 2, False, 'mismatch'),
            ('mean', ('1', '3'), 2, True, True, 'mismatch')]:
            with self.subTest(operation=operation, values=values, actual=actual):
                self.assertEqual(Recalculation(operation, 'sample', 'n', 'value').compare(values, count, actual, scalar).status, expected)

    def test_fixed_queries_recompute_restart_and_failure_receipts(self):
        with tempfile.TemporaryDirectory() as home:
            catalog = Catalog(home)
            asset = catalog.import_file(ImportFile.parse(dict(name='values.csv', kind='dataset',
                content=base64.b64encode(b'n,label\n1,A\n3,B\n,C\n').decode(), source='Synthetic fixture')))
            queries = SemanticQueries(catalog)
            source = dict(datasetId=catalog.datasets[0].id, assetId=asset.id, table='sample', columns={'n': 'number', 'label': 'text'})
            snapshot = queries.snapshot([source])
            with self.assertRaises(ValueError):
                queries.snapshot([source | dict(columns={'label': 'number'})])
            self.assertEqual(list(queries.root.glob('.*.sqlite')), [])
            saved = queries.definition(definition())
            intent = dict(snapshotId=snapshot['id'], definitionId=saved['id'], parameters={}, question='Mean n?')
            result = queries.execute(intent)
            self.assertEqual(result['receipt']['rows'], [{'value': 2.0}])
            self.assertEqual(queries.check(result['id'])['status'], 'matched')
            restart = SemanticQueries(Catalog(home))
            self.assertEqual(restart.evidence(result['id']), {k: v for k, v in result.items() if k != 'receiptId'})
            for sql in ['UPDATE sample SET n=7', 'DROP TABLE sample', "ATTACH DATABASE ':memory:' AS other",
                        'SELECT load_extension(\'x\')', 'SELECT 1; SELECT 2', 'SELECT * FROM sqlite_master', 'SELECT 1 AS n, 2 AS n']:
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
            # The same projection owner handles two fixed tables and retains full truncated results.
            extra = catalog.import_file(ImportFile.parse(dict(name='many.csv', kind='dataset',
                content=base64.b64encode(('n\n' + '\n'.join(map(str, range(101))) + '\n').encode()).decode(), source='Synthetic fixture')))
            extra_dataset = next(d.id for d in catalog.datasets if extra.id in d.versions)
            multiple = queries.snapshot([source, dict(datasetId=extra_dataset, assetId=extra.id,
                table='extra', columns={'n': 'number'})])
            listing = queries.definition(definition('SELECT n FROM extra ORDER BY n') | dict(check=None))
            listed = queries.execute(intent | dict(snapshotId=multiple['id'], definitionId=listing['id']))
            self.assertEqual(listed['receipt']['rowCount'], 101)
            self.assertTrue(listed['receipt']['truncated'])
            self.assertEqual(len(listed['receipt']['rows']), 100)
            self.assertEqual(len(queries.read('rows', listed['receipt']['resultId'])), 101)
            (queries.root / (snapshot['databaseHash'] + '.sqlite')).unlink()
            unavailable = queries.execute(intent)
            self.assertEqual(unavailable['receipt']['status'], 'failed')
            self.assertIsNone(unavailable['receipt']['rowCount'])
            self.assertEqual(restart.evidence(result['id'])['receipt']['rows'], [{'value': 2.0}])
            rows = queries.root / (result['receipt']['resultId'] + '.rows.json')
            rows.write_text('[{"value":99}]')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                restart.evidence(result['id'])
