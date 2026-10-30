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



            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
