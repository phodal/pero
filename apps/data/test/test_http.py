"""One loopback transport test; no public network or model provider calls."""
import base64
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from catalog import Catalog
from downloads import Downloads
from server import handler


class HttpTest(unittest.TestCase):
    def test_host_authentication_and_import_state(self):
        with tempfile.TemporaryDirectory() as directory:
            downloads = Downloads(Catalog(directory))
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(downloads, 'test-secret'))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                def request(method, path, data=None, authorized=True):
                    connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                    headers = {'Content-Type': 'application/json'}
                    if authorized:
                        headers['X-Pero-App-Token'] = 'test-secret'
                    connection.request(method, path, json.dumps(data) if data is not None else None, headers)
                    response = connection.getresponse()
                    result = response.status, json.loads(response.read())
                    connection.close()
                    return result
                self.assertEqual(request('GET', '/api/state', authorized=False)[0], 401)
                status, state = request('GET', '/api/state')
                self.assertEqual((status, len(state['sources']), state['assets']), (200, 2, []))
                status, state = request('POST', '/api/import', dict(name='test.csv', kind='dataset',
                                        content=base64.b64encode(b'time,value\n0,1\n').decode()))
                self.assertEqual(status, 200)
                self.assertEqual(state['assets'][0]['name'], 'test.csv')
                self.assertEqual(request('POST', '/api/download', {'url': 'https://example.org'})[0], 400)
                self.assertEqual(request('POST', '/api/import', {'path': '/etc/passwd'})[0], 400)
                self.assertEqual(request('GET', '/api/files/etc/passwd')[0], 404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(3)
                downloads.close()


if __name__ == '__main__':
    unittest.main()
