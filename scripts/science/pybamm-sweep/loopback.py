"""Opt-in real PostgreSQL / Go / Rust Worker / PyBaMM acceptance on ONE machine."""
import argparse
from dataclasses import asdict, replace
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
from urllib.parse import quote
from urllib.error import HTTPError
from urllib.request import urlopen
import uuid

from bundle import ROOT, load_identity
from dispatch import Batch, Binding
from tasks import ControlPlane, collect, save, submit


def wait_for(condition, label, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = condition()
        if value:
            return value
        # Bounded polling of external state, never ordering an in-process race by delay.
        time.sleep(0.02)
    raise TimeoutError(label)


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main(args):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    identity = load_identity()
    token = uuid.uuid4().hex
    processes, handles = [], []
    postgres_started = False
    with tempfile.TemporaryDirectory(prefix='pero-p59-') as temporary:
        temporary = Path(temporary)
        db = temporary / 'db'
        def launch(command, name, env=None):
            log = (output / (name + '.log')).open('w')
            handles.append(log)
            process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=env)
            processes.append(process)
            return process
        try:
            subprocess.run(['initdb', '-D', str(db), '-U', 'postgres', '-A', 'trust', '--no-locale'],
                           check=True, stdout=(output / 'initdb.log').open('w'), stderr=subprocess.STDOUT)
            subprocess.run(['pg_ctl', '-D', str(db), '-l', str(output / 'postgres.log'),
                            '-o', f"-k {temporary} -h ''", '-w', 'start'], check=True, capture_output=True)
            postgres_started = True
            database = 'postgresql://postgres@localhost/postgres?host=' + quote(str(temporary), safe='')
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            origin = f'http://127.0.0.1:{port}'
            server_env = {**os.environ, 'PERO_DATABASE_URL': database, 'PERO_OPERATOR_TOKEN': token,
                          'PERO_LISTEN': f'127.0.0.1:{port}', 'PERO_LEASE_SECONDS': '10',
                          'PERO_GITHUB_REPOSITORIES': '', 'PERO_SANDBOX_CONFIG': ''}
            launch([str(args.server_bin)], 'server', server_env)
            def ready():
                try:
                    with urlopen(origin + '/healthz', timeout=1) as response:
                        return response.status == 200
                except OSError:
                    return False
            wait_for(ready, 'Control plane readiness')
            api = ControlPlane(origin, token)
            workers = []
            for index in range(2):
                credential = api.request('/api/v1/workers', {'name': f'loopback-{index}', 'projects': ['pybamm59']})
                workspace = output / f'worker-{index}'
                workspace.mkdir()
                config = output / f'worker-{index}.json'
                agents = output / f'agents-{index}.json'
                save(agents, [{'id': 'pybamm-sweep-v1', 'name': 'Frozen PyBaMM method', 'command': str(args.python),
                               'args': [str(ROOT / 'acp.py'), '--workspace', str(workspace)], 'env': {}}])
                save(config, {'workspaces': {'battery': str(workspace)}, 'agents_file': str(agents)})
                env = {**os.environ, 'PERO_CLOUD_URL': origin, 'PERO_WORKER_TOKEN': credential['token'],
                       'PERO_WORKER_CONFIG': str(config), 'PERO_WORKER_STATE': str(output / f'journal-{index}.json')}
                workers.append((credential['worker']['id'], env, agents))
            batch = Batch('local-consistency', origin, 'pybamm59', 'battery', 'pybamm-sweep-v1', identity.sha256,
                          tuple(Binding(e.id, workers[i % 2][0]) for i, e in enumerate(identity.method.experiments)))
            plan = output / 'plan.json'
            batch = submit(api, batch, plan)
            running = [launch([str(args.worker_bin)], f'worker-{i}-normal', worker[1]) for i, worker in enumerate(workers)]
            def completed():
                report = collect(api, batch, ROOT / 'reference.jsonl')
                save(output / 'normal-progress.json', report)
                return report if all(row['state'] == 'succeeded' for row in report['rows']) else None
            report = wait_for(completed, 'All six real calculations', timeout=120)
            assert report['consistent'] == 6, report['rows']
            assert [sum(row['worker'] == worker[0] for row in report['rows']) for worker in workers] == [3, 3]
            assert len({row['hostname'] for row in report['rows']}) == 1, 'This test must not claim two-machine acceptance'
            save(output / 'normal-report.json', report)
            again = submit(api, batch, plan)
            assert again == batch
            assert len(api.request('/api/v1/tasks')['tasks']) == 6
            for item in batch.items:
                detail = report['details'][item.experiment]
                run = detail['run']
                worker = next(w for w in workers if w[0] == item.worker)
                worker_api = ControlPlane(origin, worker[1]['PERO_WORKER_TOKEN'])
                binding = {'instance_id': run['instance_id'], 'generation': run['generation']}
                worker_api.request('/api/worker/v1/runs/' + run['id'] + '/events',
                                   {**binding, 'events': detail['events']})
                repeated = worker_api.request('/api/worker/v1/runs/' + run['id'] + '/complete',
                                              {**binding, 'outcome': run['status'], 'summary': run['summary']})
                assert repeated['id'] == run['id']
                assert api.request('/api/v1/tasks/' + item.task)['events'] == detail['events']
                changed = {**detail['events'][-1], 'text': 'conflicting late result'}
                try:
                    worker_api.request('/api/worker/v1/runs/' + run['id'] + '/events',
                                       {**binding, 'events': [changed]})
                except HTTPError as error:
                    assert error.code == 409
                else:
                    raise AssertionError('Conflicting late event was accepted')
            for process in running:
                stop(process)
            assert len(list(output.glob('worker-*/pybamm-results/*/result.jsonl'))) == 6

            # A separate, explicitly named six-item fault batch retains unexecuted rows.
            faults = replace(batch, name='local-faults', items=tuple(replace(item, task='', run='') for item in batch.items))
            faults = submit(api, faults, output / 'fault-plan.json')
            def detail(index):
                return api.request('/api/v1/tasks/' + faults.items[index].task)
            def started(index):
                for event in detail(index)['events']:
                    text = (event.get('data') or {}).get('content', {}).get('text', '')
                    if text.startswith('PERO_PYBAMM_START '):
                        return json.loads(text.removeprefix('PERO_PYBAMM_START '))
                return None

            # Real incompatible Python environment: execution fails before importing/solving PyBaMM.
            agents = json.loads(workers[0][2].read_text())
            original = agents[0]['command']
            agents[0]['command'] = str(args.unprepared_python)
            save(workers[0][2], agents)
            failed = launch([str(args.worker_bin), '--once'], 'worker-failed-environment', workers[0][1])
            failed.wait(timeout=45)
            assert detail(0)['run']['status'] == 'failed', detail(0)
            agents[0]['command'] = original
            save(workers[0][2], agents)

            cancelled = launch([str(args.worker_bin), '--once'], 'worker-cancel', workers[1][1])
            start = wait_for(lambda: started(1), 'Actual calculation process start')
            os.kill(start['pid'], signal.SIGSTOP)  # Hold the actual child so cancellation is deterministic.
            busy = ControlPlane(origin, workers[1][1]['PERO_WORKER_TOKEN']).request(
                '/api/worker/v1/claims', {'request_id': 'busy-slot-check', 'instance_id': 'second-instance'})
            assert busy['run'] is None, 'A second instance exceeded the Worker slot'
            api.request('/api/v1/tasks/' + faults.items[1].task + '/cancel', {})
            cancelled.wait(timeout=45)
            wait_for(lambda: not alive(start['pid']), 'Cancelled child has stopped')
            assert detail(1)['run']['status'] == 'cancelled', detail(1)

            crashed = launch([str(args.worker_bin), '--once'], 'worker-before-crash', workers[0][1])
            start = wait_for(lambda: started(2), 'Second actual calculation process start')
            os.kill(start['pid'], signal.SIGSTOP)
            crashed.kill()
            crashed.wait()
            wait_for(lambda: not alive(start['pid']), 'Supervisor death cleans actual child')
            restarted = launch([str(args.worker_bin), '--once'], 'worker-after-crash', workers[0][1])
            restarted.wait(timeout=45)
            recovered = detail(2)
            assert recovered['run']['id'] == faults.items[2].run
            assert recovered['run']['status'] in ('failed', 'reconcile'), recovered
            assert sum('PERO_PYBAMM_START ' in (event.get('data') or {}).get('content', {}).get('text', '')
                       for event in recovered['events']) == 1, 'Restart replayed the experiment'
            report = collect(api, faults, ROOT / 'reference.jsonl')
            assert len(report['rows']) == 6 and report['consistent'] == 0
            assert [row['state'] for row in report['rows'][3:]] == ['queued'] * 3
            save(output / 'fault-report.json', report)
            save(output / 'receipt.json', {'normal_consistent': 6, 'denominator': 6, 'workers': 2,
                 'independent_machines': 1, 'fault_states': [row['state'] for row in report['rows']],
                 'duplicate_submit_extra_tasks': 0, 'restart_replayed': False,
                 'repeated_event_and_completion_receipts': 6, 'conflicting_late_events_rejected': 6,
                 'occupied_slot_claimed': False,
                 'method_sha256': identity.sha256, 'scientific_acceptance': 'not_assessed'})
            print((output / 'receipt.json').read_text())
        finally:
            for process in reversed(processes):
                stop(process)
            for handle in handles:
                handle.close()
            if postgres_started:
                subprocess.run(['pg_ctl', '-D', str(db), '-m', 'fast', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('server-bin', 'worker-bin', 'python', 'unprepared-python', 'output'):
        parser.add_argument('--' + option, required=True, type=Path)
    main(parser.parse_args())
