"""Standalone offline checker: python -I -S verify.py --bundle <attempt>.

No imports from the candidate implementation, solver, PDF reader or network.
Recompute by exact raw moments, independently of float centered residuals.
Hashes bind evidence; they are not signatures or independent OS attestation.
"""
import argparse
import csv
from fractions import Fraction
import hashlib
import io
import json
import math
from pathlib import Path

PDF_SHA256 = 'd3a49aaa4f2d283931544f58cb12b1174f537642b83def7ae9119a1d8717b740'
DATA_SHA256 = '63bc335cdbbecc311a3dced4a28b210a94bc2ccc71b0df5535b72c30091623fc'
FILES = {'spec.json', 'selection.json', 'data.csv', 'paper.pdf', 'observations.json',
         'execution.json', 'verify.py'}


def identity(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def check(root):
    root = Path(root)
    def read(name):
        path = root / name
        require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 16 * 1024 * 1024,
                'Missing, linked or oversized artifact: ' + name)
        return path.read_bytes()

    def value(name):
        return json.loads(read(name), parse_constant=lambda v: (_ for _ in ()).throw(ValueError(v)))

    manifest = value('manifest.json')
    require(set(manifest) == FILES, 'Manifest does not cover the fixed evidence set')
    for name, expected in manifest.items():
        require(hashlib.sha256(read(name)).hexdigest() == expected, 'Changed artifact: ' + name)
    require(manifest['paper.pdf'] == PDF_SHA256, 'Wrong original PDF version')
    require(manifest['data.csv'] == DATA_SHA256, 'Wrong reviewed dataset version')
    spec = value('spec.json')
    spec_id = spec.pop('id')
    require(identity(spec) == spec_id, 'Protocol identity mismatch')
    require(spec['case'] == 'fisher-1936-table3-sepal-length-v1'
            and spec['doi'] == '10.1111/j.1469-1809.1936.tb02137.x'
            and spec['pdf_sha256'] == PDF_SHA256 and spec['data_sha256'] == DATA_SHA256
            and spec['reported'] == 19.1434 and spec['unit'] == 'cm^2'
            and spec['metric'] == 'sum_species sum_rows (sepal_length_cm - species_mean_cm)^2'
            and spec['count'] == 100 and spec['groups'] == 2, 'Wrong scientific target')
    selection = value('selection.json')
    require(identity(selection) == spec['selection_digest'], 'Selection identity mismatch')
    anchor = selection['annotation']['anchor']
    require(anchor['fileDigest'] == PDF_SHA256 and anchor['page'] == 4
            and anchor['rects'] == [dict(x=.34, y=.339, width=.065, height=.012)],
            'Wrong original result region')
    records = list(csv.DictReader(io.StringIO(read('data.csv').decode('ascii'))))
    require(len(records) == 100, 'Incomplete data coverage')
    groups = []
    for species, start in [('setosa', 0), ('versicolor', 50)]:
        rows = records[start:start + 50]
        require([r['row'] for r in rows] == [str(i) for i in range(1, 51)]
                and all(r['species'] == species for r in rows), 'Wrong group/row coverage')
        lengths = [Fraction(r['sepal_length_cm']) for r in rows]
        total = sum(lengths)
        # Algebraically independent from the candidate's centered summation.
        centered_ss = sum(x * x for x in lengths) - total * total / len(lengths)
        groups.append(dict(species=species, count=len(rows), mean_cm=total / len(rows),
                           centered_sum_squares_cm2=centered_ss))
    exact = sum(group['centered_sum_squares_cm2'] for group in groups)
    observed, receipt = value('observations.json'), value('execution.json')
    require(receipt['status'] == 'completed' and receipt['spec_id'] == spec_id
            and receipt['observations_sha256'] == manifest['observations.json']
            and observed['attempt_id'] == receipt['attempt_id'] and observed['spec_id'] == spec_id,
            'Incomplete or mismatched execution evidence')
    require(observed['case'] == spec['case'] and observed['metric'] == spec['metric']
            and observed['unit'] == 'cm^2' and observed['count'] == 100
            and observed['degrees_of_freedom'] == 98 and observed['variance_divisor'] is None
            and observed['measurement_grain'] == 'two-species-within-group', 'Metric or coverage changed')

    def close(actual, expected):
        return type(actual) in (float, int) and math.isfinite(actual) and abs(actual - float(expected)) <= 1e-12

    require(close(observed['actual'], exact), 'Candidate value disagrees with exact recomputation')
    require(len(observed['species']) == 2, 'Missing species evidence')
    for candidate, group in zip(observed['species'], groups):
        require(candidate['species'] == group['species'] and candidate['count'] == group['count']
                and close(candidate['mean_cm'], group['mean_cm'])
                and close(candidate['centered_sum_squares_cm2'], group['centered_sum_squares_cm2']),
                'Candidate group evidence disagrees')
    policy = spec['comparison']
    mode = policy.get('mode')
    difference = exact - Fraction('19.1434')
    def number(key):
        raw = policy[key]
        require(type(raw) in (int, float) and math.isfinite(raw), 'Non-finite comparison policy')
        return Fraction(str(raw))
    if mode in ('absolute', 'relative'):
        require(set(policy) == {'mode', 'tolerance'}, 'Unknown policy fields')
        tolerance = number('tolerance')
        require(tolerance >= 0, 'Negative tolerance')
        within = abs(difference) <= tolerance * (Fraction('19.1434') if mode == 'relative' else 1)
    else:
        require(mode == 'bounds' and set(policy) == {'mode', 'lower', 'upper'}, 'Unknown comparison policy')
        lower, upper = number('lower'), number('upper')
        require(lower <= upper, 'Reversed bounds')
        within = lower <= exact <= upper
    return dict(numeric_recomputation='PASS', execution_evidence='CONSISTENT',
        spec_id=spec_id, attempt_id=receipt['attempt_id'], count=100, unit='cm^2',
        exact_numerator=exact.numerator, exact_denominator=exact.denominator, actual=float(exact),
        difference=float(difference), comparison_status='within_tolerance' if within else 'outside_tolerance',
        result_verdict='REPRODUCED' if within else 'MISMATCH', paper_verdict='NOT_ASSESSED',
        independence='Exact raw-moment recomputation in a separate standard-library process; not attestation')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    try:
        result = check(args.bundle)
    except (ValueError, OSError, KeyError, TypeError, ZeroDivisionError) as error:
        print(json.dumps(dict(numeric_recomputation='FAIL', result_verdict='INCONCLUSIVE',
                              paper_verdict='NOT_ASSESSED', reason=str(error))))
        return 2
    print(json.dumps(result, indent=2))
    return 0 if result['result_verdict'] == 'REPRODUCED' else 3


if __name__ == '__main__':
    raise SystemExit(main())
