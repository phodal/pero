"""Dataset/version/inspection contracts; only temporary files and loopback HTTP."""
import base64
from dataclasses import asdict, replace
from hashlib import sha256
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from catalog import Catalog, ImportFile
from datasets import (Dataset, DatasetEdit, PARSER_VERSION, PreviewRequest, SaveView, ViewSpec)
from downloads import Downloads
from inspection import Inspection
from server import handler
from sources import Checksum, SOURCES


def request_for(catalog, asset, **changes):
    dataset = next(d for d in catalog.datasets if asset.id in d.versions)
    return PreviewRequest.parse(dict(datasetId=dataset.id, assetId=asset.id, **changes))


def import_into(catalog, content=b'id,value\n001,2\n002,\n001,2\n', name='measurements.csv', **changes):
    return catalog.import_file(ImportFile.parse(dict(name=name, kind='dataset',
        content=base64.b64encode(content).decode(), source='User measurements', **changes)))


class InstalledCoreTests(unittest.TestCase):
    def test_independent_app_runs_with_packaged_core_without_source_tree(self):
        root = Path(__file__).resolve().parents[3]
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / 'distribution' / 'apps' / 'data' / 'backend'
            app.mkdir(parents=True)
            for source in (root / 'apps/data/backend').glob('*.py'):
                shutil.copyfile(source, app / source.name)
            (app / '_core').mkdir()
            shutil.copyfile(root / 'harness/go/charts/python/dataset.py', app / '_core/dataset.py')
            script = """import base64
from catalog import Catalog, ImportFile
from datasets import PreviewRequest
c = Catalog('profile')
a = c.import_file(ImportFile.parse(dict(name='test.json', kind='dataset', content=base64.b64encode(b'[{"n":9007199254740993}]').decode())))
r = c.inspect(PreviewRequest.parse(dict(datasetId=c.datasets[0].id, assetId=a.id)))
assert r['status'] == 'ok'
assert r['rows'][0]['cells'][0]['text'] == '9007199254740993'
print('PACKAGED_CORE_OK')
"""
            result = subprocess.run([sys.executable, '-c', script], cwd=app, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'PACKAGED_CORE_OK')


