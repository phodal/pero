"""One loopback check of the App transport and domain persistence wiring."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import io
import tempfile
import threading
import unittest
from test_research import NOW, reading, report_value
from paper_agent.store import ResearchStore
from paper_agent.pdf_files import PdfFiles
from test_pdf import pdf_fixture


class LiteratureFixture:
    def search(self, _query):
        return dict(items=[dict(id="1706.03762", source="alphaxiv", title="Synthetic retrieval")], warnings=[])

    def read(self, _query):
        return reading()

    def discover(self, query, paper):
        from paper_agent.discovery import DiscoveryBatch, DiscoveryPaper
        work = DiscoveryPaper('W1', 'Synthetic seed', 'https://openalex.org/W1', (), 'Seed', '', 0)
        candidate = DiscoveryPaper('W2', 'Synthetic candidate', 'https://openalex.org/W2', (), 'Candidate source', '', 0)
        return DiscoveryBatch(paper.id, paper.title, query.relation, work, (candidate,), 1, False, NOW, 'confirmed')


class ResearchHTTP(unittest.TestCase):
    def test_paper_thumbnail_route(self):
        from paper_agent.http import handler
        from paper_agent.thumbnails import MAX_THUMBNAIL_BYTES, PaperThumbnails
        from urllib.error import HTTPError

        png = b'\x89PNG\r\n\x1a\nsynthetic'
        requested = []

        def fetch(request, timeout):
            requested.append(request.full_url)
            name = request.full_url.rsplit('/', 1)[-1]
            if name == '1234.00004.png':
                raise HTTPError(request.full_url, 302, 'Redirect refused', {}, None)
            data = png if name != '1234.00003.png' else png + b'x' * MAX_THUMBNAIL_BYTES
            response = io.BytesIO(data if name != '1234.00002.png' else b'not a PNG')
            response.headers = {'Content-Type': 'image/png' if name != '1234.00005.png' else 'text/html'}
            return response

        with tempfile.TemporaryDirectory() as root:
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(ResearchStore(root), 'test-token', thumbnails=PaperThumbnails(fetch)))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def get(path, token='test-token'):
                connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                connection.request('GET', path, headers={'X-Pero-App-Token': token})
                response = connection.getresponse()
                result = response.status, response.getheader('Content-Type'), response.read()
                connection.close()
                return result

            try:
                self.assertEqual(get('/api/paper-thumbnails/1234.00001.png', 'wrong')[0], 401)
                self.assertEqual(requested, [])
                self.assertEqual(get('/api/paper-thumbnails/invalid.png')[0], 400)
                self.assertEqual(requested, [])
                self.assertEqual(get('/api/paper-thumbnails/1234.00001.png'), (200, 'image/png', png))
                self.assertEqual(requested[-1], 'https://cdn-thumbnails.huggingface.co/social-thumbnails/papers/1234.00001.png')
                for identity in ('1234.00002', '1234.00003', '1234.00004', '1234.00005'):
                    self.assertEqual(get('/api/paper-thumbnails/' + identity + '.png')[0], 502)
            finally:
                server.shutdown()
                thread.join(timeout=3)
                server.server_close()

    def test_authenticated_local_workflow(self):
        from paper_agent.http import handler
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler(store, "test-token", LiteratureFixture(), lambda: NOW,
                       PdfFiles(lambda *_args, **_kwargs: io.BytesIO(pdf_fixture()))))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def call(method, path, body=None, token="test-token", raw=False):
                connection = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                payload = body if isinstance(body, bytes) else json.dumps(body) if body is not None else None
                connection.request(method, path, body=payload, headers={"Content-Type": "application/pdf" if isinstance(body, bytes) else "application/json", "X-Pero-App-Token": token})
                response = connection.getresponse()
                content = response.read()
                result = content if raw else json.loads(content)
                status = response.status
                connection.close()
                return status, result

            try:
                self.assertEqual(call("GET", "/api/library", token="wrong")[0], 401)
                example = call("GET", "/api/example")[1]
                self.assertIn("Synthetic", example["title"])
                self.assertEqual(call("GET", "/api/library")[1]["papers"], [])
                paper = call("POST", "/api/papers/import", reading())[1]
                self.assertEqual(paper["source"], "import")
                selected = '原始选段 β\r\n' + 'Selected source text. ' * 2000
                status, context = call('POST', '/api/contexts', dict(content=selected, paperId=paper['id']))
                self.assertEqual(status, 201)
                from pathlib import Path
                self.assertEqual(Path(context['path']).read_bytes(), selected.encode('utf-8'))
                # App-managed paths are readable without a workspace file tool or a PDF study.
                status, observed = call('POST', '/api/contexts/read', dict(contextId=context['id']))
                self.assertEqual(status, 200)
                self.assertEqual(observed['observation']['content'], selected[:4800])
                self.assertEqual(observed['observation']['nextStart'], 4800)
                self.assertEqual(observed['observation']['contextFile']['path'], context['path'])
                status, line = call('POST', '/api/contexts/read', dict(contextId=context['id'], startLine=1, endLine=1))
                self.assertEqual(status, 200)
                self.assertEqual(line['observation']['content'], '原始选段 β\r\n')
                self.assertEqual(call('POST', '/api/contexts/read', dict(contextId=context['id']), token='wrong')[0], 401)
                for invalid in (dict(contextId='../outside'), dict(path=context['path']),
                                dict(contextId=context['id'], start=-1),
                                dict(contextId=context['id'], startLine=0, endLine=1)):
                    self.assertEqual(call('POST', '/api/contexts/read', invalid)[0], 400)
                status, with_context = call('POST', '/api/intents', dict(question='Q' * 2000,
                    paperIds=[paper['id']], requestId='file-context-request', contextId=context['id']))
                self.assertEqual(status, 201)
                self.assertIn(context['path'], with_context['prompt'])
                self.assertNotIn(selected, with_context['prompt'])
                self.assertEqual(call('POST', '/api/contexts', dict(content=selected, paperId=paper['id']), token='wrong')[0], 401)
                status, lines = call('GET', f"/api/papers/{paper['id']}/lines?startLine=1&endLine=1")
                self.assertEqual(status, 200)
                self.assertEqual(lines['content'], reading()['content'].splitlines(keepends=True)[0])
                self.assertEqual(lines['contentDigest'], paper['contentDigest'])
                self.assertEqual(call('GET', f"/api/papers/{paper['id']}/lines?startLine=0&endLine=1")[0], 400)
                self.assertEqual(call('GET', f"/api/papers/{paper['id']}/lines", token='wrong')[0], 401)
                status, local = call('POST', '/api/library/search', dict(query='Exact original'))
                self.assertEqual(status, 200)
                self.assertEqual(local['items'][0]['source']['paperId'], paper['id'])
                self.assertEqual(local['items'][0]['source']['contentDigest'], paper['contentDigest'])
                self.assertEqual(call('POST', '/api/library/search', dict(query='Exact'), token='wrong')[0], 401)
                for invalid in (dict(query='???'), dict(query='Exact', limit=True), dict(query='Exact', paperIds=['missing'])):
                    self.assertEqual(call('POST', '/api/library/search', invalid)[0], 400)

                self.assertEqual(call("GET", "/api/papers/" + paper["id"])[1]["content"], reading()["content"])
                self.assertEqual(call("POST", "/api/search", dict(query="attention"))[1]["items"][0]["source"], "alphaxiv")
                frozen = call("POST", "/api/intents", dict(question="Evidence?", paperIds=[paper["id"]], requestId="http-request", verifyCode=False))[1]
                self.assertIn("untrusted", frozen["prompt"])
                intent = store.intent(frozen["id"])
                status, saved = call("POST", "/api/reports", dict(intentId=frozen["id"], text=json.dumps(report_value(intent))))
                self.assertEqual(status, 201)
                self.assertEqual(saved["acceptance"], "unverified")
                self.assertEqual(call("GET", "/api/reports/" + saved["id"] + "/export?format=markdown")[0], 200)
                located = call("POST", "/api/evidence", dict(intentId=frozen["id"], paperId=paper["id"], quote="Exact original evidence."))[1]
                self.assertEqual(located["quote"], "Exact original evidence.")
                self.assertEqual(call("POST", "/api/evidence", dict(intentId=frozen["id"], paperId=paper["id"], quote="Fake quotation"))[0], 400)
                self.assertEqual(len(call("GET", "/api/library")[1]["reports"]), 1)
                status, batch = call('POST', '/api/discover', dict(seedId=paper['id'], relation='related', workId='W1'))
                self.assertEqual(status, 201)
                self.assertEqual(call('GET', '/api/discoveries/' + batch['id'])[1]['seedId'], paper['id'])
                self.assertEqual(call('POST', '/api/favorites', dict(batchId=batch['id'], workId='W2'))[0], 201)
                self.assertEqual(len(call('GET', '/api/library')[1]['papers']), 1)
                self.assertEqual(len(call('GET', '/api/library')[1]['favorites']), 1)
                self.assertEqual(call('POST', '/api/favorites', dict(batchId=batch['id'], workId='W99'))[0], 400)
                status, candidate = call('POST', '/api/discoveries/read', dict(batchId=batch['id'], workId='W2'))
                self.assertEqual(status, 201)
                self.assertEqual(candidate['contentKind'], 'abstract')
                self.assertEqual(store.intent(frozen['id']), intent)
                pdf_paper = call('POST', '/api/papers/import', {**reading(), 'pdfUrl': 'https://arxiv.org/pdf/1706.03762'})[1]
                pdf_reading = call('POST', '/api/pdf', dict(paperId=pdf_paper['id']))[1]
                document = pdf_reading['document']
                self.assertEqual(len(document['pages']), 2)
                self.assertEqual(call('GET', f"/api/pdf/{document['id']}/file", raw=True)[1], pdf_fixture())
                status, annotation = call('POST', '/api/annotations', dict(documentId=document['id'], page=2,
                     kind='figure', rects=[dict(x=.1,y=.1,width=.5,height=.5)]))
                self.assertEqual(status, 201)
                self.assertTrue(call('GET', f"/api/annotations/{annotation['id']}/image", raw=True)[1].startswith(b'\x89PNG'))
                self.assertEqual(call('POST', '/api/matrix', dict(annotationId=annotation['id'], column='Method'))[0], 201)
                self.assertEqual(call('GET', '/api/matrix')[1]['cells'][0]['annotation']['page'], 2)
                self.assertEqual(call('GET', '/api/pdf?paperId=' + pdf_paper['id'])[1]['annotations'][0]['id'], annotation['id'])
                pdf_input = call('POST', '/api/intents', dict(question='PDF evidence?', paperIds=[pdf_paper['id']], requestId='pdf-input', verifyCode=False))[1]
                located = call('POST', '/api/evidence', dict(intentId=pdf_input['id'], paperId=pdf_paper['id'], quote='Exact original evidence.'))[1]
                self.assertEqual(located['pdf']['pages'], [1, 2])
                full_input = call('POST', '/api/intents', dict(question='Second page', paperIds=[pdf_paper['id']], requestId='pdf-full-input', fullText=True))[1]
                passage = full_input['passages'][0]
                located = call('POST', '/api/evidence', dict(intentId=full_input['id'], paperId=pdf_paper['id'], passageId=passage['id'], quote='Second page. Exact original evidence.'))[1]
                self.assertEqual(located['pdf']['pages'], [2])
                self.assertTrue(located['pdf']['rects'])
                uploaded_bytes = pdf_fixture().replace(b'Second', b'Local!')
                status, local = call('POST', '/api/pdf/import?filename=local.pdf', uploaded_bytes)
                self.assertEqual(status, 201)
                self.assertEqual(local['source'], 'local-pdf')
                self.assertEqual(call('POST', '/api/pdf/import?filename=renamed.pdf', uploaded_bytes)[1]['id'], local['id'])
                plan = call('POST', '/api/research/plan', dict(question='本地原文', paperIds=[local['id']], fullText=True, requestId='http-local-plan'))[1]
                self.assertEqual(plan['stage'], 'plan')
                batch = call('POST', '/api/research/search', dict(id=plan['id'], text='{ "query": "Local" }'))[1]
                self.assertEqual(batch['stage'], 'select')
                saved_batch = store.retrieval_batch(batch['id'])
                result = call('POST', '/api/research/select', dict(id=batch['id'], text=json.dumps(dict(passageIds=[saved_batch.passages[0].id], followupQuery=None, gaps=[]))))[1]
                self.assertEqual(result['stage'], 'answer')
                self.assertEqual(result['intent']['retrieval']['queries'], ['Local'])
                status, study = call('POST', '/api/studies', dict(question='Read the method', paperIds=[pdf_paper['id']],
                                     fullText=True, requestId='http-study'))
                self.assertEqual(status, 201)
                self.assertEqual(study['sourceCatalog'][0]['pageCount'], 2)
                status, observed = call('POST', '/api/studies/step', dict(studyId=study['id'], action='read',
                                        paperId=pdf_paper['id'], page=2))
                self.assertEqual(status, 201)
                passage = observed['observation']['passages'][0]
                self.assertIsNone(observed['observation']['nextStart'])
                evidence = dict(paperId=pdf_paper['id'], passageId=passage['id'], quote='Second page. Exact original evidence.')
                status, noted = call('POST', '/api/studies/step', dict(studyId=study['id'], action='note',
                                     text='The method is on page two.', gaps=['Independent replication is still missing.'], evidence=[evidence]))
                self.assertEqual(status, 201)
                self.assertEqual(noted['findings'][0]['evidence'], [evidence])
                continued = call('POST', '/api/studies/continue', dict(id=study['id'], requestId='http-study-resumed'))[1]
                self.assertEqual(continued['requestId'], 'http-study-resumed')
                self.assertEqual(continued['budget']['used'], 2)
                report = dict(schema='pero.paper-agent-report.v1', intentId=study['id'], title='Original method',
                              sections=[dict(heading='Method',content='Original evidence.',paperIds=[pdf_paper['id']],evidence=[evidence])],
                              experiments=[],limitations='Reading only')
                status, finalized = call('POST', '/api/studies/step', dict(studyId=study['id'], action='finalize', report=report))
                self.assertEqual(status, 201)
                self.assertEqual(call('GET', '/api/studies/' + study['id'])[1]['report']['id'], finalized['reportId'])
                exported = call('GET', '/api/reports/' + finalized['reportId'] + '/export?format=markdown')[1]
                self.assertIn('Independent replication is still missing.', exported['content'])
                self.assertEqual(call('GET', '/api/studies?paperId=' + pdf_paper['id'])[1]['studies'][0]['id'], study['id'])
                located = call('POST', '/api/evidence', dict(intentId=study['id'], **evidence))[1]
                self.assertEqual(located['pdf']['pages'], [2])
                self.assertTrue(located['pdf']['rects'])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
