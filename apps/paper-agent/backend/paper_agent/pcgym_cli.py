"""Standalone independent recheck and explicit local execution. No provider calls."""
import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys
import threading

from .pcgym_audit import case_summary
from .pcgym_runner import execute, observe_environment, RunStopped
from .reproduction import ReproductionError, ReproductionSpec, Trajectory, canonical, digest, verify


def recheck(package):
    if package.get('schema') != 'pero.pcgym-research-package.v1':
        raise ReproductionError('package_schema', 'Expected a Pero PC-Gym research package')
    spec = ReproductionSpec.restore(package['spec'])
    audit = package['audit']
    if digest(audit) != spec.audit_id:
        raise ReproductionError('audit_digest', 'Exported audit no longer matches the frozen spec')
    status = package['attempt']['status']
    attempt = package['attempt']['attempt']
    if attempt['spec_id'] != spec.id:
        raise ReproductionError('attempt_binding', 'Attempt belongs to another specification')
    traces, ids = [], []
    for value in package['observations']:
        if value['spec_id'] != spec.id or value['attempt_id'] != attempt['id']:
            raise ReproductionError('evidence_binding', 'A trajectory belongs to another execution')
        if value['origin'] != attempt['origin']:
            raise ReproductionError('evidence_origin', 'Trajectory origin differs from the execution record')
        ids.append(digest(value))
        traces.append(Trajectory.parse(value['trajectory'], spec))
    saved = package['verification']
    if ids != saved['evidence_ids'] or saved['spec_id'] != spec.id or saved['attempt_id'] != attempt['id']:
        raise ReproductionError('evidence_manifest', 'Exported evidence manifest does not match')
    report = verify(spec, traces, status, attempt['origin'])
    report.update(attempt_id=attempt['id'], evidence_ids=ids, source=spec.claim.to_dict())
    if saved.get('id') != digest(report) or canonical({k:v for k,v in saved.items() if k!='id'}) != canonical(report):
        raise ReproductionError('verification_changed', 'Saved metrics or verification record differ from independent recomputation')
    return dict(id=digest(report), **report, offline_receipt_authenticity='not-attested',
                recheck='PASS', recheck_scope='artifact integrity and deterministic arithmetic only')


def read_json(path):
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ReproductionError('package_size', 'Research package exceeds 16 MiB')
    return json.loads(path.read_text('utf-8'), parse_constant=lambda value: (_ for _ in ()).throw(
        ReproductionError('nonfinite', f'Invalid JSON number {value}')))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('case'); sub.add_parser('environment')
    check = sub.add_parser('verify'); check.add_argument('package', type=Path)
    check.add_argument('--output', type=Path)
    run = sub.add_parser('run'); run.add_argument('spec', type=Path)
    run.add_argument('--output', required=True, type=Path)
    run.add_argument('--confirm-local-execution', action='store_true')
    args = parser.parse_args(argv)
    try:
        if args.command == 'case': result = case_summary()
        elif args.command == 'environment': result = observe_environment().to_dict()
        elif args.command == 'verify': result = recheck(read_json(args.package))
        else:
            if not args.confirm_local_execution:
                raise ReproductionError('confirmation', 'Pass --confirm-local-execution only after reviewing the frozen spec')
            if args.output.exists():
                raise ReproductionError('output_exists', 'Choose a new output; previous research is never overwritten')
            spec = ReproductionSpec.restore(read_json(args.spec))
            spec.require_environment(observe_environment())
            observations, status, error = [], 'succeeded', None
            try:
                execute(spec, lambda t: observations.append(t),
                        lambda p: print(json.dumps(p), file=sys.stderr), threading.Event())
            except RunStopped as stopped:
                status, error = stopped.status, str(stopped)
            except (Exception, KeyboardInterrupt) as failure:
                status, error = 'failed', f'{type(failure).__name__}: {failure}'
            result = dict(schema='pero.pcgym-cli-run.v1', spec=spec.to_dict(),
                          execution_status=status, error=error,
                          observations=[asdict(t) for t in observations],
                          verification=verify(spec, observations, status, 'local-pcgym'),
                          receipt_scope='standalone CLI; not a Host-attested App execution')
        payload = canonical(result) + b'\n'
        output = getattr(args, 'output', None)
        if output:
            with output.open('xb') as stream: stream.write(payload)
        else:
            sys.stdout.buffer.write(payload)
        return 0 if result.get('execution_status') not in ('failed','cancelled') else 2
    except (ReproductionError, OSError, KeyError, ValueError, TypeError) as error:
        print(json.dumps(dict(error=getattr(error,'code','invalid'), detail=str(error))), file=sys.stderr)
        return 2


if __name__ == '__main__': raise SystemExit(main())
