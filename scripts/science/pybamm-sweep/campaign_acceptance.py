"""Exercise two actual PyBaMM rounds through Pero, Temporal and a Rust Worker."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
from threading import Event, Thread
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import uuid

from bundle import ROOT, load_identity
from contract import digest
from dispatch import ACCEPTANCE, task_prompt
from loopback import alive, stop, wait_for
from tasks import ControlPlane, save


def free_port():
    with socket.socket() as reserved:
        reserved.bind(('127.0.0.1', 0))
        return reserved.getsockname()[1]


def status_error(status, action):
    try:
        action()
    except HTTPError as error:
        assert error.code == status, (error.code, error.read())
        return json.load(error)
    raise AssertionError(f'Expected HTTP {status}')


def dispatch_proxy(stack, origin):
    dropped = Event()

    class Proxy(BaseHTTPRequestHandler):
        def dispatch(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            request = Request(origin + self.path, method=self.command, data=body,
                              headers={key: self.headers[key] for key in ('Content-Type', 'Authorization')})
            try:
                response = urlopen(request, timeout=10)
            except HTTPError as error:
                response = error
            with response:
                payload = response.read()
                if response.status == 200 and self.path.endswith('/trials/0/ensure') and not dropped.is_set():
                    dropped.set()
                    self.close_connection = True
                    return
                self.send_response(response.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        do_POST = do_PUT = dispatch

        def log_message(self, *_):
            pass

    proxy = stack.enter_context(ThreadingHTTPServer(('127.0.0.1', 0), Proxy))
    thread = Thread(target=proxy.serve_forever, daemon=True)
    thread.start()
    stack.callback(thread.join)
    stack.callback(proxy.shutdown)
    return f'http://127.0.0.1:{proxy.server_port}', dropped


def acceptance(args):
    database = urlparse(args.database)
    hosts = parse_qs(database.query).get('host', [])
    if (database.scheme not in ('postgres', 'postgresql') or
            database.hostname not in (None, '127.0.0.1', 'localhost', '::1') or
            any(not Path(host).is_absolute() for host in hosts)):
        raise ValueError('Use a disposable local PostgreSQL database for fault injection')
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    token = uuid.uuid4().hex
    identity = load_identity()
    unique = uuid.uuid4().hex[:12]
    project = 'pybamm-campaign-' + unique
    cases = ('c05-t298', 'c10-t308')
    temporal_address = f'127.0.0.1:{free_port()}'
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR') if key in os.environ}
    with ExitStack() as stack:
        def launch(binary, name, options=(), **overrides):
            log_path = output / (name + '.log')
            log = stack.enter_context(log_path.open('w'))
            process = subprocess.Popen([str(binary), *options], stdout=log, stderr=subprocess.STDOUT,
                                       env={**env, **overrides})
            stack.callback(stop, process)
            return process, log_path

        def ready(process, log, pattern):
            def check():
                content = log.read_text()
                assert process.poll() is None, content
                return re.search(pattern, content)
            return wait_for(check, f'{log.name} readiness', timeout=25)

        temporal, temporal_log = launch(args.temporal, 'temporal', (
            'server', 'start-dev', '--headless', '--ip', '127.0.0.1', '--port', temporal_address.split(':')[1],
            '--dynamic-config-value', 'frontend.enableServerVersionCheck=false'))
        ready(temporal, temporal_log, r'Temporal Server:')
        server_env = {'PERO_DATABASE_URL': args.database, 'PERO_OPERATOR_TOKEN': token,
                      'PERO_LISTEN': '127.0.0.1:0', 'PERO_LEASE_SECONDS': '6'}

        def control(name, **extra):
            process, log = launch(args.server, name, **server_env, **extra)
            origin = 'http://' + ready(process, log, r'listening on (127\.0\.0\.1:\d+)')[1]
            return process, origin, ControlPlane(origin, token)

        bootstrap, _, admin = control('provision')
        creator = admin.request('/api/v1/clients', {'name': 'Researcher', 'projects': [project]})
        reviewer = admin.request('/api/v1/clients', {'name': 'Reviewer', 'projects': [project]})
        outsider = admin.request('/api/v1/clients', {'name': 'Other project', 'projects': [project + '-other']})
        runner = admin.request('/api/v1/clients', {'name': 'Orchestrator', 'projects': [project]})
        machine = admin.request('/api/v1/workers', {'name': 'Locked CPU method', 'projects': [project]})
        stop(bootstrap)
        _, origin, _ = control('control', PERO_TEMPORAL_ADDRESS=temporal_address,
                               PERO_CAMPAIGN_RUNNER_CLIENT_ID=runner['client']['id'],
                               PERO_PYBAMM_METHOD_DIR=str(ROOT),
                               PERO_PYBAMM_CHECKER_PYTHON=args.checker_python)
        owner, human, foreign, service = (ControlPlane(origin, value['token'])
                                          for value in (creator, reviewer, outsider, runner))
        proxy_origin, dropped = dispatch_proxy(stack, origin)

        def orchestrator(name):
            process, log = launch(args.orchestrator, name, PERO_TEMPORAL_ADDRESS=temporal_address,
                                  PERO_CLOUD_URL=proxy_origin, PERO_CAMPAIGN_RUNNER_TOKEN=runner['token'])
            ready(process, log, 'TaskQueue pero-research-campaigns-v2')
            return process

        first_runner = orchestrator('orchestrator-initial')
        trial = lambda case: {'worker_id': machine['worker']['id'], 'task': {
            'title': case, 'prompt': task_prompt(case, identity.sha256), 'acceptance': ACCEPTANCE,
            'project_id': project, 'workspace_key': 'battery', 'agent_id': 'pybamm-sweep-v1'}}
        base = f'/api/client/v1/projects/{project}/campaigns'
        plan = {'mode': 'pybamm_reviewed_v1', 'trials': [trial(case) for case in cases]}
        admitted = owner.request(base, plan, 'campaign')
        campaign = admitted['plan']['id']
        path = base + '/' + campaign
        wait_for(dropped.is_set, 'committed first dispatch reply was dropped')
        trial_path = f'/api/client/v1/projects/{project}/trial-submissions/{campaign}-trial-'
        first_run = service.request(trial_path + '1')['run']
        status_error(404, lambda: service.request(trial_path + '2'))
        stop(first_runner)
        observing = orchestrator('orchestrator-recover-dispatch')

        workspace = output / 'workspace'
        workspace.mkdir(mode=0o700)
        agents, config = output / 'agents.json', output / 'worker.json'
        save(agents, [{'id': 'pybamm-sweep-v1', 'name': 'Locked CPU method', 'command': args.python,
                       'args': [str(ROOT / 'acp.py'), '--workspace', str(workspace)], 'env': {}}])
        save(config, {'workspaces': {'battery': str(workspace)}, 'agents_file': str(agents)})
        def worker(name):
            process, _ = launch(args.worker, name, PERO_CLOUD_URL=origin, PERO_WORKER_TOKEN=machine['token'],
                                PERO_WORKER_CONFIG=str(config), PERO_WORKER_STATE=str(output / 'worker-state.json'))
            return process

        working = worker('worker')

        def review_gate():
            view = owner.request(path)
            if view['phase'] == 'awaiting_review':
                return view['progress']['review_gate']

        gate = wait_for(review_gate, 'first real solve and independent check', timeout=85)
        check = owner.request(path + '/evidence/0')
        assert check['evidence']['run'] == first_run and check['evidence']['status'] == 'consistent', check
        assert check['review_gate'] == gate and gate['evidence_digest'] == check['evidence']['digest']
        assert len(list(workspace.glob('pybamm-results/*/result.jsonl'))) == 1
        stop(observing)
        orchestrator('orchestrator-recover-review')
        assert wait_for(review_gate, 'recovered review gate') == gate
        status_error(404, lambda: service.request(trial_path + '2'))
        approval = {'gate_id': gate['id'], 'plan_digest': gate['plan_digest'],
                    'evidence_digest': gate['evidence_digest'], 'choice': 'approve'}
        review_path = path + '/review'
        status_error(404, lambda: foreign.request(review_path, approval, 'foreign'))
        status_error(404, lambda: service.request(review_path, approval, 'service'))
        stale = status_error(409, lambda: human.request(review_path, {**approval, 'gate_id': 'stale'}, 'stale'))
        assert 'changed' in stale['error'], stale
        status_error(404, lambda: service.request(trial_path + '2'))
        decision_key = 'decision'
        if args.desktop_review:
            decision_key = 'desktop-' + gate['id'] + '-approve'
            display = {key: os.environ[key] for key in ('DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR')
                       if key in os.environ}
            with (output / 'desktop-review.log').open('w') as desktop_log:
                run = subprocess.run(['node', args.desktop_review], stdout=desktop_log, stderr=subprocess.STDOUT,
                                     env={**env, **display, 'PERO_TEST_HEADED': os.environ.get('PERO_TEST_HEADED', '0'),
                                          'PERO_TEST_SOFTWARE_GL': os.environ.get('PERO_TEST_SOFTWARE_GL', '0'),
                                          'PERO_CAMPAIGN_LOCALE': os.environ.get('PERO_CAMPAIGN_LOCALE', 'en'),
                                          'PERO_CAMPAIGN_ORIGIN': origin, 'PERO_CAMPAIGN_REVIEWER': reviewer['token'],
                                          'PERO_CAMPAIGN_PROJECT': project, 'PERO_CAMPAIGN_ID': campaign,
                                          'PERO_CAMPAIGN_OUTPUT': str(output)}, timeout=300)
            assert run.returncode == 0, (output / 'desktop-review.log').read_text()
            accepted = owner.request(path)['decision']
            repeated = human.request(review_path, approval, decision_key)
        else:
            with ThreadPoolExecutor(max_workers=2) as pool:
                attempts = [pool.submit(human.request, review_path, approval, decision_key) for _ in range(2)]
                accepted, repeated = (attempt.result() for attempt in attempts)
        assert accepted == repeated and accepted['reviewer_id'] == reviewer['client']['id']
        status_error(409, lambda: human.request(review_path, {**approval, 'choice': 'reject'}, decision_key))
        done = wait_for(lambda: owner.request(path).get('result'), 'two verified rounds', timeout=85)
        assert done['outcome'] == 'execution_completed' and done['decision'] == accepted, done
        assert len(done['trials']) == len(done['evidence']) == 2
        assert human.request(review_path, approval, decision_key) == accepted
        assert service.request(trial_path + '1')['run'] == first_run
        assert len(list(workspace.glob('pybamm-results/*/result.jsonl'))) == 2
        starts = []
        for index, case in enumerate(cases):
            detail = owner.request(path + f'/evidence/{index}')
            evidence = detail['evidence']
            assert evidence['status'] == 'consistent' and evidence['experiment'] == case
            assert all(evidence[ref] for ref in ('method_digest', 'environment_digest', 'result_digest', 'checker_digest'))
            assert evidence['run'] == done['trials'][index]['run']
            matched = solver_starts(detail)
            assert len(matched) == 1 and matched[0]['experiment'] == case
            local = workspace / 'pybamm-results' / matched[0]['session'] / 'result.jsonl'
            assert digest(local.read_bytes()) == evidence['result_digest']
            starts.extend(matched)
        history_command = [str(args.temporal), 'workflow', 'show', '--address', temporal_address,
                           '--workflow-id', campaign, '--run-id', admitted['workflow_run_id'], '--output', 'json']
        history = wait_for(lambda: completed_history(history_command), 'closed Temporal history')
        save(output / 'history.json', history)
        stop(working)
        dropped.clear()
        cancelled = owner.request(base, plan, 'cancel-in-dispatch')
        cancel_id = cancelled['plan']['id']
        wait_for(dropped.is_set, 'commit before cancelling the queued Run')
        cancel_run = service.request(f'/api/client/v1/projects/{project}/trial-submissions/{cancel_id}-trial-1')['run']
        owner.request(base + '/' + cancel_id + '/cancel', {})
        cancel_result = wait_for(lambda: owner.request(base + '/' + cancel_id).get('result'), 'confirmed queued cancellation')
        assert cancel_result['outcome'] == 'cancelled' and cancel_result['trials'][0]['run'] == cancel_run
        assert cancel_result['trials'][0]['status'] == 'cancelled' and cancel_result['trials'][1]['status'] == 'skipped'
        assert len(list(workspace.glob('pybamm-results/*/result.jsonl'))) == 2

        lost = owner.request(base, plan, 'expired-lease')['plan']['id']
        lost_view = base + '/' + lost
        first_receipt = f'/api/client/v1/projects/{project}/trial-submissions/{lost}-trial-1'

        def read_lease_trial():
            try:
                return service.request(first_receipt)['run']
            except HTTPError as error:
                if error.code != 404:
                    raise
                return None

        leased = wait_for(read_lease_trial, 'leased trial admission')
        detail_path = '/api/v1/tasks/' + leased['task_id']
        controller = ControlPlane(origin, token)
        worker('worker-lease-expiry')
        child = wait_for(lambda: solver_starts(controller.request(detail_path)), 'actual solver start before lease expiry')[0]
        os.kill(child['pid'], signal.SIGSTOP)
        try:
            completed = subprocess.run(['psql', '-X', args.database, '-v', 'ON_ERROR_STOP=1', '-v', 'original=' + leased['run_id']],
                                       input="UPDATE runs SET lease_expires_at=clock_timestamp()-interval '1 second' "
                                             "WHERE id=:'original' AND status='running';\n", text=True,
                                       check=True, capture_output=True, timeout=10)
            assert 'UPDATE 1' in completed.stdout
            wait_for(lambda: not alive(child['pid']), 'expired lease stopped the original local solver')
        finally:
            if alive(child['pid']):
                os.kill(child['pid'], signal.SIGCONT)
        def isolated():
            view = owner.request(lost_view)
            return view['progress'] if view['phase'] == 'pending_reconciliation' else None

        unresolved = wait_for(isolated, 'workflow retained unknown execution')
        assert unresolved['trials'][0]['run'] == leased and unresolved['trials'][0]['status'] == 'reconcile'
        assert unresolved['trials'][1]['status'] == 'not_started' and service.request(first_receipt)['run'] == leased
        status_error(404, lambda: service.request(first_receipt.removesuffix('1') + '2'))
        save(output / 'receipt.json', {'campaign': admitted['plan'], 'workflow_run_id': admitted['workflow_run_id'],
                                       'dropped_dispatch_ack': True, 'physical_starts': starts, 'result': done,
                                       'cancelled_in_dispatch': cancel_result,
                                       'expired_lease': {'original_solver': child, 'progress': unresolved},
                                       'scientific_acceptance': 'not_assessed'})
        print(f'{campaign}: two real solves, two independent checks, one decision and one follow-up')

def solver_starts(detail):
    texts = [item.get('data', {}).get('content', {}).get('text', '') for item in detail['events']
             if item['kind'] == 'session_update']
    return [json.loads(text.removeprefix('PERO_PYBAMM_START ')) for text in texts
            if text.startswith('PERO_PYBAMM_START ')]



def completed_history(command):
    history = json.loads(subprocess.check_output(command, timeout=10))
    if history['events'][-1]['eventType'] != 'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED':
        return None
    scrub_history(history)
    return history


def scrub_history(value):
    if isinstance(value, list):
        for item in value:
            scrub_history(item)
    if isinstance(value, dict):
        if 'identity' in value:
            value['identity'] = 'pybamm-campaign-fixture'
        if value.get('kind') == 'TASK_QUEUE_KIND_STICKY':
            value['name'] = 'pybamm-sticky-fixture'
        if 'message' in value and isinstance(value['message'], str):
            value['message'] = re.sub(r'127\.0\.0\.1:\d+', '127.0.0.1:1', value['message'])
        for item in value.values():
            scrub_history(item)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('server', 'orchestrator', 'worker', 'temporal', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    for name in ('database', 'python', 'checker-python'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--desktop-review', type=Path)
    acceptance(parser.parse_args())
