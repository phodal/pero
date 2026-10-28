"""Host adapter boundaries, immutable replay and parity with domain operations."""
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import fixture
from baselines import run_baseline
from dataset import training_view
from evaluation import test_queries
from contract import Invalid, canonical
from evaluation import evaluate
from candidates import propose
from server import authenticated, handler
from workbench import Workbench

EXAMPLE = Path(__file__).parents[1] / "examples/synthetic.json"


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.workbench = Workbench(self.directory.name)
        self.bundle = json.loads(EXAMPLE.read_text())

    def test_domain_parity_immutable_replay_and_restart(self):
        revision = self.workbench.import_bundle(self.bundle)
        identity = revision["id"]
        for operation in ("split", "queries", "evaluate", "candidates"):
            with self.subTest(operation=operation):
                output = self.workbench.execute(identity, operation)
                self.assertEqual(output, self.workbench.execute(identity, operation))
                self.assertEqual(self.workbench.read(output["id"])["result"], output["result"])
                self.assertEqual(output["acceptance"], "not_reviewed")
        b = self.bundle
        self.assertEqual(self.workbench.execute(identity, "evaluate")["result"], evaluate(b["dataset"], b["spec"], b["split"]))
        self.assertEqual(self.workbench.execute(identity, "candidates")["result"], propose(b["dataset"], b["spec"], b["split"], b["plan"]))
        self.assertEqual(Workbench(self.directory.name).catalog()["items"][0], revision)

    def test_rejects_stale_split_unbounded_data_and_unknown_operations(self):
        self.bundle["split"]["digest"] = "stale"
        with self.assertRaisesRegex(Invalid, "split_digest_mismatch"):
            self.workbench.import_bundle(self.bundle)
        data = {"dataset": {"genes": ["g"] * 20000, "conditions": [{}] * 101}, "spec": {}}
        with self.assertRaisesRegex(Invalid, "web_dataset_limit"):
            self.workbench.import_bundle(data)
        with self.assertRaisesRegex(Invalid, "operation_invalid"):
            self.workbench.execute("ignored", "exec")

    def test_artifact_path_and_integrity_are_checked(self):
        with self.assertRaisesRegex(Invalid, "artifact_id_invalid"):
            self.workbench.read("../../credentials")
        revision = self.workbench.import_bundle(self.bundle)
        (Path(self.directory.name) / (revision["id"] + ".json")).write_text('{}')
        with self.assertRaisesRegex(Invalid, "artifact_digest_mismatch"):
            self.workbench.read(revision["id"])

    def test_missing_plan_does_not_create_a_proposal(self):
        del self.bundle["plan"]
        revision = self.workbench.import_bundle(self.bundle)
        self.assertFalse(revision["hasPlan"])
        with self.assertRaisesRegex(Invalid, "candidate_plan_required"):
            self.workbench.execute(revision["id"], "candidates")

    def test_imported_prediction_is_compared_without_replacing_baselines(self):
        b = self.bundle
        prediction = run_baseline('additive', b['split'], training_view(b['dataset'], b['split']), test_queries(b['dataset'], b['split']))
        prediction['model']['id'] = 'external-additive'
        from contract import sealed
        prediction = sealed(prediction)
        b['predictions'] = [prediction]
        revision = self.workbench.import_bundle(b)
        models = self.workbench.execute(revision['id'], 'evaluate')['result']['models']
        self.assertEqual([m['model']['id'] for m in models], ['control', 'train_mean', 'additive', 'external-additive'])
        self.assertEqual(models[-1]['delta_mse'], models[-2]['delta_mse'])
        self.assertEqual(models[-1]['acceptance']['status'], 'not_reviewed')

    def test_raw_documents_and_export_preserve_pinned_python_numbers(self):
        original = EXAMPLE.read_text()
        imported = self.workbench.import_documents([original])
        exported = canonical(self.workbench.read(imported["id"])["bundle"]).decode()
        self.assertEqual(self.workbench.import_documents([exported]), imported)
        separate = [canonical(self.bundle[key]).decode() for key in ("dataset", "spec", "split", "plan")]
        self.assertEqual(self.workbench.import_documents(separate), imported)
        with self.assertRaisesRegex(Invalid, "duplicate_input_document"):
            self.workbench.import_documents([original, original])


class ProxyTests(unittest.TestCase):
    def test_backend_token_requires_a_nonempty_matching_secret(self):
        for secret, token, allowed in [('test-secret', 'test-secret', True), ('test-secret', '', False), ('', '', False), ('test-secret', 'wrong-secret', False)]:
            with self.subTest(secret=secret, token=token):
                self.assertEqual(authenticated(secret, token), allowed)

    def test_real_http_refuses_direct_access_and_accepts_host_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            service = ThreadingHTTPServer(('127.0.0.1', 0), handler(Workbench(directory), 'test-secret'))
            worker = threading.Thread(target=service.serve_forever)
            worker.start()
            try:
                base = f'http://127.0.0.1:{service.server_port}'
                with self.assertRaises(HTTPError) as caught:
                    urlopen(base + '/api/inputs')
                self.assertEqual(caught.exception.code, 401)
                caught.exception.close()
                def post(path, value):
                    body = canonical(value)
                    with urlopen(Request(base + path, data=body, headers={'Content-Type': 'application/json', 'X-Pero-App-Token': 'test-secret'})) as response:
                        return json.load(response)
                revision = post('/api/inputs', {'documents': [EXAMPLE.read_text()]})
                output = post('/api/execute', {'inputId': revision['id'], 'operation': 'evaluate'})
                self.assertEqual(len(output['result']['models']), 3)
                self.assertFalse(output['result']['blind'])
            finally:
                service.shutdown()
                worker.join()
                service.server_close()
