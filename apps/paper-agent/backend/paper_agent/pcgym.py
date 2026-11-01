"""Fixed-case research CLI, invoked by an existing authorized Host shell tool.

prepare -> approve exact spec -> run real engine -> verify -> export.
A missing engine is BLOCKED, never replaced by a synthetic solver.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import platform
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid
import zipfile

from .pcgym_domain import (Claim, Invalid, Observation, ReproductionSpec,
                           canonical, digest, verification)
from .pcgym_sources import audit_sources, package_inventory, read_checkout, pipeline_digest

MAX_JSON = 8 * 1024 * 1024


def read_json(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_JSON:
        raise Invalid('file', 'Expected a bounded, non-symlink JSON file')
    try:
        return json.loads(path.read_text(encoding='utf-8'),
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (UnicodeError, ValueError) as error:
        raise Invalid('json', 'Invalid or non-finite JSON input') from error


def write_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.tmp')
    if path.is_symlink() or temporary.is_symlink():
        raise Invalid('file', 'Refuse to write through a symlink')
    temporary.write_bytes(canonical(value))
    temporary.replace(path)


def utc():
    return datetime.now(timezone.utc).isoformat()


def root_path(path):
    path = Path(path).absolute()
    if path.resolve() != path or path.is_symlink():
        raise Invalid('path', 'Use a canonical, non-symlink directory')
    return path


def load_spec(root):
    return ReproductionSpec.parse(read_json(root / 'spec.json'))


def prepare(checkout, output, seed=0, profile='table6', timeout_seconds=3600, *, include_oracle=True):
    checkout, sources, manifest = read_checkout(checkout)
    root = root_path(output)
    root.mkdir(parents=True, exist_ok=False)
    packages = package_inventory()
    spec = ReproductionSpec.create(seed=seed, profile=profile, packages=packages,
                                  source_manifest_digest=digest(manifest), python_version=platform.python_version(),
                                  pipeline_digest=pipeline_digest(), timeout_seconds=timeout_seconds,
                                  include_oracle=include_oracle)
    audit = audit_sources(sources, pinned=True)
    write_json(root / 'claim.json', Claim().to_dict())
    write_json(root / 'audit.json', audit)
    write_json(root / 'source-manifest.json', manifest)
    write_json(root / 'spec.json', spec.to_dict())
    # Local execution configuration is not part of a public export.
    write_json(root / 'local.json', {'checkout': str(checkout), 'interpreter': sys.executable})
    result = {'spec_id': spec.id, 'readiness': 'BLOCKED' if 'MISSING' in packages.values() else 'REQUIRES_APPROVAL',
              'missing_packages': [k for k, v in packages.items() if v == 'MISSING'],
              'audit_findings': [f['id'] for f in audit['findings']],
              'paper_verdict': 'INCONCLUSIVE', 'deviations': list(spec.deviations()),
              'next_action': 'Review the frozen spec and audit. After explicit execution approval, run with its exact digest.'}
    write_json(root / 'readiness.json', result)
    return result


def attempt_directory(root, attempt_id):
    from .pcgym_domain import identifier
    identifier(attempt_id, 'attempt_id')
    path = root / 'attempts' / attempt_id
    if path.resolve() != path or not path.is_dir():
        raise Invalid('attempt', 'Unknown or linked attempt directory')
    return path


def check_attempt(root, attempt_id):
    spec = load_spec(root)
    target = attempt_directory(root, attempt_id)
    receipt = read_json(target / 'execution.json')
    raw_bytes = (target / 'observations.json').read_bytes()
    if len(raw_bytes) > MAX_JSON:
        raise Invalid('file', 'Observation file exceeds its limit')
    raw = read_json(target / 'observations.json')
    observed = Observation.parse(raw, spec)
    if observed.attempt_id != attempt_id:
        raise Invalid('wrong_attempt', 'Results cannot be moved between attempts')
    actual_hash = hashlib.sha256(raw_bytes).hexdigest()
    matches = receipt.get('observations_sha256') == actual_hash and receipt.get('spec_id') == spec.id and receipt.get('attempt_id') == attempt_id
    report = verification(spec, observed, receipt.get('status'), matches)
    report['observation_sha256'] = actual_hash
    report['checker_sha256'] = hashlib.sha256(Path(__file__).with_name('pcgym_domain.py').read_bytes()).hexdigest()
    if not matches:
        report['numeric_recomputation'] = 'FAIL'
        report['reason'] = 'Observation bytes or attempt identity do not match the recorded execution receipt.'
    write_json(target / 'verification.json', report)
    return report


def worker(root, attempt_id):
    from .pcgym_runtime import run_case
    spec = load_spec(root)
    local = read_json(root / 'local.json')
    target = attempt_directory(root, attempt_id)
    observed, environment = run_case(spec, local['checkout'], attempt_id, target)
    write_json(target / 'observations.json', observed)
    write_json(target / 'environment.json', environment)


def run(root, spec_id, *, confirm=False, accept_findings=False):
    from .pcgym_runtime import preflight
    spec = load_spec(root)
    if spec_id != spec.id or confirm is not True or accept_findings is not True:
        raise Invalid('approval_required', 'Approve this exact specification and its disclosed upstream ambiguities')
    local = read_json(root / 'local.json')
    if local.get('interpreter') != sys.executable:
        raise Invalid('interpreter_changed', 'Run with the interpreter used to prepare this specification')
    preflight(spec, local['checkout'])
    attempts = root / 'attempts'
    attempts.mkdir(exist_ok=True)
    lock = root / 'running.lock'
    try:
        descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise Invalid('reconcile_required', 'An active or interrupted run exists. Do not replay; inspect its attempt and owner first') from error
    attempt_id = digest({'spec_id': spec.id, 'nonce': uuid.uuid4().hex})
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(canonical({'attempt_id': attempt_id, 'owner_pid': os.getpid()}))
    target = attempts / attempt_id
    target.mkdir()
    receipt = {'spec_id': spec.id, 'attempt_id': attempt_id, 'status': 'running',
               'started_at': utc(), 'origin': 'local-foreground-cli', 'execution_identity_attested': False}
    write_json(target / 'execution.json', receipt)
    process = None
    old_handler = signal.getsignal(signal.SIGTERM)

    def stop(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        # The parent remains inside the Host-owned process tree; no detached session.
        env = {k: os.environ[k] for k in ('PATH', 'SYSTEMROOT', 'WINDIR') if k in os.environ}
        home = target / 'runtime-home'
        home.mkdir()
        env.update(PYTHONPATH=str(Path(__file__).resolve().parents[1]), PYTHONDONTWRITEBYTECODE='1',
                   HOME=str(home), MPLBACKEND='Agg', CUDA_VISIBLE_DEVICES='',
                   OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1', MKL_NUM_THREADS='1')
        with (target / 'execution.log').open('wb') as log:
            process = subprocess.Popen([sys.executable, '-m', 'paper_agent.pcgym', '_worker',
                                        '--bundle', str(root), '--attempt', attempt_id],
                                       cwd=target, env=env, stdin=subprocess.DEVNULL, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=False)
            deadline = time.monotonic() + spec.timeout_seconds
            while True:
                try:
                    code = process.wait(timeout=min(1, max(.01, deadline - time.monotonic())))
                    break
                except subprocess.TimeoutExpired:
                    if time.monotonic() >= deadline:
                        raise Invalid('execution_timeout', 'Frozen execution wall-time limit reached')
                    if (target / 'execution.log').stat().st_size > 16 * 1024 * 1024:
                        raise Invalid('log_limit', 'Execution log exceeded 16 MiB; preserve partial evidence')
            if code != 0:
                raise Invalid('execution_failed', f'Real engine process exited {code}; see execution.log')
        raw = read_json(target / 'observations.json')
        observation = Observation.parse(raw, spec)
        if observation.attempt_id != attempt_id or observation.origin != 'pcgym-execution':
            raise Invalid('execution_output', 'Engine output has the wrong attempt or origin')
        receipt.update(status='completed', exit_code=code,
                       observations_sha256=hashlib.sha256((target / 'observations.json').read_bytes()).hexdigest())
    except KeyboardInterrupt:
        receipt.update(status='cancelled', error='Operator or Host requested cancellation')
    except (Invalid, OSError) as error:
        receipt.update(status='failed', error=str(error), error_code=getattr(error, 'code', 'io'))
    finally:
        signal.signal(signal.SIGTERM, old_handler)
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    receipt.update(status='unknown', error='Cannot confirm child termination; reconcile before retry')
        receipt['finished_at'] = utc()
        write_json(target / 'execution.json', receipt)
        if receipt['status'] != 'unknown':
            lock.unlink()
    if receipt['status'] == 'completed':
        # Run the checker in a separate stdlib-only process, not inside the solver.
        subprocess.run([sys.executable, '-m', 'paper_agent.pcgym', 'verify', '--bundle', str(root),
                        '--attempt', attempt_id], check=True, timeout=30,
                       env=env,
                       stdout=subprocess.DEVNULL)
    return receipt


def export(root, attempt_id, destination):
    target = attempt_directory(root, attempt_id)
    report = check_attempt(root, attempt_id)
    if report['numeric_recomputation'] != 'PASS':
        raise Invalid('integrity', 'Cannot export evidence whose observation receipt does not match')
    destination = Path(destination)
    files = {name: root / name for name in ('claim.json', 'spec.json', 'audit.json', 'source-manifest.json')}
    spec = load_spec(root)
    if spec.paper_binding_digest is not None:
        binding = root / 'paper-binding.json'
        if digest(read_json(binding)) != spec.paper_binding_digest:
            raise Invalid('paper_binding_changed', 'Saved Paper inputs differ from the frozen specification')
        files['paper-binding.json'] = binding
    files.update({name: target / name for name in ('execution.json', 'observations.json', 'verification.json')})
    # Include fresh numeric raw output only; no third-party paper/source or pickle.
    for name in ('base-raw.npz', 'shaped-raw.npz', 'oracle-raw.npz', 'environment.json'):
        if (target / name).is_file():
            files[name] = target / name
    if any(p.is_symlink() for p in files.values()):
        raise Invalid('export_path', 'Refuse linked artifacts')
    with zipfile.ZipFile(destination, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        manifests = []
        for name, path in files.items():
            content = path.read_bytes()
            archive.writestr(name, content)
            manifests.append({'name': name, 'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)})
        checker = Path(__file__).with_name('pcgym_domain.py').read_bytes()
        archive.writestr('pcgym_domain.py', checker)
        manifests.append({'name': 'pcgym_domain.py', 'sha256': hashlib.sha256(checker).hexdigest(), 'bytes': len(checker)})
        archive.writestr('verify.py', EXPORT_CHECKER)
        archive.writestr('manifest.json', canonical({'files': manifests, 'paper_verdict': report['paper_verdict'],
                         'omitted': ['Third-party paper and repository', 'Checkpoints (digests only)', 'Local paths and credentials']}))
    return {'exported': str(destination), 'paper_verdict': report['paper_verdict']}


EXPORT_CHECKER = '''"""Run: python verify.py. No solver, Agent or network required."""
from pathlib import Path
import hashlib, json
from pcgym_domain import ReproductionSpec, Observation, verification, digest
root = Path(__file__).resolve().parent
manifest = json.loads((root/'manifest.json').read_text())
for f in manifest['files']:
    p = root/f['name']
    if p.parent != root or p.is_symlink():
        raise ValueError('Invalid artifact path')
    if hashlib.sha256(p.read_bytes()).hexdigest() != f['sha256']:
        raise ValueError('Artifact changed: '+f['name'])
spec = ReproductionSpec.parse(json.loads((root/'spec.json').read_text()))
if spec.paper_binding_digest is not None:
    binding = json.loads((root/'paper-binding.json').read_text())
    if digest(binding) != spec.paper_binding_digest:
        raise ValueError('Paper binding differs from frozen specification')
raw = (root/'observations.json').read_bytes()
obs = Observation.parse(json.loads(raw), spec)
receipt = json.loads((root/'execution.json').read_text())
matched = (receipt.get('observations_sha256') == hashlib.sha256(raw).hexdigest()
           and receipt.get('spec_id') == spec.id and receipt.get('attempt_id') == obs.attempt_id)
if not matched:
    raise ValueError('Execution receipt does not match observations')
print(json.dumps(verification(spec, obs, receipt.get('status'), matched), indent=2))
'''


def status(root):
    spec = load_spec(root)
    attempts = []
    folder = root / 'attempts'
    if folder.exists():
        for item in sorted(folder.iterdir()):
            if item.is_symlink() or not item.is_dir():
                continue
            receipt = read_json(item / 'execution.json')
            attempts.append({**receipt, 'liveness': 'not-probed',
                             'verification_available': (item / 'verification.json').is_file()})
    return {'spec_id': spec.id, 'attempts': attempts,
            'execution_lock_present': (root / 'running.lock').exists(),
            'guidance': 'A recorded running state is not proof of a live process. Reconcile an interrupted owner before any replay.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prep = commands.add_parser('prepare')
    prep.add_argument('--checkout', required=True)
    prep.add_argument('--output', required=True)
    prep.add_argument('--seed', type=int, default=0)
    prep.add_argument('--profile', choices=('table6', 'smoke'), default='table6')
    prep.add_argument('--timeout-seconds', type=int, default=3600)
    prep.add_argument('--no-oracle', action='store_true', help='Freeze base/shaped coverage only; omit Oracle comparison')
    for name in ('run', 'verify', 'export', 'status', '_worker'):
        sub = commands.add_parser(name)
        sub.add_argument('--bundle', required=True)
        if name == 'run':
            sub.add_argument('--spec-sha', required=True)
            sub.add_argument('--confirm-execution', action='store_true')
            sub.add_argument('--accept-audit-findings', action='store_true')
        elif name != 'status':
            sub.add_argument('--attempt', required=True)
        if name == 'export':
            sub.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'prepare':
            result = prepare(args.checkout, args.output, args.seed, args.profile, args.timeout_seconds,
                             include_oracle=not args.no_oracle)
        else:
            root = root_path(args.bundle)
            if args.command == 'run':
                result = run(root, args.spec_sha, confirm=args.confirm_execution,
                             accept_findings=args.accept_audit_findings)
            elif args.command == 'status':
                result = status(root)
            elif args.command == 'verify':
                result = check_attempt(root, args.attempt)
            elif args.command == 'export':
                result = export(root, args.attempt, args.output)
            else:
                worker(root, args.attempt)
                result = {'execution': 'completed', 'paper_verdict': 'INCONCLUSIVE'}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if (result.get('readiness') == 'BLOCKED'
                     or result.get('status') in ('failed', 'cancelled', 'unknown')
                     or result.get('numeric_recomputation') == 'FAIL') else 0
    except (Invalid, OSError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({'status': 'BLOCKED', 'code': getattr(error, 'code', type(error).__name__),
                          'detail': str(error), 'paper_verdict': 'INCONCLUSIVE'}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
