"""A deterministic descriptive analysis, not a model-generated scientific claim."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import platform
from dataclasses import dataclass
from pathlib import Path
from statistics import mean


@dataclass(frozen=True)
class PairedMeasurement:
    identity: str
    before: float | None
    after: float | None


def read_measurements(path: Path) -> tuple[PairedMeasurement, ...]:
    """Validate the external CSV once; calculations receive typed measurements."""
    rows = []
    identities = set()
    with path.open(newline='') as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != ['sample_id', 'before', 'after', 'unit']:
            raise ValueError('Expected sample_id,before,after,unit')
        for raw in reader:
            identity = raw['sample_id'].strip()
            if not identity or identity in identities:
                raise ValueError('Missing or duplicate sample identity')
            identities.add(identity)
            if raw['unit'] != 'mg/L':
                raise ValueError('Expected mg/L for every observation')
            values = [float(raw[key]) if raw[key] else None for key in ['before', 'after']]
            if any(value is not None and not math.isfinite(value) for value in values):
                raise ValueError('Nonfinite measurement')
            rows.append(PairedMeasurement(identity, *values))
    return tuple(rows)


def summarize(rows: tuple[PairedMeasurement, ...]) -> dict:
    pairs = [row for row in rows if row.before is not None and row.after is not None]
    if not pairs:
        raise ValueError('No complete pairs')
    return {'total': len(rows), 'complete_pairs': len(pairs),
            'missing_ids': [row.identity for row in rows if row not in pairs],
            'before_mean': mean(row.before for row in pairs),
            'after_mean': mean(row.after for row in pairs),
            'mean_change': mean(row.after - row.before for row in pairs), 'unit': 'mg/L'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).with_name('measurements.csv')
    root = Path(__file__).resolve().parents[3]
    catalog = json.loads((root / 'apps/skills/dist/market-catalog.json').read_text())
    ids = ['obra/superpowers/skills/verification-before-completion/SKILL.md',
           'K-Dense-AI/scientific-agent-skills/skills/statistical-analysis/SKILL.md']
    methods = [next(item for item in catalog['skills'] if item['id'] == identity) for identity in ids]
    result = {'mode': 'deterministic-preparation-no-model', 'analysis': summarize(read_measurements(source)),
              'input': {'path': str(source), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()},
              'methods': [{'id': item['id'], 'revision': item['source']['commit'], 'sha256': item['source']['sha256']} for item in methods],
              'environment': {'python': platform.python_version(), 'platform': platform.platform(), 'dependencies': 'Python standard library'},
              'unknown': ['Real-model skill application not run', 'No Notebook evidence attachment', 'No scientific or causal acceptance']}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    command = f'python3 tests/fixtures/skills-mixed/analyze.py --output {args.output}'
    (args.output / 'report.md').write_text(
        '# Paired measurement report\n\n'
        f"Synthetic complete-pair means: {result['analysis']['before_mean']} → {result['analysis']['after_mean']} mg/L. "
        f"Mean paired change: {result['analysis']['mean_change']} mg/L.\n\n"
        'Four complete pairs; p5 has no after measurement and is excluded without imputation. '
        'No significance, causal benefit, or population generalization is claimed.\n\n'
        f'Input SHA256: `{result["input"]["sha256"]}`. Methods and environment: [result.json](result.json).\n\n'
        f'Reproduce from the repository root: `{command}`.\n\n'
        'Independent check: `python3 tests/fixtures/skills-mixed/check.py <output-directory>`.\n\n'
        'This is deterministic preparation with actual files; no model authored or executed the analysis. '
        'Real-model, Notebook attachment and human scientific review remain unverified.\n')
