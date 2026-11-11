"""Independent Decimal calculation from the original bytes; does not import analyze."""
import csv
import hashlib
import json
import sys
from decimal import Decimal
from pathlib import Path

output = Path(sys.argv[1])
source = Path(__file__).with_name('measurements.csv')
rows = list(csv.DictReader(source.read_text().splitlines()))
result = json.loads((output / 'result.json').read_text())
pairs = [row for row in rows if row['before'] and row['after']]
change = sum(Decimal(row['after']) - Decimal(row['before']) for row in pairs) / len(pairs)
public_receipts = json.loads((output.parent / 'runtime-general-public-sources.json').read_text())
acquired = {item['id']: item for item in public_receipts['results']}
checks = {
    'actual_acquired_methods': all(acquired[item['id']]['passed'] and acquired[item['id']]['revision'] == item['revision'] and acquired[item['id']]['sha256'] == item['sha256'] for item in result['methods']),
    'input_sha256': result['input']['sha256'] == hashlib.sha256(source.read_bytes()).hexdigest(),
    'complete_pairs': result['analysis']['complete_pairs'] == len(pairs) == 4,
    'missing_identity': result['analysis']['missing_ids'] == ['p5'],
    'independent_mean_change': Decimal(str(result['analysis']['mean_change'])) == change == Decimal(3),
    'known_pair_means': result['analysis']['before_mean'] == 13 and result['analysis']['after_mean'] == 16,
    'method_versions': len(result['methods']) == 2 and all(len(item['revision']) == 40 and len(item['sha256']) == 64 for item in result['methods']),
    'scope_is_explicit': result['mode'] == 'deterministic-preparation-no-model' and len(result['unknown']) == 3,
    'report_exists': (output / 'report.md').is_file(),
}
receipt = {'passed': all(checks.values()), 'checks': checks, 'checker': 'Decimal from source CSV; separate from analysis module'}
(output / 'independent-check.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
assert receipt['passed']
