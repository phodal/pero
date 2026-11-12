"""Audit saved real-model receipts without querying SQL or calling a model.

Retains the frozen exact-match score. Alias/rounding diagnostics are explicitly
post-hoc, never substituted into the original acceptance threshold.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import statistics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    config = json.loads((args.run / 'config.json').read_text())
    if config['mode'] not in ('local_model', 'remote_model'):
        parser.error('Fixture responses cannot be audited as real-model results')
    here = Path(__file__).resolve().parent
    for name, digest in config['inputs'].items():
        if sha256((here / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f'Frozen input changed: {name}')
    questions = {q['id']: q for q in json.loads((here / 'questions.json').read_text())['questions']}
    identities = {f'{arm}-{repeat}-{question}' for arm in ('A', 'B', 'C')
                  for repeat in range(1, config['repetitions'] + 1) for question in questions}
    paths = {p.name.removesuffix('.receipt.json'): p for p in args.run.glob('*.receipt.json')}
    if paths.keys() != identities:
        raise ValueError('Question receipts are missing or duplicated')
    aliases = {'sample_count': 'count', 'sepal_mean': 'mean', 'petal_mean': 'mean',
        'min_sepal_length_cm': 'minimum', 'max_sepal_length_cm': 'maximum', 'n': 'count',
        'mean_sepal_width_cm': 'mean', 'mean_petal_length_mm': 'mean',
        'min_petal_length_cm': 'minimum', 'max_petal_length_cm': 'maximum'}
    receipts, diagnostic, hashes = [], [], {}
    database_hash = sha256((args.run / 'v1.sqlite').read_bytes()).hexdigest()
    for identity, path in sorted(paths.items()):
        receipt = json.loads(path.read_text())
        request = json.loads((args.run / f'{identity}.request.json').read_text())
        provider = json.loads((args.run / f'{identity}.provider.json').read_text())
        if not receipt['modelRun'] or request['messages'] != receipt['input']:
            raise ValueError(f'Invalid model provenance: {identity}')
        if provider['choices'][0]['message']['content'] != receipt['response']:
            raise ValueError(f'Provider response mismatch: {identity}')
        if receipt['snapshot']['database_sha256'] != database_hash:
            raise ValueError(f'Database drift: {identity}')
        question = questions[receipt['questionId']]
        if receipt['status'] != 'answered' and receipt['correct'] != (receipt['status'] == question['expected_status']):
            raise ValueError(f'Status score mismatch: {identity}')
        if receipt.get('answer', {}).get('status') == 'answered' and 'rowCount' in receipt:
            rows = json.loads((args.run / f'{identity}.rows.json').read_text())
            if len(rows) != receipt['rowCount'] or rows[:100] != receipt['rows']:
                raise ValueError(f'Incomplete stored rows: {identity}')
            expected = questions[receipt['questionId']]['expected_rows']
            exact = receipt['status'] == questions[receipt['questionId']]['expected_status'] and rows == expected
            if exact != receipt['correct']:
                raise ValueError(f'Frozen score mismatch: {identity}')
            normalized = [{aliases.get(k, k): round(v, 6) if type(v) is float else v
                           for k, v in row.items()} for row in rows]
            if not exact and normalized == expected:
                diagnostic.append(identity)
        receipts.append(receipt)
    providers = []
    for path in sorted(args.run.glob('*.json')):
        hashes[path.name] = sha256(path.read_bytes()).hexdigest()
        if path.name.endswith('.provider.json'):
            providers.append(json.loads(path.read_text()))
    if len(providers) != len(identities) + config['B_semanticGenerationCalls']:
        raise ValueError('Provider response denominator is incomplete')
    tokens = Counter()
    for reply in providers:
        usage = reply['usage']
        for key in ('prompt_tokens', 'completion_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens'):
            if type(usage.get(key)) is not int or usage[key] < 0:
                raise ValueError(f'Missing measured usage: {key}')
            tokens[key] += usage[key]
    if tokens['prompt_tokens'] != tokens['prompt_cache_hit_tokens'] + tokens['prompt_cache_miss_tokens']:
        raise ValueError('Cache usage does not reconcile')
    arms = {}
    for arm in ('A', 'B', 'C'):
        selected = [r for r in receipts if r['arm'] == arm]
        latency = sorted(r['elapsedSeconds'] for r in selected)
        arms[arm] = dict(attempts=len(selected), exact=sum(r['correct'] for r in selected),
            errors=sum(r['status'] == 'error' for r in selected),
            p50Seconds=statistics.median(latency), p95Seconds=latency[int(0.95 * (len(latency) - 1))],
            byGroup={group: dict(attempts=sum(r['group'] == group for r in selected),
                exact=sum(r['correct'] for r in selected if r['group'] == group))
                for group in sorted({r['group'] for r in selected})})
    peak = (tokens['prompt_cache_hit_tokens'] * .006 + tokens['prompt_cache_miss_tokens'] * .3
            + tokens['completion_tokens'] * 1.2) / 1_000_000
    report = dict(mode='real_model_receipt_audit', auditedAt=datetime.now(timezone.utc).isoformat(),
        providerResponses=len(providers), questionReceipts=len(receipts), arms=arms, usage=dict(tokens),
        requestedModel=config['model'], observedModels=sorted({p['model'] for p in providers}),
        observedFingerprints=sorted({p.get('system_fingerprint') for p in providers}, key=str),
        estimateUSD=dict(allOffPeak=peak / 2, allPeak=peak, scope='273 formal calls including B generation, not invoice',
            pricingSource='https://api-docs.deepseek.com/quick_start/pricing/', pricingObserved='2026-11-12'),
        postHocAliasRounding=dict(cases=diagnostic, perArm=dict(Counter(i[0] for i in diagnostic)),
            aliases=aliases, note='Diagnostic only. Original scores unchanged; extra columns retained.'),
        humanMaintenanceMinutes=None, scientificAcceptance='not_assessed', evidenceSHA256=hashes)
    with args.output.open('x') as stream:
        stream.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('evidenceSHA256', 'postHocAliasRounding')}, indent=2))


if __name__ == '__main__':
    main()
