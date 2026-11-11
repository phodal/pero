from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'apps/compute/backend'))
from task_reports import TaskReport, read_report, save_report


def fixture():
    source = ROOT / 'scripts/science/pybamm-sweep'
    results = [json.loads(line) for line in (source / 'reference.jsonl').read_text().splitlines()]
    rows, details = [], {}
    for index, result in enumerate(results):
        experiment = result['experiment']['id']
        content = json.dumps(result) + '\n'
        digest = hashlib.sha256(content.encode()).hexdigest()
        rows.append(dict(experiment=experiment, task=f'task-{index}', run=f'run-{index}', worker=f'worker-{index % 2}',
                         state='succeeded', verification='consistent', reason='', hostname=result['hostname'],
                         result_sha256=digest, result_path=f'{experiment}/result.jsonl'))
        details[experiment] = {'events': [{'data': {'content': {'text': 'PERO_PYBAMM_RESULT ' + json.dumps(
            {'sha256': digest, 'content': content, 'path': f'{experiment}/result.jsonl'})}}}, {'text': 'retained process log'}]}
    return dict(schema='pero.pybamm-report.v1', batch='pybamm-ui-fixture', name='Six frozen experiments',
                observed_at='2026-11-11T10:00:00+00:00', denominator=6, method=json.loads((source / 'manifest.json').read_text()),
                method_sha256=results[0]['method_sha256'], rows=rows, details=details)


class TaskReportTests(unittest.TestCase):
    def test_complete_denominator_bytes_and_recorded_states(self):
        original = fixture()
        for state in ('succeeded', 'failed', 'cancelled', 'reconcile', 'queued', 'missing', 'unavailable'):
            with self.subTest(state=state):
                value = deepcopy(original)
                value['rows'][0].update(state=state, verification='consistent' if state == 'succeeded' else 'not_checked')
                report = TaskReport.parse(value)
                self.assertEqual(len(report.rows), 6)
                self.assertEqual(report.rows[0].state, state)
                self.assertIn('retained process log', report.rows[0].record)
                self.assertEqual(hashlib.sha256(report.rows[0].content.encode()).hexdigest(), report.rows[0].result_sha256)
                self.assertEqual(report.view()['consistent'], 6 if state == 'succeeded' else 5)
        missing = deepcopy(original)
        missing['rows'][0].update(state='missing', verification='missing', result_sha256='')
        missing['details'].pop(missing['rows'][0]['experiment'])
        self.assertIsNone(TaskReport.parse(missing).rows[0].content)

    def test_invalid_imports_do_not_replace_saved_report(self):
        original = fixture()
        changes = [lambda v: v['rows'].pop(), lambda v: v['rows'][0].update(experiment=v['rows'][1]['experiment']),
                   lambda v: v['rows'][0].update(state='cancelled'), lambda v: v['rows'][0].update(result_sha256='wrong'),
                   lambda v: v.update(observed_at='2026-11-11'), lambda v: v.update(method={}),
                   lambda v: v['details'][v['rows'][0]['experiment']].update(events=[None]),
                   lambda v: v['details'][v['rows'][0]['experiment']].update(events=[{'data': []}])]
        with tempfile.TemporaryDirectory() as directory:
            save_report(directory, TaskReport.parse(original))
            for change in changes:
                value = deepcopy(original); change(value)
                with self.assertRaises(ValueError):
                    save_report(directory, TaskReport.parse(value))
                self.assertEqual(json.loads(read_report(directory)['raw']), original)


if __name__ == '__main__':
    print(json.dumps(fixture()))
