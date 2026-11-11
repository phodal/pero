"""Opt-in real macOS + explicitly named Lima Linux VM acceptance for #59."""
import argparse
from dataclasses import replace
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
from urllib.parse import quote
from urllib.error import HTTPError
from urllib.request import urlopen
import uuid

from bundle import ROOT, load_identity
from dispatch import Batch, Binding
from loopback import wait_for, stop
from tasks import ControlPlane, collect, save, submit


class MachineShell:
    """Local subprocess or explicitly selected Lima transport; never a Task owner."""
    def __init__(self, python, worker, directory, prefix=()):
        self.python, self.worker, self.directory, self.prefix = str(python), str(worker), str(directory), list(prefix)

    def run(self, code, *args, input=None):
        return subprocess.run([*self.prefix, self.python, '-c', code, *map(str, args)],
                              input=input, text=True, capture_output=True, check=True).stdout

    def write(self, name, value):
        path = self.directory + '/' + name
        self.run('import os,pathlib,sys; os.umask(0o077); p=pathlib.Path(sys.argv[1]); p.parent.mkdir(parents=True,exist_ok=True); p.write_text(sys.stdin.read())', path, input=json.dumps(value))
        return path

    def alive(self, pid):
        return self.run('import os,sys\ntry: os.kill(int(sys.argv[1]),0); print("alive")\nexcept ProcessLookupError: print("stopped")', pid).strip() == 'alive'

    def worker_command(self, environment):
        return [*self.prefix, self.python, '-c',
                'import json,os,pathlib,sys; env=json.load(open(sys.argv[1])); pathlib.Path(sys.argv[1]+".pid").write_text(str(os.getpid())); os.execvpe(sys.argv[2],sys.argv[2:],{**os.environ,**env})',
                environment, self.worker, '--once']


