"""Real ResearchStore and authenticated loopback transport; network source is a fixture."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.http import handler
from paper_agent.model import PaperSnapshot
from paper_agent.store import ResearchStore
from paper_agent.paper_documents import ArxivHtml, PaperDocuments
from test_paper_documents import FixtureSource
from test_scientific_document import SOURCE, URL


class DocumentHTTPTests(unittest.TestCase):
    def test_authenticated_prepare_read_export_and_restart(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(dict(
                source='alphaxiv', sourceId='2606.03979v2', title='Synthetic fixture',
                url='https://arxiv.org/abs/2606.03979v2', authors=[],
                contentKind='abstract', content='Original abstract remains unchanged.'),
                '2026-11-01T00:00:00Z'))
            original = paper.to_dict()
            source = FixtureSource({URL: SOURCE})
            documents = PaperDocuments(store, ArxivHtml(source))
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(
                store, 'test-token', now=lambda: '2026-11-01T01:00:00Z', paper_documents=documents))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def call(method, path, body=None, token='test-token'):
                connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                try:
                    connection.request(method, path, json.dumps(body) if body is not None else None,
                                       {'X-Pero-App-Token': token, 'Content-Type': 'application/json'})
                    response = connection.getresponse()
                    raw = response.read()
                    return response.status, (json.loads(raw) if 'application/json' in response.getheader('Content-Type')
                                             else raw.decode('utf-8'))
                finally:
                    connection.close()

            try:
                endpoint = '/api/paper-documents'
                self.assertEqual(call('POST', endpoint, dict(paperId=paper.id), token='wrong')[0], 401)
                self.assertEqual(call('GET', endpoint + '?paperId=' + paper.id), (200, {'document': None}))
                self.assertFalse(source.urls)
                for invalid in (dict(paperId=paper.id, url=URL), dict(paperId=paper.id, refresh='yes'), dict(paperId='../outside')):
                    self.assertEqual(call('POST', endpoint, invalid)[0], 400)
                self.assertFalse(source.urls)
                status, document = call('POST', endpoint, dict(paperId=paper.id))
                self.assertEqual(status, 200)
                identity = document['id']
                self.assertEqual(document['pdfAlignment'], 'unavailable')
                self.assertEqual(document['paperId'], paper.id)
                self.assertEqual(call('POST', endpoint, dict(paperId=paper.id))[1]['id'], identity)
                self.assertEqual(source.urls, [URL])
                self.assertEqual(call('GET', endpoint + '?paperId=' + paper.id)[1]['document']['id'], identity)
                detail = endpoint + '/' + identity
                self.assertEqual(call('GET', detail)[1], document)
                self.assertTrue(call('GET', detail + '/outline')[1]['outline'])
                block = next(b for b in document['blocks'] if b['kind'] == 'paragraph')
                status, read = call('GET', detail + '/blocks/' + block['id'] + '?limit=4')
                self.assertEqual(status, 200)
                self.assertEqual(len(read['content']), 4)
                self.assertEqual(read['evidenceAdmission'], 'not-observed-in-study')
                self.assertEqual(call('GET', detail + '/blocks/' + block['id'] + '?limit=4801')[0], 422)
                status, html = call('GET', detail + '/html')
                self.assertEqual(status, 200)
                self.assertIn('<math', html)
                self.assertIn('Content-Security-Policy', html)
                self.assertEqual(call('GET', detail + '/html', token='wrong')[0], 401)
                self.assertEqual(store.paper(paper.id).to_dict(), original)
                self.assertEqual(store._list('studies'), [])
                self.assertEqual(store._list('pdfs'), [])
                reloaded = PaperDocuments(ResearchStore(root))
                self.assertEqual(reloaded.latest(paper.id).id, identity)
                record = store._read('scientific-documents', identity)
                self.assertEqual(record['sourceHtml'].encode('utf-8'), SOURCE)
                source.replies[URL] = b'<h1>Broken response</h1>'
                self.assertEqual(call('POST', endpoint, dict(paperId=paper.id, refresh=True))[0], 422)
                self.assertEqual(reloaded.read(identity).id, identity)
                self.assertEqual(len(store._list('scientific-documents')), 1)
            finally:
                server.shutdown()
                thread.join(timeout=3)
                server.server_close()


if __name__ == '__main__':
    unittest.main()
