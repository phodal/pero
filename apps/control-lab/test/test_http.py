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
                created=request('/api/agent-step',{'action':'create','templateId':'robust-pid','candidateBudget':2})
                self.assertEqual(created['candidateBudget'],2)
                self.assertEqual(request('/api/experiments/'+created['id'])['specHash'],created['specHash'])
                self.assertEqual(request('/api/agent-step',{'action':'read','experimentId':created['id']})['specHash'],created['specHash'])
                exported=request('/api/experiments/'+created['id']+'/export')
                self.assertEqual(exported['experiment']['specHash'],created['specHash'])
                self.assertIn('sourceHashes',exported['exportProvenance'])
                with self.assertRaises(HTTPError):request('/api/agent-step',{'action':'create','templateId':'robust-pid','candidateBudget':31})
            finally:
                server.shutdown();worker.join();server.server_close();store.close()


if __name__=='__main__':unittest.main()
