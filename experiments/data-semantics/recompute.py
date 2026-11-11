"""Independent evidence checker: raw CSV/Decimal arithmetic, no SQLite or executor imports."""
import argparse
from collections import Counter
from decimal import Decimal
from hashlib import sha256
import csv
import io
import json
from pathlib import Path
import statistics


def read(path):
    return json.loads(path.read_bytes(), parse_float=Decimal)


def mean(values):
    return (sum(values) / len(values)).quantize(Decimal('.000001'))


def reference(inputs):
    raw = list(csv.reader(io.StringIO((inputs / 'fixtures/iris.data').read_text().strip())))
    rows = [(tuple(Decimal(number) for number in row[:4]), row[4]) for row in raw]
    species = sorted({species for _, species in rows})
    grouped = {label: [values for values, name in rows if name == label] for label in species}
    results = {
        'B01': [dict(count=len(rows))],
        'B02': [dict(species=label, count=len(grouped[label])) for label in species],
        'B03': [dict(mean=mean([values[0] for values in grouped['Iris-setosa']]))],
        'B04': [dict(mean=mean([values[2] for values in grouped['Iris-versicolor']]))],
        'B05': [dict(mean=mean([values[0] for values in grouped['Iris-virginica']]))],
        'B06': [dict(minimum=min(v[0] for v, _ in rows), maximum=max(v[0] for v, _ in rows))],
        'B07': [dict(count=sum(v[0] > 6 for v, _ in rows))],
        'B08': [dict(species=label, mean=mean([v[1] for v in grouped[label]])) for label in species],
        'B09': [dict(mean=mean([v[2] * 10 for v, _ in rows]))],
        'B10': [dict(sample_id=35, **dict(zip(('sepal_length_cm', 'sepal_width_cm', 'petal_length_cm', 'petal_width_cm'), rows[34][0])))],
        'B11': [dict(species=label, minimum=min(v[2] for v in grouped[label]), maximum=max(v[2] for v in grouped[label])) for label in species],
        'B12': [dict(sample_id=i) for i in range(1, len(rows) + 1)],
    }
    synthetic = read(inputs / 'fixtures/synthetic.json')
    runs = [dict(zip(synthetic['run_columns'], row)) for row in synthetic['runs']]
    metrics = {tuple(row[:2]): dict(zip(synthetic['metric_columns'], row)) for row in synthetic['metrics']}
    eligible = [r for r in runs if (r['dataset_version'], r['split'], r['preprocessing'], r['protocol']) == ('uci-v1', 'test', 'raw', 'standard')]
    groups = {method: [r for r in eligible if r['method'] == method] for method in ('A', 'B')}
    completed = {method: [r for r in group if r['status'] == 'complete'] for method, group in groups.items()}
    accuracy = {r['run_id']: metrics[r['run_id'], 'accuracy'] for r in eligible}
    normalized = {run_id: None if m['value'] is None else Decimal(m['value']) / (100 if m['unit'] == 'percent' else 1) for run_id, m in accuracy.items()}
    a_values = [normalized[r['run_id']] for r in completed['A'] if normalized[r['run_id']] is not None]
    a_observed = [r for r in groups['A'] if normalized[r['run_id']] is not None]
    a_seeds = {r['seed']: normalized[r['run_id']] for r in completed['A']}
    b_seeds = {r['seed']: normalized[r['run_id']] for r in completed['B']}
    results.update({
        'T01': [dict(mean=mean(a_values))],
        'T02': [dict(mean=sum(normalized[r['run_id']] * accuracy[r['run_id']]['sample_count'] for r in a_observed) / sum(accuracy[r['run_id']]['sample_count'] for r in a_observed))],
        'T03': [dict(scheduled=len(groups['A']), completed=len(completed['A']))],
        'T04': [dict(count=len({r['run_id'] for r in groups['A'] if any(key[0] == r['run_id'] for key in metrics)}))],
        'T05': [dict(seed=seed, difference=b_seeds[seed] - a_seeds[seed]) for seed in sorted(a_seeds.keys() & b_seeds.keys())],
        'T06': [dict(mean=mean([metrics[r['run_id'], 'macro_f1']['value'] for r in completed['A']]))],
        'T07': [dict(method=method, scheduled=len(groups[method]), completed=len(completed[method])) for method in ('A', 'B')],
        'T08': [dict(scheduled=len(groups['A']), observed=len(a_observed), sum=sum(a_values))],
    })
    return results, rows