def main(args):
    output = args.output.resolve(); output.mkdir(parents=True, exist_ok=False)
    identity = load_identity(); token = uuid.uuid4().hex
    vm_root = '/home/phodal.guest/pybamm59/acceptance-' + uuid.uuid4().hex[:12]
    local = MachineShell(args.python, args.worker_bin, output / 'macos')
    guest = MachineShell(args.guest_python, args.guest_worker, vm_root, ['limactl', 'shell', args.vm, '--'])
    machines = [local, guest]
    processes, handles, credentials, environments = [], [], [], []
    blocked = False; postgres_started = False
    def launch(command, name, env=None):
        handle = (output / (name + '.log')).open('w'); handles.append(handle)
        process = subprocess.Popen(command, stdout=handle, stderr=subprocess.STDOUT, env=env)
        processes.append(process); return process
    def vm_command(*command):
        return subprocess.run([*guest.prefix, *map(str, command)], check=True, capture_output=True, text=True).stdout
    with tempfile.TemporaryDirectory(prefix='pero-p59-vm-') as temporary:
        temporary = Path(temporary); database = temporary / 'db'
        try:
            inventory = {'macos': local.run('import platform; print(platform.platform()); print(platform.node())'),
                         'linux': vm_command('uname', '-a'), 'vm': json.loads(subprocess.check_output(['limactl', 'list', args.vm, '--json'], text=True)),
                         'method_sha256': identity.sha256, 'source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()}
            assert inventory['vm']['status'] == 'Running' and inventory['vm']['vmType'] in ('vz', 'qemu')
            save(output / 'inventory.json', inventory)
            subprocess.run(['initdb', '-D', str(database), '-U', 'postgres', '-A', 'trust', '--no-locale'], check=True,
                           stdout=(output / 'initdb.log').open('w'), stderr=subprocess.STDOUT)
            subprocess.run(['pg_ctl', '-D', str(database), '-l', str(output / 'postgres.log'), '-o', f"-k {temporary} -h ''", '-w', 'start'], check=True, capture_output=True)
            postgres_started = True
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
            origin = f'http://127.0.0.1:{port}'
            launch([str(args.server_bin)], 'server', {**os.environ, 'PERO_DATABASE_URL': 'postgresql://postgres@localhost/postgres?host=' + quote(str(temporary), safe=''),
                   'PERO_OPERATOR_TOKEN': token, 'PERO_LISTEN': f'127.0.0.1:{port}', 'PERO_LEASE_SECONDS': '10',
                   'PERO_GITHUB_REPOSITORIES': '', 'PERO_SANDBOX_CONFIG': ''})
            def ready():
                try:
                    with urlopen(origin + '/healthz', timeout=1) as response: return response.status == 200
                except OSError: return False
            wait_for(ready, 'Control plane readiness')
            guest.write('relay-ready.json', {})
            launch([*guest.prefix, guest.python, str(ROOT / 'vm_relay.py'), 'host.lima.internal', str(port), vm_root + '/relay-ready.json'], 'private-network-relay')
            def relay_ready():
                value = json.loads(guest.run('import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text())', vm_root + '/relay-ready.json'))
                return value.get('port')
            relay_port = wait_for(relay_ready, 'VM private-network relay')
            vm_origin = f'http://127.0.0.1:{relay_port}'
            guest.run('import urllib.request,sys; assert urllib.request.urlopen(sys.argv[1]+"/healthz",timeout=5).status==200', vm_origin)
            api = ControlPlane(origin, token)
            for index, machine in enumerate(machines):
                credential = api.request('/api/v1/workers', {'name': ['macos-physical', 'lima-linux-vm'][index], 'projects': ['pybamm59']})
                credentials.append(credential)
                agents = machine.write('agents.json', [{'id': 'pybamm-sweep-v1', 'name': 'Frozen PyBaMM method', 'command': machine.python,
                    'args': [str(ROOT / 'acp.py'), '--workspace', machine.directory + '/workspace'],
                    'env': {'LD_LIBRARY_PATH': args.guest_library_path} if index and args.guest_library_path else {}}])
                machine.run('import pathlib,sys; pathlib.Path(sys.argv[1]).mkdir(parents=True,exist_ok=True)', machine.directory + '/workspace')
                config = machine.write('config.json', {'workspaces': {'battery': machine.directory + '/workspace'}, 'agents_file': agents})
                environments.append(machine.write('environment.json', {'PERO_CLOUD_URL': vm_origin if index else origin,
                    'PERO_WORKER_TOKEN': credential['token'], 'PERO_WORKER_CONFIG': config, 'PERO_WORKER_STATE': machine.directory + '/journal.json'}))
            batch = Batch('two-machine-consistency', origin, 'pybamm59', 'battery', 'pybamm-sweep-v1', identity.sha256,
                          tuple(Binding(e.id, credentials[i % 2]['worker']['id']) for i, e in enumerate(identity.method.experiments)))
            batch = submit(api, batch, output / 'plan.json')
            # --once preserves an explicit, bounded set of claims, three per machine.
            for round_number in range(3):
                runs = [launch(machine.worker_command(environments[i]), f'worker-{i}-normal-{round_number}') for i, machine in enumerate(machines)]
                for process in runs: assert process.wait(timeout=180) == 0
            report = collect(api, batch, ROOT / 'reference.jsonl'); save(output / 'normal-report.json', report)
            assert report['consistent'] == 6, report['rows']
            assert len({row['hostname'] for row in report['rows']}) == 2
            assert [sum(row['worker'] == c['worker']['id'] for row in report['rows']) for c in credentials] == [3, 3]
            assert submit(api, batch, output / 'plan.json') == batch
            assert len(api.request('/api/v1/tasks')['tasks']) == 6
            for item in batch.items:
                detail = report['details'][item.experiment]; run = detail['run']
                credential = next(c for c in credentials if c['worker']['id'] == item.worker)
                worker_api = ControlPlane(origin, credential['token'])
                binding = {'instance_id': run['instance_id'], 'generation': run['generation']}
                worker_api.request('/api/worker/v1/runs/' + run['id'] + '/events', {**binding, 'events': detail['events']})
                repeated = worker_api.request('/api/worker/v1/runs/' + run['id'] + '/complete', {**binding, 'outcome': run['status'], 'summary': run['summary']})
                assert repeated['id'] == run['id']
                assert api.request('/api/v1/tasks/' + item.task)['events'] == detail['events']
                try:
                    worker_api.request('/api/worker/v1/runs/' + run['id'] + '/events', {**binding, 'events': [{**detail['events'][-1], 'text': 'conflicting late result'}]})
                except HTTPError as error: assert error.code == 409
                else: raise AssertionError('Late conflicting result was accepted')
            faults = replace(batch, name='two-machine-faults', items=tuple(replace(item, task='', run='') for item in batch.items))
            faults = submit(api, faults, output / 'fault-plan.json')
            def detail(index): return api.request('/api/v1/tasks/' + faults.items[index].task)
            def frozen_worker(index, name):
                receipt = vm_root + '/' + name + '-frozen.json'
                observer = guest.write(name + '-observer.json', {'origin': vm_origin, 'token': token,
                    'task': faults.items[index].task, 'receipt': receipt})
                # Observe and stop inside the VM: a remote shell round-trip can exceed a solve.
                code = """import json,os,pathlib,signal,sys,time,urllib.request
config=json.load(open(sys.argv[1])); deadline=time.monotonic()+60
request=urllib.request.Request(config['origin']+'/api/v1/tasks/'+config['task'],headers={'Authorization':'Bearer '+config['token']})
while time.monotonic()<deadline:
 with urllib.request.urlopen(request,timeout=2) as response: detail=json.load(response)
 for event in detail['events']:
  text=(event.get('data') or {}).get('content',{}).get('text','')
  if text.startswith('PERO_PYBAMM_START '):
   child=json.loads(text.removeprefix('PERO_PYBAMM_START ')); os.kill(child['pid'],signal.SIGSTOP)
   pathlib.Path(config['receipt']).write_text(json.dumps(child)); sys.exit(0)
 time.sleep(0.01)
raise TimeoutError('VM child start')
"""
                watcher = launch([*guest.prefix, guest.python, '-c', code, observer], name + '-observer')
                worker = launch(guest.worker_command(environments[1]), name)
                def observed():
                    value = guest.run('import pathlib,sys; p=pathlib.Path(sys.argv[1]); print(p.read_text() if p.exists() else "null")', receipt)
                    return json.loads(value)
                child = wait_for(observed, 'VM child frozen at observed start', timeout=70)
                assert watcher.wait(timeout=5) == 0
                return worker, child
            local_agents = Path(local.directory) / 'agents.json'
            agents = json.loads(local_agents.read_text()); original = agents[0]['command']; agents[0]['command'] = str(args.unprepared_python)
            save(local_agents, agents)
            failed = launch(local.worker_command(environments[0]), 'incompatible-environment'); failed.wait(timeout=45)
            assert detail(0)['run']['status'] == 'failed'
            agents[0]['command'] = original; save(local_agents, agents)
            cancelled, child = frozen_worker(1, 'vm-cancel')
            busy = ControlPlane(origin, credentials[1]['token']).request('/api/worker/v1/claims', {'request_id': 'occupied-vm', 'instance_id': 'second-instance'})
            assert busy['run'] is None
            api.request('/api/v1/tasks/' + faults.items[1].task + '/cancel', {})
            cancelled.wait(timeout=45); wait_for(lambda: not guest.alive(child['pid']), 'VM cancelled process exit')
            assert detail(1)['run']['status'] == 'cancelled', detail(1)
            # Block actual guest->host control-plane packets, keeping Lima management reachable.
            disconnected, child = frozen_worker(3, 'vm-network-loss')
            host_ip = vm_command('getent', 'hosts', 'host.lima.internal').split()[0]
            rule = ['OUTPUT', '-p', 'tcp', '-d', host_ip, '--dport', str(port), '-j', 'REJECT']
            vm_command('sudo', 'iptables', '-I', *rule); blocked = True
            wait_for(lambda: not guest.alive(child['pid']), 'Lease loss stops VM calculation', timeout=60)
            disconnected.wait(timeout=45)
            blocked_evidence = vm_command('sudo', 'iptables', '-L', 'OUTPUT', '-v', '-n', '-x')
            (output / 'network-block.txt').write_text(blocked_evidence)
            vm_command('sudo', 'iptables', '-D', *rule); blocked = False
            recovered = launch(guest.worker_command(environments[1]), 'vm-reconnected-original-journal'); recovered.wait(timeout=60)
            current = detail(3)
            assert current['run']['id'] == faults.items[3].run
            assert current['run']['status'] in ('reconcile', 'failed'), current
            assert sum('PERO_PYBAMM_START ' in (event.get('data') or {}).get('content', {}).get('text', '') for event in current['events']) == 1
            report = collect(api, faults, ROOT / 'reference.jsonl'); save(output / 'fault-report.json', report)
            assert len(report['rows']) == 6 and report['consistent'] == 0
            save(output / 'receipt.json', {'independent_machines': 2, 'normal_consistent': 6, 'denominator': 6,
                'per_machine_completed': [3, 3], 'duplicate_submit_extra_tasks': 0, 'duplicate_receipts': 6, 'conflicting_late_events_rejected': 6,
                'occupied_slot_claimed': False, 'cancelled_child_stopped': True, 'network_loss_child_stopped': True,
                'recovered_original_run': current['run']['id'], 'replayed_after_recovery': False,
                'fault_states': [row['state'] for row in report['rows']], 'vm': args.vm, 'vm_directory': vm_root,
                'method_sha256': identity.sha256, 'scientific_acceptance': 'not_assessed'})
            print((output / 'receipt.json').read_text())
        finally:
            if blocked: vm_command('sudo', 'iptables', '-D', *rule)
            guest.run('import json,os,pathlib,signal,sys\nroot=pathlib.Path(sys.argv[1])\npids=[]\nfor path in root.glob("*.pid"): pids.append(int(path.read_text()))\nrelay=root/"relay-ready.json"\nif relay.exists(): pids.append(json.loads(relay.read_text()).get("pid",0))\nfor pid in pids:\n if not pid: continue\n try: os.kill(pid,signal.SIGTERM)\n except ProcessLookupError: pass', vm_root)
            for process in reversed(processes): stop(process)
            for handle in handles: handle.close()
            if postgres_started: subprocess.run(['pg_ctl', '-D', str(database), '-m', 'fast', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('server-bin', 'worker-bin', 'python', 'unprepared-python', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--vm', required=True)
    parser.add_argument('--guest-python', default='/home/phodal.guest/pybamm59/venv/bin/python')
    parser.add_argument('--guest-worker', default='/home/phodal.guest/pybamm59/pero-worker')
    parser.add_argument('--guest-library-path', default='')
    main(parser.parse_args())
