"""One loopback check: UI plans do not grant an Agent mutation authority."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import tempfile
import threading
import unittest
from test_research import NOW, reading
import test_research_programs as acceptance
from paper_agent.http import handler
from paper_agent.model import PaperSnapshot
from paper_agent.store import ResearchStore


class ProgramHTTP(unittest.TestCase):
    def test_plan_binding_and_real_caller(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'private', now=lambda: NOW))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def call(path, value, internal=False):
                connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                headers = {'Content-Type': 'application/json', 'X-Pero-App-Token': 'private'}
                if internal:
                    headers['X-Pero-Research-Internal'] = '1'
                connection.request('POST', path, json.dumps(value), headers)
                response = connection.getresponse()
                status, result = response.status, json.loads(response.read())
                connection.close()
                return status, result

            try:
                status, plan = call('/api/programs', acceptance.ResearchProgramsAcceptance.plan(paper))
                self.assertEqual(status, 200)
                screen = dict(operation='screen', programId=plan['id'], expectedCheckpoint=plan['checkpoint'],
                              operationId='screen', candidateId=plan['candidates'][0]['id'], decision='exclude', reason='Outside scope')
                self.assertEqual(call('/api/programs', screen)[0], 403)
                self.assertEqual(call('/internal/research-program', screen)[0], 403)
                self.assertEqual(call('/internal/research-program', {**screen, 'threadId': 'unbound'}, True)[0], 403)
                _, descriptor = call('/api/programs', dict(operation='launch', programId=plan['id']))
                binding = dict(operation='bind', programId=plan['id'], protocolDigest=descriptor['context']['protocolDigest'], threadId='owner')
                self.assertEqual(call('/internal/research-program', binding, True)[0], 200)
                self.assertEqual(call('/internal/research-program', {**binding, 'threadId': 'other'}, True)[0], 409)
                self.assertEqual(call('/internal/research-program', {**screen, 'threadId': 'other'}, True)[0], 403)
                status, changed = call('/internal/research-program', {**screen, 'threadId': 'owner'}, True)
                self.assertEqual(status, 200)
                self.assertEqual(changed['candidates'][0]['decision'], 'exclude')
            finally:
                server.shutdown()
                thread.join(3)
                server.server_close()