def verify(output):
    inputs = output / 'inputs'
    run = read(output / 'run.json')
    freeze = read(inputs / 'freeze.json')
    assert sha256((inputs / 'freeze.json').read_bytes()).hexdigest() == run['freeze_sha256'], 'Freeze hash'
    for name, expected_hash in freeze['files'].items():
        assert sha256((inputs / name).read_bytes()).hexdigest() == expected_hash, name
    questions = read(inputs / 'questions.json')['questions']
    assert Counter(q['group'] for q in questions) == dict(basic=12, trap=8, clarification=5, refusal=5)
    assert len({q['id'] for q in questions}) == 30
    expected, raw = reference(inputs)
    for question in questions:
        if question['expected_status'] == 'answered':
            assert question['expected_rows'] == expected[question['id']], f"Frozen oracle: {question['id']}"
    calibration = read(inputs / 'calibration.json')['cases']
    assert len(calibration[0]['input']) == calibration[0]['expected']
    assert calibration[1]['input'] * 10 == calibration[1]['expected']
    cap = read(inputs / 'policy.json')['presentation_row_cap']
    definitions = {row['id']: row for row in read(inputs / 'definitions.v1.json')['definitions']}
    attempts = []
    for repetition in range(1, run['repetitions'] + 1):
        scores = Counter()
        elapsed = []
        for question in questions:
            qid = question['id']
            receipt = read(output / 'receipts' / f'{qid}-{repetition}.receipt.json')
            assert receipt['question'] == qid and receipt['repetition'] == repetition
            assert receipt['arm'] == 'D_manual_reference' and not receipt['model_run']
            assert receipt['status'] == question['expected_status'], qid
            source = receipt['snapshot']
            for name, digest in [(source['database'], source['database_sha256']), (source['export_file'], source['export_sha256'])]:
                assert sha256((output / name).read_bytes()).hexdigest() == digest, name
            assert source['definitions_sha256'] == freeze['files']['definitions.v1.json']
            assert source['source_sha256'] == freeze['files']['fixtures/iris.data']
            assert source['synthetic_sha256'] == freeze['files']['fixtures/synthetic.json']
            assert source['schema_sha256'] == freeze['files']['schema.sql']
            assert sha256((output / 'data-home/files' / source['asset_id']).read_bytes()).hexdigest() == source['asset_sha256']
            export = read(output / source['export_file'])
            assert (export['manifest']['dataset'], export['manifest']['assetId'], export['manifest']['sha256']) == (source['dataset_id'], source['asset_id'], source['asset_sha256'])
            assert export['manifest']['records'] == len(export['rows']) == len(raw)
            assert len(export['manifest']['provenance']) == len(raw)
            for i, row in enumerate(export['rows']):
                assert int(row['sample_id']) == i + 1 and row['species'] == raw[i][1]
                assert tuple(Decimal(row[field]) for field in ('sepal_length_cm', 'sepal_width_cm', 'petal_length_cm', 'petal_width_cm')) == raw[i][0]
            if receipt['status'] == 'answered':
                definition = definitions[question['definition']]
                assert all(receipt['definition'][key] == definition[key] for key in ('id', 'version', 'sql', 'unit', 'grain', 'denominator', 'join_cardinality', 'missing', 'seed_policy'))
                assert receipt['parameters'] == question['parameters']
                path = output / 'receipts' / receipt['result_file']
                assert sha256(path.read_bytes()).hexdigest() == receipt['result_sha256']
                result = read(path)
                assert result == expected[qid], f'Recompute mismatch: {qid}'
                assert receipt['row_count'] == len(result)
                assert receipt['presentation_rows'] == result[:cap]
                assert receipt['truncated'] == (len(result) > cap)
                scores[question['data_class']] += 1
                elapsed.append(float(receipt['elapsed_seconds']))
            else:
                assert receipt['result_file'] is None and receipt['row_count'] == 0 and receipt['definition'] is None
                scores[receipt['status']] += 1
        attempts.append(dict(repetition=repetition, public_correct=scores['public'], synthetic_correct=scores['synthetic'],
                             manual_clarification_fixtures=scores['clarify'], manual_refusal_fixtures=scores['refused'],
                             total_query_seconds=sum(elapsed)))
    assert len(list((output / 'receipts').glob('*.receipt.json'))) == run['receipt_count'] == 90
    safety = read(output / 'safety.json')
    assert len(safety) == 15 and all(check['passed'] for check in safety)
    history = read(output / 'history.json')
    assert history['old_files_unchanged'] and history['old_export_reproduced']
    assert len(history['dataset_versions']) == 2
    old, new = history['old_receipt'], history['new_receipt']
    assert old['snapshot']['asset_id'] != new['snapshot']['asset_id']
    assert old['snapshot']['definitions_sha256'] != new['snapshot']['definitions_sha256']
    assert old['definition']['version'] == 1 and new['definition']['version'] == 2
    assert old['definition']['unit'] == 'cm' and new['definition']['unit'] == 'mm'
    assert old == read(output / 'receipts/B03-1.receipt.json')
    assert new == read(output / 'v2-receipts/B03-1.receipt.json')
    assert new['snapshot']['definitions_sha256'] == freeze['files']['definitions.v2.json']
    for name, digest in [(new['snapshot']['database'], new['snapshot']['database_sha256']),
                         (new['snapshot']['export_file'], new['snapshot']['export_sha256'])]:
        assert sha256((output / name).read_bytes()).hexdigest() == digest
    new_export = read(output / new['snapshot']['export_file'])
    assert len(new_export['rows']) == 150
    for i, row in enumerate(new_export['rows']):
        expected_values = raw[i][0] if i else (Decimal('5.2'), *raw[0][0][1:])
        assert tuple(Decimal(row[field]) for field in ('sepal_length_cm', 'sepal_width_cm', 'petal_length_cm', 'petal_width_cm')) == expected_values
    revised_definition = next(d for d in read(inputs / 'definitions.v2.json')['definitions'] if d['id'] == 'sepal_mean')
    assert new['definition']['sql'] == revised_definition['sql']
    new_rows_path = output / 'v2-receipts' / new['result_file']
    assert sha256(new_rows_path.read_bytes()).hexdigest() == new['result_sha256']
    new_mean = (sum(values[0] for values, label in raw if label == 'Iris-setosa') + Decimal('.1')) / 50 * 10
    assert read(new_rows_path) == [dict(mean=new_mean)] == new['presentation_rows']
    assert old['presentation_rows'] == [dict(mean=Decimal('5.006'))]
    rates = [(attempt['public_correct'] + attempt['synthetic_correct']) / 20 for attempt in attempts]
    return dict(status='passed', arm='D_manual_reference_only', questions=30, answerable=20,
                public=dict(correct=12, denominator=12), synthetic=dict(correct=8, denominator=8),
                manual_status_fixtures=dict(clarify=5, refused=5, note='Pre-authored intents; not NL ambiguity or injection accuracy'),
                attempts=attempts, answer_accuracy_variance=statistics.pvariance(rates),
                query_seconds_variance=statistics.pvariance(a['total_query_seconds'] for a in attempts),
                safety=dict(passed=len(safety), checks=len(safety)), provenance=dict(complete=90, receipts=90),
                history='v1 reproduced after v2 data and definition publication', model_arms=run['model_arms'],
                semantic_benefit='unevaluated', model_usage=None, maintenance_time=None,
                recommendation='Reuse the bounded receipt/definition contract for further experiments; defer service adoption and benefit claims')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = json.dumps(verify(args.output), indent=2) + '\n'
    if args.report:
        with args.report.open('x') as stream:
            stream.write(report)
    print(report)
