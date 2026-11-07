import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from clusters import ClusterStore
from executions import read_executions

DIGEST = 'ab' * 32


def submission(**extra):
    return {'operation': 'attempt-1', 'cluster': 'site', 'constraints': {'partition': 'cpu', 'cpus': 4, 'memory_mib': 8192, 'walltime_seconds': 3600},
            'payload': DIGEST, 'job_id': 42, 'submit_time': 1_700_000_000, **extra}


class ExecutionReceiptTest(unittest.TestCase):
    def test_owner_receipts_keep_submission_observation_and_absence_distinct(self):
        with TemporaryDirectory() as directory:
            self.assertEqual(read_executions(directory).status, 'none')
            root = Path(directory) / 'executions'
            root.mkdir()
            observed = {'submission': submission(entry='python train.py --lr 3e-4', logs=['stdout.log'],
                                                 outputs=[{'path': 'metrics.json', 'sha256': DIGEST}], snapshot=DIGEST),
                        'states': ['COMPLETED'], 'nodes': 'gpu-07', 'start_time': 1_700_000_100, 'end_time': 1_700_000_250}
            (root / 'observed.json').write_text(json.dumps(observed), encoding='utf-8')
            (root / 'submitted.json').write_text(json.dumps(submission(operation='attempt-2', job_id=7, submit_time=1_700_000_500)), encoding='utf-8')
            recorded = read_executions(directory)
            self.assertEqual(recorded.status, 'recorded')
            self.assertEqual([item['operation'] for item in recorded.executions], ['attempt-2', 'attempt-1'])
            queued, done = recorded.executions
            self.assertIsNone(queued['scheduler'])
            self.assertEqual(queued['entry'], None)
            self.assertEqual(done['scheduler']['states'], ['COMPLETED'])
            self.assertEqual(done['scheduler']['wallSeconds'], 150)
            self.assertEqual(done['scheduler']['nodes'], 'gpu-07')
            self.assertEqual(done['logs'], ['stdout.log'])
            self.assertEqual(done['outputs'], [{'path': 'metrics.json', 'sha256': DIGEST}])
            self.assertEqual(done['constraints']['memoryMib'], 8192)
            state = ClusterStore(directory).state()
            self.assertIsNone(state['jobs'])
            self.assertEqual(state['jobsStatus'], 'not_connected')
            self.assertEqual(state['executionsStatus'], 'recorded')

    def test_a_bad_receipt_is_unreadable_and_does_not_become_an_empty_queue(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / 'executions'
            root.mkdir()
            for name, body in [
                ('late.json', {**submission(), 'end_time': 1}),
                ('zero.json', submission(job_id=0)),
                ('outside.json', submission(logs=['../secret'])),
                ('science.json', submission(verdict='pass')),
            ]:
                (root / name).write_text(json.dumps(body), encoding='utf-8')
                read = read_executions(directory)
                self.assertEqual(read.status, 'unreadable', name)
                self.assertIsNone(ClusterStore(directory).state()['executions'])
                self.assertIsNone(ClusterStore(directory).state()['jobs'])
                (root / name).unlink()
            (root / 'link.json').symlink_to(root / 'missing.json')
            self.assertEqual(read_executions(directory).status, 'unreadable')

    def test_a_process_receipt_is_not_a_scheduler_job(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / 'executions'
            root.mkdir()
            (root / 'process.json').write_text(json.dumps({
                'operation': 'use', 'host': 'host', 'payload': DIGEST, 'started': 10, 'ended': 20,
                'exit_code': 0, 'entry': '/bin/sh -c true', 'snapshot': DIGEST,
                'logs': ['stdout.log', 'stderr.log'],
            }), encoding='utf-8')
            (root / 'batch.json').write_text(json.dumps(submission()), encoding='utf-8')
            recorded = read_executions(directory)
            self.assertEqual(recorded.status, 'recorded')
            process = next(item for item in recorded.executions if item['jobId'] is None)
            self.assertEqual(process['host'], 'host')
            self.assertEqual(process['exitCode'], 0)
            self.assertEqual(process['wallMilliseconds'], 10)
            self.assertIsNone(process['scheduler'])
            self.assertIsNone(process['constraints'])
            self.assertIsNone(ClusterStore(directory).state()['jobs'])
            (root / 'process.json').write_text(json.dumps({
                'operation': 'use', 'host': 'host', 'payload': DIGEST, 'started': 10, 'verdict': 'pass',
            }), encoding='utf-8')
            self.assertEqual(read_executions(directory).status, 'unreadable')


if __name__ == '__main__':
    unittest.main()
