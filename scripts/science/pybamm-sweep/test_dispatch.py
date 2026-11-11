from dataclasses import asdict, replace
import json
import unittest

from bundle import ROOT, load_identity
from check import read_results
from contract import digest, encoded
from dispatch import Batch, Binding, Observation, summarize, task_prompt


class BatchReportTests(unittest.TestCase):
    def test_run_status_and_evidence(self):
        identity = load_identity()
        result = next(iter(read_results(ROOT / 'reference.jsonl').values()))
        binding = Binding(result.experiment.id, 'worker-a', 'task-a', 'run-a')
        content = encoded(asdict(result)).decode() + '\n'
        envelope = {'content': content, 'sha256': digest(content.encode()), 'path': 'result.jsonl'}
        message = json.dumps(envelope)
        observed = Observation('run-a', 'worker-a', 1, 'succeeded', 'completed',
                               task_prompt(binding.experiment, identity.sha256), (message,), False)
        for label, value, verification in [
            ('verified', observed, 'consistent'),
            ('duplicate', replace(observed, result_messages=(message, message)), 'consistent'),
            ('missing', replace(observed, result_messages=()), 'missing'),
            ('truncated', replace(observed, truncated=True), 'missing'),
            ('conflict', replace(observed, result_messages=(message, '{}')), 'needs_review'),
            ('old attempt', replace(observed, run='old-run'), 'needs_review'),
            ('foreign worker', replace(observed, worker='worker-b'), 'needs_review'),
            ('wrong digest', replace(observed, result_messages=(json.dumps({**envelope, 'sha256': 'bad'}),)), 'needs_review'),
            ('failed', replace(observed, status='failed'), 'not_checked'),
            ('cancelled', replace(observed, status='cancelled'), 'not_checked'),
            ('reconcile', replace(observed, status='reconcile'), 'not_checked'),
            ('queued', replace(observed, status='queued'), 'not_checked'),
        ]:
            with self.subTest(label=label):
                row = summarize(binding, value, result, identity)
                self.assertEqual(row.verification, verification)
                self.assertEqual(row.state, value.status)

    def test_receipts_do_not_change_batch_identity(self):
        identity = load_identity()
        batch = Batch('fixed', 'http://127.0.0.1', 'p', 'w', 'a', identity.sha256,
                      tuple(Binding(e.id, f'worker-{i % 2}') for i, e in enumerate(identity.method.experiments)))
        completed = replace(batch, items=tuple(replace(item, task='t' + str(i), run='r' + str(i))
                                               for i, item in enumerate(batch.items)))
        self.assertEqual(completed.key, batch.key)
        for changed in (replace(batch, items=batch.items[:-1]), replace(batch, method_sha256='stale')):
            with self.assertRaises(ValueError):
                Batch.parse(asdict(changed), identity)


if __name__ == '__main__':
    unittest.main()
