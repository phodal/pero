from http.server import ThreadingHTTPServer
import json
import pathlib
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request,urlopen
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'backend'))
from control_lab.http import handler
from control_lab.store import ExperimentStore


class HttpTest(unittest.TestCase):
    def test_same_frozen_ledger_through_app_and_agent_routes(self):
        with tempfile.TemporaryDirectory() as root:
            store=ExperimentStore(root)
            server=ThreadingHTTPServer(('127.0.0.1',0),handler(store,'test-token'))
            worker=threading.Thread(target=server.serve_forever);worker.start()
            def request(path,data=None,token='test-token'):
                headers={'X-Pero-App-Token':token,'Content-Type':'application/json'}
                body=None if data is None else json.dumps(data).encode()
                with urlopen(Request(f'http://127.0.0.1:{server.server_port}'+path,body,headers),timeout=3) as response:
                    return json.load(response)
            try:
                with self.assertRaises(HTTPError) as denied:request('/api/experiments',token='wrong')
                self.assertEqual(denied.exception.code,401)
                created=request('/api/experiments',{'templateId':'robust-pid','candidateBudget':2})
                self.assertEqual(created['candidateBudget'],2)
                self.assertEqual(request('/api/experiments/'+created['id'])['specHash'],created['specHash'])
                self.assertEqual(request('/api/agent-step',{'action':'read','experimentId':created['id']})['specHash'],created['specHash'])
                exported=request('/api/experiments/'+created['id']+'/export')
                self.assertEqual(exported['experiment']['specHash'],created['specHash'])
                self.assertIn('sourceHashes',exported['exportProvenance'])
                for data in (
                    {'action':'create','templateId':'robust-pid'},
                    {'action':'list'},
                    {'action':'read','experimentId':created['id'],'criteria':{'steadyErrorMax':.5}},
                    {'action':'search','experimentId':created['id'],'candidateBudget':30},
                    {'action':'search','experimentId':created['id'],'budget':2},
                    {'action':'propose','experimentId':created['id'],'parameters':{'horizon':60}},
                    {'action':[], 'experimentId':created['id']},
                    {'action':{}, 'experimentId':created['id']},
                    {'action':'read'},
                    {'action':'read','experimentId':[]},
                    {'action':'read','experimentId':'not-an-id'},
                ):
                    with self.subTest(data=data), self.assertRaises(HTTPError) as denied:
                        request('/api/agent-step',data)
                    self.assertEqual(denied.exception.code,400)
            finally:
                server.shutdown();worker.join();server.server_close();store.close()


if __name__=='__main__':unittest.main()
