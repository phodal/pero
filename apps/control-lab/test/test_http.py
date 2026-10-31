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
from control_lab.experiments import ExperimentSpec
from test_verification import observed


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
                goal = {'experimentId':created['id'],'specHash':created['specHash']}
                self.assertEqual(request('/api/agent-step',{'action':'read',**goal})['specHash'],created['specHash'])
                other=request('/api/experiments',{'templateId':'p-golden'})
                exported=request('/api/experiments/'+created['id']+'/export')
                self.assertEqual(exported['experiment']['specHash'],created['specHash'])
                self.assertIn('sourceHashes',exported['exportProvenance'])
                for data in (
                    {'action':'create','templateId':'robust-pid',**goal},
                    {'action':'list',**goal},
                    {'action':'read',**goal,'criteria':{'steadyErrorMax':.5}},
                    {'action':'search',**goal,'candidateBudget':30},
                    {'action':'search',**goal,'budget':2},
                    {'action':'baseline',**goal,'budget':1},
                    {'action':'search-next',**goal,'candidateBudget':2},
                    {'action':'baseline',**goal,'specHash':'0'*64},
                    {'action':'search-next',**goal,'experimentId':other['id']},
                    {'action':'propose',**goal,'parameters':{'horizon':60}},
                    {'action':[], **goal},
                    {'action':{}, **goal},
                    {'action':'read','specHash':created['specHash']},
                    {'action':'read',**goal,'experimentId':[]},
                    {'action':'read',**goal,'experimentId':'not-an-id'},
                    {'action':'read','experimentId':created['id']},
                    {'action':'read',**goal,'specHash':'0'*64},
                    {'action':'read',**goal,'experimentId':other['id']},
                    {'action':'read',**goal,'specHash':[]},
                    {'action':'search',**goal,'specHash':'0'*64},
                ):
                    with self.subTest(data=data), self.assertRaises(HTTPError) as denied:
                        request('/api/agent-step',data)
                    self.assertEqual(denied.exception.code,400)
                self.assertEqual(request('/api/experiments/'+created['id'])['status'],'idle')
                with store.lock:
                    store.records[created['id']]['criteria']['steadyErrorMax'] = .5
                with self.assertRaises(HTTPError) as denied:
                    request('/api/agent-step',{'action':'read',**goal})
                self.assertEqual(denied.exception.code,400)
            finally:
                server.shutdown();worker.join();server.server_close();store.close()

    def test_agent_goal_actions_release_the_store_lock(self):
        spec=ExperimentSpec.parse({'templateId':'pi-golden','candidateBudget':1})
        def execute(_engine,_model,_parameters,_scenario,_directory,_cancelled):
            return observed(spec).to_dict()
        with tempfile.TemporaryDirectory() as root:
            store=ExperimentStore(root,execute)
            server=ThreadingHTTPServer(('127.0.0.1',0),handler(store,'test-token'))
            worker=threading.Thread(target=server.serve_forever);worker.start()
            def request(data):
                headers={'X-Pero-App-Token':'test-token','Content-Type':'application/json'}
                with urlopen(Request(f'http://127.0.0.1:{server.server_port}/api/agent-step',json.dumps(data).encode(),headers),timeout=3) as response:
                    return json.load(response)
            try:
                record=store.create({'templateId':'pi-golden','candidateBudget':1})
                other=store.create({'templateId':'p-golden','candidateBudget':1})
                goal={'experimentId':record['id'],'specHash':record['specHash']}
                with self.assertRaises(HTTPError) as denied:
                    request({'action':'search',**goal,'experimentId':other['id']})
                self.assertEqual(denied.exception.code,400)
                self.assertEqual(store.read(other['id'])['status'],'idle')
                request({'action':'baseline',**goal})
                store.worker.join(timeout=3)
                self.assertFalse(store.worker.is_alive(),'search must release the store lock')
                self.assertEqual(store.read(record['id'])['status'],'completed')
                request({'action':'lock',**goal,'candidateId':'baseline'})
                request({'action':'verify',**goal})
                store.worker.join(timeout=3)
                self.assertFalse(store.worker.is_alive(),'verification must release the store lock')
                report=store.read(record['id'])['report']
                self.assertEqual(request({'action':'reevaluate',**goal})['report']['id'],report['id'])
            finally:
                server.shutdown();worker.join();server.server_close();store.close()


if __name__=='__main__':unittest.main()
