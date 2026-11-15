"""Offline acceptance-shell ports; no deployed service, Worker, solver or signals."""
from contextlib import redirect_stdout
from dataclasses import asdict
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import deployed
from contract import encoded
from dispatch import PREFIX


class DeployedAcceptanceTests(unittest.TestCase):
    def test_recovery_evidence_and_cleanup_outcomes(self):
        for label, acknowledged, retained, exit_code, cleared, cleanup_error, succeeds in [
            ('pending receipt', 0, True, 0, True, '', True),
            ('already uploaded', 1, False, 0, True, '', True),
            ('expected worker fence', 1, False, 0, True, 'fence', True),
            ('missing pending receipt', 0, False, 0, True, '', False),
            ('recovery transport failure', 1, False, 1, False, '', False),
            ('unfinished reconciliation', 1, False, 0, False, '', False),
            ('cleanup status failure', 1, False, 0, True, 'status', False),
            ('cleanup cancel failure', 1, False, 0, True, 'cancel', False),
            ('cleanup disable failure', 1, False, 0, True, 'disable', False),
        ]:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                operator = root / 'operator.json'
                operator.write_text('{"token":"offline-port-fixture"}')
                binary = root / 'worker'
                binary.write_bytes(b'offline Worker port, never executed')
                output = root / 'evidence'
                tasks, reads, logs = {}, {}, []
                egress = SimpleNamespace(connected=threading.Event(), tunnels=1,
                                         origin='http://127.0.0.1:0', closed=False)
                egress.disconnect = egress.connected.clear
                egress.close = lambda: setattr(egress, 'closed', True)
                identity = deployed.load_identity()
                experiment = identity.method.experiments[0].id
                reference = deployed.read_results(deployed.ROOT / 'reference.jsonl')[experiment]
                content = encoded(asdict(reference)).decode() + '\n'

                def event(text):
                    return {'kind': 'session_update', 'data': {
                        'sessionUpdate': 'agent_message_chunk', 'content': {'text': text}}}

                start = event('PERO_PYBAMM_START {"pid":12345}')
                result = event(PREFIX + json.dumps({'content': content, 'path': 'result.jsonl',
                                                   'sha256': deployed.digest(content.encode())}))

                class ControlPlane:
                    def request(self, path, value=None, key=''):
                        if path == '/api/v1/me':
                            return {'role': 'operator'}
                        if path.endswith('/enroll'):
                            return {'worker': {'id': 'worker'}, 'token': 'offline-worker'}
                        if path == '/api/v1/tasks':
                            case = value['title'].split(': ')[1]
                            tasks[case] = value
                            return {'id': case}
                        case = path.split('/')[4]
                        if path.endswith('/dispatch'):
                            return {'id': 'run-' + case}
                        if path.endswith('/disable'):
                            if cleanup_error == 'fence':
                                raise deployed.HTTPError(path, 409, 'Unresolved Run', {}, None)
                            if cleanup_error == 'disable':
                                raise TimeoutError('offline disable')
                            return {}
                        if path.endswith('/cancel'):
                            if case == 'calculation' and cleanup_error == 'cancel':
                                raise TimeoutError('offline cancel')
                            return {}
                        reads[case] = reads.get(case, 0) + 1
                        cleanup = reads[case] > 1
                        if case == 'calculation' and cleanup and cleanup_error == 'status':
                            raise TimeoutError('offline status')
                        status = {'calculation': 'succeeded', 'cancellation': 'cancelled',
                                  'connection-loss': 'reconcile'}[case]
                        if case == 'calculation' and cleanup and cleanup_error == 'cancel':
                            status = 'running'
                        return {'run': {'id': 'run-' + case, 'worker_id': 'worker', 'generation': 1,
                                        'status': status, 'spec': tasks[case]},
                                'events': [start, result] if case == 'calculation' else [start]}

                def launch(command, env, stdout, **kwargs):
                    logs.append(stdout)
                    case = Path(stdout.name).stem
                    journal = Path(env['PERO_WORKER_STATE'])
                    if case == 'recovered':
                        active = json.loads(journal.read_text())['active']
                        if retained:
                            saved = journal.with_suffix('.retained')
                            saved.mkdir()
                            (saved / 'original.json').write_text(json.dumps(active))
                        if cleared:
                            journal.write_text('{"active":null,"pending_claim":null}')
                    else:
                        attempt = output / 'workspace' / 'pybamm-results' / case
                        attempt.mkdir(parents=True)
                        journal.write_text(json.dumps({'pending_claim': None, 'active': {
                            'run': {'id': 'run-' + case}, 'events': [{**start, 'seq': 1}],
                            'acknowledged': acknowledged}}))
                    code = exit_code if case == 'recovered' else 0
                    return SimpleNamespace(returncode=code, poll=lambda: code)

                args = SimpleNamespace(origin='https://offline.example', operator_file=operator,
                                       worker_bin=binary, python=Path(sys.executable), output=output)
                # These are the command's external HTTP/process/proxy/signal ports.
                with patch.object(deployed, 'ControlPlane', return_value=ControlPlane()), \
                     patch.object(deployed, 'WorkerEgress', return_value=egress), \
                     patch.object(deployed.subprocess, 'run'), \
                     patch.object(deployed.subprocess, 'Popen', side_effect=launch), \
                     patch.object(deployed, 'alive', return_value=False), \
                     patch.object(deployed.os, 'kill'), redirect_stdout(io.StringIO()):
                    if succeeds:
                        deployed.main(args)
                    else:
                        with self.assertRaises((AssertionError, RuntimeError)):
                            deployed.main(args)
                receipt = json.loads((output / 'receipt.json').read_text())
                self.assertEqual(receipt['passed'], succeeds)
                self.assertTrue(egress.closed)
                self.assertTrue(all(log.closed for log in logs))
                self.assertEqual(receipt['worker_disabled'], cleanup_error not in ('disable', 'fence'))
                if succeeds:
                    expected = 'retained_local_receipt' if retained else 'uploaded_server_events'
                    self.assertEqual(receipt['cases'][-1]['recovery_evidence'], expected)
                if cleanup_error and cleanup_error != 'fence':
                    self.assertEqual(len(receipt['cleanup_errors']), 1)


if __name__ == '__main__':
    unittest.main()