class InspectionTests(unittest.TestCase):
    def preview(self, content, name='table.json', **changes):
        value = Inspection.parse(content, name, name.rsplit('.', 1)[-1])
        return value, value.page(PreviewRequest('ds-' + 'a' * 32, 'a' * 32, ViewSpec.parse(changes)))

    def test_exact_json_values_missing_null_empty_and_duplicate_rows(self):
        content = b'[{"n":9007199254740993,"z":null},{"n":1.2300,"z":""},{"n":1.2300,"z":""},{"n":1.23}]'
        value, page = self.preview(content)
        self.assertEqual([row['cells'][0]['text'] for row in page['rows']], ['9007199254740993', '1.2300', '1.2300', '1.23'])
        self.assertEqual((value.report.missing, value.report.nulls, value.report.empty, value.report.duplicateRows), (1, 1, 2, 1))
        self.assertEqual(asdict(value.report.duplicates[0]), dict(row=3, duplicateOf=2, sourceLine=None))
        self.assertEqual(page['rows'][-1]['cells'][1]['kind'], 'missing')
        self.assertEqual(value.report.scope, 'full')

    def test_csv_preserves_ids_quoted_newlines_empty_cells_and_source_lines(self):
        value, page = self.preview(b'\xef\xbb\xbfid,comment\r\n001,"two\nlines"\r\n002,\r\n\r\n002,\r\n', 'table.csv')
        self.assertEqual(page['rows'][0]['cells'][0]['text'], '001')
        self.assertEqual(page['rows'][0]['cells'][0]['kind'], 'string')
        self.assertEqual(page['rows'][0]['cells'][1]['text'], 'two\nlines')
        self.assertEqual([row['line'] for row in page['rows']], [2, 4, 6])
        self.assertEqual((value.report.nulls, value.report.empty, value.report.blankLines), (0, 2, 1))
        self.assertEqual(value.report.duplicates[0].sourceLine, 6)

    def test_jsonl_preserves_source_line_and_blank_line_count(self):
        value, page = self.preview(b'{"x":1e3}\n\n{"y":null}\n', 'data.jsonl')
        self.assertEqual([row['line'] for row in page['rows']], [1, 3])
        self.assertEqual(value.report.blankLines, 1)
        self.assertEqual(page['rows'][0]['cells'][0]['text'], '1e3')
        self.assertEqual(value.report.missing, 2)

    def test_invalid_documents_are_explicit(self):
        cases = ((b'a,a\n1,2\n', 'a.csv'), (b'a,b\n1\n', 'a.csv'),
                 (b'a\n"never closed', 'a.csv'), (b'{"x":1,"x":2}', 'a.json'),
                 (b'[{"x":NaN}]', 'a.json'), (b'[1,2]', 'a.json'),
                 (b'\xff', 'a.csv'), (b'x' * (10 * 1024 * 1024 + 1), 'a.csv'),
                 (b'{}', 'a.model'))
        for content, name in cases:
            with self.subTest(name=name, start=content[:30]), self.assertRaises(ValueError):
                self.preview(content, name)

    def test_row_and_field_bounds_do_not_emit_partial_full_reports(self):
        for content, name in ((b'x\n' + b'a\n' * 100001, 'large.csv'),
                              (json.dumps({f'f{i}': i for i in range(257)}).encode(), 'wide.json')):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.preview(content, name)

    def test_filter_page_and_literal_field_names_keep_original_ordinals(self):
        value, page = self.preview(b'[{" x ":"yes"},{" x ":"no"},{" x ":"YES"}]',
                                   columns=[' x '], filterField=' x ', contains='yes')
        self.assertEqual([row['row'] for row in page['rows']], [1, 3])
        second = value.page(PreviewRequest('ds-' + 'a' * 32, 'a' * 32, ViewSpec.parse(dict(filterField=' x ', contains='yes')), 1, 1))
        self.assertEqual(second['rows'][0]['row'], 3)
        self.assertIsNone(second['nextOffset'])
        with self.assertRaises(ValueError):
            value.page(PreviewRequest('ds-' + 'a' * 32, 'a' * 32, ViewSpec(('missing',))))
        self.assertEqual(value.report.rowCount, 3)  # Checks cover the input, not only filtered rows.

    def test_empty_dataset_is_not_a_parse_error(self):
        for content, name in ((b'[]', 'a.json'), (b'x,y\n', 'a.csv')):
            with self.subTest(name=name):
                value, page = self.preview(content, name)
                self.assertEqual((value.report.rowCount, page['matched'], page['rows']), (0, 0, []))

    def test_duplicate_examples_are_bounded_but_count_is_complete(self):
        value, _ = self.preview(b'x\n' + b'v\n' * 30, 'a.csv')
        self.assertEqual((value.report.duplicateRows, len(value.report.duplicates)), (29, 10))


class DatasetTests(unittest.TestCase):
    def test_versions_are_immutable_and_archive_or_kind_changes_block_append(self):
        dataset = Dataset.for_asset('a' * 32, 'Input', 'dataset')
        next_version = dataset.append('b' * 32, 'dataset')
        self.assertEqual(dataset.versions, ('a' * 32,))
        self.assertEqual(next_version.versions, ('a' * 32, 'b' * 32))
        for value, kind in ((replace(dataset, archived=True), 'dataset'), (dataset, 'model')):
            with self.assertRaises(ValueError):
                value.append('c' * 32, kind)
        with self.assertRaises(ValueError):
            dataset.require_version('b' * 32)

    def test_commands_reject_unbounded_or_ambiguous_input(self):
        base = dict(datasetId='ds-' + 'a' * 32, assetId='a' * 32)
        changes = ({'offset': -1}, {'offset': True}, {'limit': 201}, {'limit': 0},
                   {'assetId': '../secret'}, {'datasetId': 'unknown'}, {'parserVersion': 'future'},
                   {'view': {'columns': ['a', 'a']}}, {'view': {'columns': ['a'] * 33}},
                   {'view': {'contains': 'a'}}, {'view': {'url': 'https://example.org'}})
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                PreviewRequest.parse(base | change)


class CatalogWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.catalog = Catalog(self.temp.name)

    def test_import_versions_saved_view_and_project_survive_restart(self):
        first = import_into(self.catalog, projectRef='project-control')
        dataset = self.catalog.datasets[0]
        before = self.catalog.inspect(request_for(self.catalog, first))
        saved = self.catalog.save_view(SaveView('Rows with id 001', request_for(self.catalog, first,
            view=dict(columns=['id', 'value'], filterField='id', contains='001', units={'value': 'V'}))))
        second = import_into(self.catalog, b'id,value\n001,9\n', datasetId=dataset.id)
        reopened = Catalog(self.temp.name)
        self.assertEqual(reopened.dataset(dataset.id).versions, (first.id, second.id))
        self.assertEqual(reopened.dataset(dataset.id).projectRef, 'project-control')
        self.assertEqual(reopened.views[0], saved)
        self.assertEqual(reopened.inspect(request_for(reopened, first)), before)
        self.assertNotEqual(reopened.inspect(request_for(reopened, second))['report'], before['report'])
        self.assertEqual((reopened.files / first.id).read_bytes(), b'id,value\n001,2\n002,\n001,2\n')
        self.assertNotIn('location', json.dumps(saved.public()))

    def test_legacy_migration_preserves_asset_and_bundle_ids_and_original_bytes(self):
        original = import_into(self.catalog)
        old = asdict(original) | {'bundleId': 'c' * 64, 'sourceId': 'd' * 64, 'revision': 'a' * 40}
        self.catalog.atomic('catalog.json', [old])
        reopened = Catalog(self.temp.name)
        stable_id = reopened.datasets[0].id
        self.assertEqual(reopened.assets[0].bundleId, 'c' * 64)
        self.assertEqual(json.loads((reopened.directory / 'catalog.json').read_text()), [old])
        reopened.edit_dataset(DatasetEdit(stable_id, 'Measurements', 'project-id', False))
        self.assertEqual(json.loads((reopened.directory / 'catalog.v1.backup.json').read_text()), [old])
        final = Catalog(self.temp.name)
        self.assertEqual(asdict(final.assets[0]), old)
        self.assertEqual(final.datasets[0].id, stable_id)
        self.assertEqual(sha256((final.files / original.id).read_bytes()).hexdigest(), original.sha256)

    def test_persistence_failure_publishes_neither_version_nor_new_file(self):
        first = import_into(self.catalog)
        original = self.catalog.workspace()
        with patch.object(self.catalog, 'atomic', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                import_into(self.catalog, b'id,value\n001,8\n', datasetId=self.catalog.datasets[0].id)
        self.assertEqual(self.catalog.workspace(), original)
        self.assertEqual(Catalog(self.temp.name).workspace(), original)
        self.assertEqual([p.name for p in self.catalog.files.iterdir()], [first.id])
        self.assertEqual(list(self.catalog.directory.glob('*.part')), [])

    def test_archive_restore_and_unlink_project_never_delete_history(self):
        first = import_into(self.catalog, projectRef='project-control')
        dataset = self.catalog.datasets[0]
        self.catalog.edit_dataset(DatasetEdit(dataset.id, 'Renamed', '', True))
        with self.assertRaises(ValueError):
            import_into(self.catalog, datasetId=dataset.id)
        reopened = Catalog(self.temp.name)
        self.assertTrue(reopened.dataset(dataset.id).archived)
        self.assertEqual(reopened.dataset(dataset.id).projectRef, '')
        self.assertTrue((reopened.files / first.id).is_file())
        reopened.edit_dataset(DatasetEdit(dataset.id, 'Renamed', '', False))
        self.assertEqual(reopened.inspect(request_for(reopened, first))['status'], 'ok')

    def test_duplicate_names_are_separate_datasets_and_explicit_versions_append(self):
        first, second = import_into(self.catalog), import_into(self.catalog)
        self.assertEqual(len(self.catalog.datasets), 2)
        self.assertNotEqual(first.id, second.id)
        dataset = self.catalog.datasets[0]
        third = import_into(self.catalog, datasetId=dataset.id)
        self.assertEqual(first.sha256, third.sha256)
        self.assertEqual(self.catalog.dataset(dataset.id).versions, (first.id, third.id))

    def test_current_file_damage_never_reuses_a_saved_report_as_current_preview(self):
        asset = import_into(self.catalog)
        query = request_for(self.catalog, asset)
        saved = self.catalog.save_view(SaveView('Before damage', query))
        path = self.catalog.files / asset.id
        content = path.read_bytes()
        path.write_bytes(content.replace(b'001', b'999'))  # Same byte count.
        self.assertEqual(self.catalog.inspect(query)['status'], 'changed')
        with self.assertRaises(ValueError):
            self.catalog.save_view(SaveView('Must not save', query))
        self.assertEqual(Catalog(self.temp.name).views[0].report, saved.report)
        path.unlink()
        self.assertEqual(self.catalog.inspect(query)['status'], 'missing')
        self.assertFalse(self.catalog.listing()[0]['localAvailable'])
        path.write_bytes(content)
        self.assertEqual(self.catalog.inspect(query)['status'], 'ok')

    def test_bad_format_is_stored_not_replaced_by_demo_or_silently_repaired(self):
        for content, name in ((b'a,b\n1\n', 'invalid.csv'), (b'opaque pickle', 'weights.model')):
            with self.subTest(name=name):
                asset = import_into(self.catalog, content, name)
                result = self.catalog.inspect(request_for(self.catalog, asset))
                self.assertEqual(result['status'], 'invalid' if name.endswith('.csv') else 'unsupported')
                self.assertEqual((self.catalog.files / asset.id).read_bytes(), content)
        self.assertEqual(len(Catalog(self.temp.name).assets), 2)

    def test_asset_from_another_dataset_cannot_enter_view(self):
        first, second = import_into(self.catalog), import_into(self.catalog)
        mismatched = replace(request_for(self.catalog, first), assetId=second.id)
        self.assertEqual(self.catalog.inspect(mismatched)['status'], 'invalid')
        with self.assertRaises(ValueError):
            self.catalog.save_view(SaveView('Invalid binding', mismatched))

    def test_completed_download_appears_in_same_logical_catalog(self):
        content = b'opaque model bytes'
        source = replace(SOURCES[1], size=len(content), checksums=(Checksum('sha256', sha256(content).hexdigest(), 'fixture'),))
        downloads = Downloads(self.catalog, (source,), lambda _: io.BytesIO(content))
        downloads.start(source.id)
        downloads.thread.join(3)
        self.assertFalse(downloads.thread.is_alive())
        self.assertEqual(downloads.state()['download']['status'], 'completed')
        self.assertEqual(len(self.catalog.datasets), 1)
        self.assertEqual(self.catalog.datasets[0].versions, (self.catalog.assets[0].id,))
        self.assertEqual(Catalog(self.temp.name).assets[0].revision, source.revision)
        downloads.close()

    def test_unknown_schema_fails_closed_without_overwriting_original(self):
        raw = '{"schemaVersion":999}'
        (self.catalog.directory / 'catalog.json').write_text(raw)
        with self.assertRaises(ValueError):
            Catalog(self.temp.name)
        self.assertEqual((self.catalog.directory / 'catalog.json').read_text(), raw)


class WorkspaceHTTPTests(unittest.TestCase):
    def test_real_authenticated_http_import_inspect_edit_save_and_restart(self):
        with tempfile.TemporaryDirectory() as home:
            catalog = Catalog(home)
            downloads = Downloads(catalog, opener=lambda _: self.fail('No network in workspace actions'))
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(downloads, 'fixture'))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                def request(path, value=None, token='fixture'):
                    conn = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                    conn.request('GET' if value is None else 'POST', path, None if value is None else json.dumps(value),
                                 {'Content-Type': 'application/json', 'X-Pero-App-Token': token})
                    response = conn.getresponse()
                    result = response.status, json.loads(response.read())
                    conn.close()
                    return result
                for path in ('/api/import', '/api/inspect', '/api/views', '/api/datasets/update'):
                    self.assertEqual(request(path, {}, 'wrong')[0], 401)
                self.assertEqual(request('/api/state')[1]['datasets'], [])
                status, imported = request('/api/import', dict(name='x.json', kind='dataset',
                    content=base64.b64encode(b'[{"id":9007199254740993},{"id":null}]').decode()))
                self.assertEqual(status, 200)
                selection = dict(datasetId=imported['selectedDatasetId'], assetId=imported['selectedAssetId'])
                status, preview = request('/api/inspect', selection)
                self.assertEqual((status, preview['status']), (200, 'ok'))
                self.assertEqual(preview['rows'][0]['cells'][0]['text'], '9007199254740993')
                self.assertEqual(request('/api/datasets/update', dict(datasetId=selection['datasetId'],
                    name='Control measurements', projectRef='project-1', archived=False))[0], 200)
                status, saved = request('/api/views', dict(name='Baseline', preview=selection))
                self.assertEqual(status, 200)
                self.assertEqual(saved['views'][0]['id'], saved['savedViewId'])
                self.assertEqual(request('/api/inspect', selection | {'limit': 201})[0], 400)
                self.assertEqual(request('/api/import', {'path': '/private/source'})[0], 400)
                self.assertIsNone(downloads.thread)
            finally:
                server.shutdown(); server.server_close(); thread.join(3); downloads.close()
            reopened = Catalog(home)
            self.assertEqual(reopened.datasets[0].name, 'Control measurements')
            self.assertEqual(reopened.datasets[0].projectRef, 'project-1')
            self.assertEqual(reopened.views[0].sha256, reopened.assets[0].sha256)


if __name__ == '__main__':
    unittest.main()
