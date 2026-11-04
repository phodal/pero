"""Chart documents and exports share one catalog version. No second dataset store."""
import base64
import json
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from analysis import Analysis
from catalog import Catalog, ImportFile
from downloads import Downloads
from server import handler


def post(server, path, value, token='fixture'):
    connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
    connection.request('POST', path, json.dumps(value),
                       {'Content-Type': 'application/json', 'X-Pero-App-Token': token})
    response = connection.getresponse()
    body = json.loads(response.read())
    status = response.status
    connection.close()
    return status, body


class AnalysisTests(unittest.TestCase):
    def test_chart_export_and_source_use_catalog_identity(self):
        with tempfile.TemporaryDirectory() as home:
            catalog = Catalog(home)
            content = b'[{"g":"A","n":9007199254740993},{"g":"B","n":2},{"g":"A","n":3}]'
            asset = catalog.import_file(ImportFile.parse(dict(
                name='measures.json', kind='dataset', content=base64.b64encode(content).decode(), source='Local import')))
            dataset_id = catalog.datasets[0].id
            view = dict(filter=dict(field='g', operator='eq', value='A'), selection=[2], columns=['g'],
                        chart=dict(category='g', measure='n', aggregation='sum'))
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(Downloads(catalog), 'fixture'))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                self.assertEqual(post(server, '/api/export', {}, 'wrong')[0], 401)
                status, exported = post(server, '/api/export', dict(datasetId=dataset_id, assetId=asset.id, view=view))
                self.assertEqual(status, 200)
                payload = json.loads(exported['content'])
                self.assertEqual(payload['rows'], [{'g': 'A', 'n': 3}])
                self.assertEqual(payload['manifest']['dataset'], dataset_id)
                self.assertEqual(payload['manifest']['assetId'], asset.id)
                self.assertEqual(payload['manifest']['sha256'], asset.sha256)
                self.assertNotIn(exported['id'] + '.export.json',
                                 json.loads((Path(home) / 'catalog.json').read_text()).keys())
                status, chart = post(server, '/api/chart', dict(
                    datasetId=dataset_id, assetId=asset.id, view=view,
                    chartDocument=dict(title='Groups', chart=dict(type='bar', x='g', y='n'))))
                self.assertEqual(status, 200)
                self.assertEqual(chart['document']['source']['catalogDatasetId'], dataset_id)
                self.assertEqual(chart['document']['source']['assetId'], asset.id)
                self.assertEqual(chart['document']['source']['sha256'], asset.sha256)
                self.assertEqual(chart['document']['source']['records'][0]['pointer'], '/2')
                self.assertNotIn('charts', json.loads((Path(home) / 'catalog.json').read_text()))
                connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
                connection.request('GET', '/api/chart/' + chart['artifactId'], headers={'X-Pero-App-Token': 'fixture'})
                reopened = json.loads(connection.getresponse().read())
                connection.close()
                self.assertEqual(reopened, chart)
                status, rejected = post(server, '/api/chart/validate', dict(document=dict(chart['document'], rows=[{'g': 'A', 'n': 1}])))
                self.assertEqual(status, 400)
                self.assertIn('provenance', rejected['error'])
                external = dict(schemaVersion=1, id='outside', title='External', chart=dict(type='bar', x='label', y='value'),
                                rows=[dict(label='A', value=2)], source=dict(label='Unverified'))
                status, saved = post(server, '/api/chart/validate', dict(document=external))
                self.assertEqual(status, 200)
                self.assertEqual(saved['document']['source']['label'], 'Unverified')
                self.assertNotIn('dataset', saved['document']['source'])
                wide = b'[' + b','.join(f'{{"label":"{index}","n":1}}'.encode() for index in range(2001)) + b']'
                wide_asset = catalog.import_file(ImportFile.parse(dict(
                    name='wide.json', kind='dataset', content=base64.b64encode(wide).decode(), source='Local import')))
                wide_id = next(item.id for item in catalog.datasets if wide_asset.id in item.versions)
                status, too_many = post(server, '/api/chart', dict(
                    datasetId=wide_id, assetId=wide_asset.id, view={},
                    chartDocument=dict(title='Too many', chart=dict(type='bar', x='label', y='n'))))
                self.assertEqual(status, 400)
                self.assertIn('2,000', too_many['error'])
                self.assertFalse(any('Too many' in path.read_text() for path in (Path(home) / 'charts').glob('*.chart.json')))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(3)


if __name__ == '__main__':
    unittest.main()
