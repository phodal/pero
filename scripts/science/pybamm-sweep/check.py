"""Independent standard-library checks; never imports PyBaMM or the solver."""
import argparse
import json
import math
from pathlib import Path

from contract import MethodIdentity, Result
from bundle import load_identity


def check(result: Result, reference: Result, identity: MethodIdentity) -> tuple[str, ...]:
    method = identity.method
    errors = []
    expected = method.experiment(reference.experiment.id)
    for label, item in (('result', result), ('reference', reference)):
        if item.experiment != expected:
            errors.append(f'{label}: frozen input mismatch')
        if item.method_id != method.method_id or item.method_sha256 != identity.sha256:
            errors.append(f'{label}: method mismatch')
        if item.environment != identity.environment:
            errors.append(f'{label}: environment mismatch')
        if item.time_s != method.times or item.termination != 'final time':
            errors.append(f'{label}: incomplete time domain')
        if not all(len(values) == len(method.times) for values in
                   (item.voltage_v, item.current_a, item.discharge_capacity_ah)):
            errors.append(f'{label}: missing samples')
            continue
        current = expected.c_rate * method.capacity_ah
        if not all(math.isclose(value, current, rel_tol=0, abs_tol=method.current_atol_a)
                   for value in item.current_a):
            errors.append(f'{label}: constant current mismatch')
        if not all(math.isclose(capacity, current * seconds / 3600, rel_tol=0,
                                abs_tol=method.capacity_atol_ah)
                   for seconds, capacity in zip(method.times, item.discharge_capacity_ah)):
            errors.append(f'{label}: charge balance mismatch')
        if not all(2.5 <= value <= 4.3 for value in item.voltage_v):
            errors.append(f'{label}: voltage outside declared sanity range')
    if len(result.voltage_v) != len(reference.voltage_v) or not all(
            math.isclose(a, b, abs_tol=method.comparison_atol_v, rel_tol=method.comparison_rtol)
            for a, b in zip(result.voltage_v, reference.voltage_v)):
        errors.append('voltage differs from sequential reference')
    return tuple(errors)


def read_results(path: Path) -> dict[str, Result]:
    results = [Result.parse(json.loads(line)) for line in path.read_text().splitlines() if line]
    if len({r.experiment.id for r in results}) != len(results):
        raise ValueError('Duplicate experiment results')
    return {r.experiment.id: r for r in results}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path)
    parser.add_argument('results', type=Path)
    args = parser.parse_args()
    identity = load_identity()
    method = identity.method
    references, results = read_results(args.reference), read_results(args.results)
    rows = []
    for experiment in method.experiments:
        errors = (('missing reference or result',) if experiment.id not in references or experiment.id not in results
                  else check(results[experiment.id], references[experiment.id], identity))
        rows.append({'experiment': experiment.id, 'errors': errors, 'consistent': not errors})
    extras = sorted((references.keys() | results.keys()) - {e.id for e in method.experiments})
    print(json.dumps({'denominator': 6, 'rows': rows, 'unexpected': extras, 'scientific_acceptance': 'not_assessed'}, indent=2))
    raise SystemExit(int(bool(extras) or any(row['errors'] for row in rows)))
