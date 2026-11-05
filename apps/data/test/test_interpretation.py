"""Explicit Data interpretations and issue scopes, through immutable catalog views."""
import base64
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from analysis import Analysis
from catalog import Catalog, ImportFile
from datasets import PreviewRequest, SaveView, ViewSpec
from inspection import Inspection


class InterpretationTests(unittest.TestCase):
    def page(self, content, spec=None, name='records.csv', offset=0, limit=50):
        inspection = Inspection.parse(content, name, name.rsplit('.', 1)[-1])
        request = PreviewRequest('ds-' + 'a' * 32, 'a' * 32, ViewSpec.parse(spec or {}), offset, limit)
        return inspection.page(request)

    def test_decimal_interpretation_preserves_originals_and_failures(self):
        values = ['000', '9007199254740993', '1.2300', '-0', '+.5', '1e3', '', 'no', 'NaN', 'Infinity', ' 2', '1,000', '1_000']
        content = ('id\tn\n' + '\n'.join(f'{index:03}\t{value}' for index, value in enumerate(values)) + '\n').encode()
        page = self.page(content, {'interpretations': {'n': 'number'}}, name='values.tsv')
        self.assertEqual([row['cells'][0]['text'] for row in page['rows']], [f'{i:03}' for i in range(len(values))])
        self.assertEqual([row['cells'][1]['text'] for row in page['rows']], values)
        self.assertEqual([row['cells'][1]['exact'] for row in page['rows'][:6]],
                         ['0', '9007199254740993', '1.2300', '-0', '0.5', '1E+3'])
        for row in page['rows'][6:]:
            self.assertEqual(row['cells'][1]['kind'], 'string')
            self.assertIn('conversionError', row['cells'][1])
        report = page['report']
        self.assertEqual((report['scope'], report['rowCount'], report['conversionFailures'], report['empty']), ('full', 13, 7, 1))
        profile = report['fields'][1]
        self.assertEqual(profile['kinds'], ('string',))
        self.assertEqual(profile['interpretation'], 'number')
        self.assertEqual(len(profile['conversionExamples']), 5)
        self.assertEqual(profile['conversionExamples'][0], dict(row=7, sourceLine=8, text=''))

    def test_numeric_filter_errors_are_distinct_from_real_zero_matches(self):
        content = b'id,n\n001,10\n002,2\n003,bad\n004,0\n'
        with self.assertRaisesRegex(ValueError, 'Apply a decimal interpretation'):
            self.page(content, dict(issue=dict(kind='conversion', field='n')))
        for operator in ('gte', 'lte'):
            with self.subTest(operator=operator), self.assertRaisesRegex(ValueError, 'explicitly interpret'):
                self.page(content, dict(filter=dict(field='n', operator=operator, value='10')))
        interpreted = dict(interpretations={'n': 'number'}, filter=dict(field='n', operator='gte', value='11'))
        page = self.page(content, interpreted)
        self.assertEqual((page['matched'], page['report']['conversionFailures']), (0, 1))
        page = self.page(content, interpreted | dict(filter=dict(field='n', operator='lte', value='0')))
        self.assertEqual([row['row'] for row in page['rows']], [4])
        # JSON numeric values need no interpretation; mixed types must not quietly disappear.
        self.assertEqual(self.page(b'[{"n":1}]', dict(filter=dict(field='n', operator='gte', value='2')), 'records.json')['matched'], 0)
        with self.assertRaisesRegex(ValueError, 'nonnumeric'):
            self.page(b'[{"n":1},{"n":"2"}]', dict(filter=dict(field='n', operator='gte', value='2')), 'records.json')
        with self.assertRaisesRegex(ValueError, 'CSV and TSV'):
            self.page(b'[{"n":"2"}]', dict(interpretations={'n': 'number'}), 'records.json')

    def test_issue_rows_keep_full_input_scope_and_original_identities(self):
        content = b'{"id":"first","n":null}\n\n{"id":"second","n":""}\n{"id":"third"}\n{"id":"third"}\n'
        for kind, expected in [('null', [1]), ('empty', [2]), ('missing', [3, 4]), ('duplicate', [4])]:
            with self.subTest(kind=kind):
                issue = dict(kind=kind) if kind == 'duplicate' else dict(kind=kind, field='n')
                page = self.page(content, dict(issue=issue), 'records.jsonl')
                self.assertEqual([row['row'] for row in page['rows']], expected)
                self.assertEqual(page['report']['rowCount'], 4)
                self.assertEqual(page['issueScope'], 'full-input-intersect-current-filter')
        page = self.page(content, dict(issue=dict(kind='missing', field='n'),
                                      sort=dict(field='id', descending=True)), 'records.jsonl', 1, 1)
        self.assertEqual((page['rows'][0]['row'], page['rows'][0]['line']), (4, 5))
        page = self.page(content, dict(issue=dict(kind='missing'), filter=dict(field='id', operator='eq', value='first')), 'records.jsonl')
        self.assertEqual(page['matched'], 0)
        self.assertEqual(page['report']['missing'], 2)
        # Duplicate drilldown is complete, unlike the bounded ten report examples.
        page = self.page(b'x\nv\n' + b'v\n' * 30, dict(issue=dict(kind='duplicate')), offset=20, limit=5)
        self.assertEqual((page['matched'], page['nextOffset']), (30, 25))
        self.assertEqual([row['row'] for row in page['rows']], [22, 23, 24, 25, 26])

    def test_interpretation_keeps_raw_duplicate_rules_and_large_exponents(self):
        page = self.page(b'n\n001\n1\n001\n', dict(interpretations={'n': 'number'}, issue=dict(kind='duplicate')))
        self.assertEqual((page['report']['duplicateRows'], [row['row'] for row in page['rows']]), (1, [3]))
        page = self.page(b'n\n1e999999\n1e9999999999999999999999999\n', dict(interpretations={'n': 'number'}))
        self.assertEqual(page['rows'][0]['cells'][0]['exact'], '1E+999999')
        self.assertEqual(page['report']['conversionFailures'], 1)
        self.assertEqual(page['rows'][1]['cells'][0]['kind'], 'string')
        for spec in ({'interpretations': {'n': 'float'}}, {'interpretations': {1: 'number', 'n': 'number'}},
                     {'issue': {'kind': 'duplicate', 'field': 'n'}}, {'issue': {'kind': 'unknown'}}):
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                ViewSpec.parse(spec)

    def test_saved_interpretation_replays_across_read_export_chart_and_source(self):
        with tempfile.TemporaryDirectory() as home:
            catalog = Catalog(home)
            raw = b'id,n\n001,9007199254740993\n002,no\n003,1.2300\n004,no\n005,0\n'
            asset = catalog.import_file(ImportFile.parse(dict(name='records.csv', kind='dataset', content=base64.b64encode(raw).decode())))
            target = dict(datasetId=catalog.datasets[0].id, assetId=asset.id)
            spec = dict(interpretations={'n': 'number'}, filter=dict(field='n', operator='gte', value='1'),
                        sort=dict(field='n', descending=True), selection=[2], columns=['id', 'n'])
            request = PreviewRequest.parse(target | dict(view=spec))
            original = catalog.inspect(request)
            saved = catalog.save_view(SaveView('Exact view', request))
            catalog = Catalog(home)
            replay = PreviewRequest.parse(target | dict(view=catalog.views[0].view.public(), parserVersion=saved.report.parserVersion))
            self.assertEqual(catalog.inspect(replay), original)
            analysis = Analysis(catalog)
            read = analysis.read(target | dict(view=spec, limit=20))
            self.assertEqual(read['records'][0]['ordinal'], 2)
            exported = json.loads(analysis.export(target | dict(view=spec))['content'])
            self.assertEqual(exported['rows'], [{'id': '003', 'n': 1.23}])
            self.assertEqual(exported['manifest']['view']['interpretations'], {'n': 'number'})
            self.assertEqual(exported['manifest']['viewId'], original['viewId'])
            chart = analysis.create_chart(target | dict(view=spec, chartDocument=dict(title='Exact', chart=dict(type='bar', x='id', y='n'))))
            self.assertEqual(chart['document']['source']['viewId'], original['viewId'])
            self.assertEqual(chart['document']['source']['records'][0]['ordinal'], 2)
            self.assertEqual(analysis.source(target | dict(view=spec))['content'], raw.decode())
            issues = dict(interpretations={'n': 'number'}, issue=dict(kind='conversion', field='n'),
                          filter=dict(field='id', operator='gte', value='0'))
            # A different text field remains uninterpreted even when n is interpreted.
            self.assertEqual(catalog.inspect(PreviewRequest.parse(target | dict(view=issues)))['status'], 'invalid')
            issues['filter'] = dict(field='id', operator='contains', value='00')
            issues['selection'] = [3]
            issue_request = PreviewRequest.parse(target | dict(view=issues, offset=1, limit=1))
            issue_page = catalog.inspect(issue_request)
            self.assertEqual(issue_page['rows'][0]['row'], 4)
            catalog.save_view(SaveView('Failures', issue_request))
            catalog = Catalog(home)
            self.assertEqual(catalog.views[-1].view.issue.kind, 'conversion')
            failures = json.loads(Analysis(catalog).export(target | dict(view=catalog.views[-1].view.public()))['content'])
            self.assertEqual(failures['rows'], [{'id': '004', 'n': 'no'}])
            self.assertEqual(failures['manifest']['provenance'][0]['ordinal'], 3)
            for method in (analysis.source, analysis.read, analysis.export):
                with self.subTest(method=method.__name__), self.assertRaisesRegex(ValueError, 'parser version'):
                    method(target | dict(view=spec, parserVersion='unavailable'))
            with self.assertRaisesRegex(ValueError, 'parser version'):
                PreviewRequest.parse(target | dict(view=spec, parserVersion='unavailable'))
            path = Path(home) / 'files' / asset.id
            path.write_bytes(raw.replace(b'001', b'009'))
            self.assertEqual(catalog.inspect(replay)['status'], 'changed')
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                Analysis(catalog).export(target | dict(view=spec))


if __name__ == '__main__':
    unittest.main()
