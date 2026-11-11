"""Independent Decimal oracle for a delivered P3 task, without importing analysis."""
import csv
from decimal import Decimal
import hashlib
import json
from pathlib import Path

source = Path('measurements.csv')
rows = list(csv.DictReader(source.read_text().splitlines()))
pairs = [row for row in rows if row['before'] and row['after']]
result = json.loads(Path('result.json').read_text())
selected = json.loads(Path('skill-selection.json').read_text())
checks = {
    'source_identity': result['input']['sha256'] == hashlib.sha256(source.read_bytes()).hexdigest(),
    'selected_installed_versions': result['methods'] == selected['methods'] and len(selected['methods']) == 2,
    'complete_pair_denominator': result['analysis']['complete_pairs'] == len(pairs) == 4,
    'missing_without_imputation': result['analysis']['missing_ids'] == ['p5'],
    'before_mean': Decimal(str(result['analysis']['before_mean'])) == sum(Decimal(row['before']) for row in pairs) / len(pairs),
    'after_mean': Decimal(str(result['analysis']['after_mean'])) == sum(Decimal(row['after']) for row in pairs) / len(pairs),
    'paired_change': Decimal(str(result['analysis']['mean_change'])) == sum(Decimal(row['after']) - Decimal(row['before']) for row in pairs) / len(pairs) == 3,
    'tests_ran': 'Ran 2 tests' in Path('tests.log').read_text() and '\nOK\n' in Path('tests.log').read_text(),
    'fixture_scope': result['mode'] == 'scripted-provider-real-tools' and len(result['unknown']) == 3,
}
receipt = {'passed': all(checks.values()), 'checker': 'Independent source CSV / Decimal; no analyze import', 'checks': checks}
Path('independent-check.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
assert receipt['passed']
