"""Deterministic fixture authored for the real Host/Harness P3 tool trajectory."""
import hashlib
import json
import platform
from pathlib import Path
import sys

from analyze import read_measurements, summarize

source = Path('measurements.csv')
selection = json.loads(Path('skill-selection.json').read_text())
environment = {'python': platform.python_version(), 'executable': sys.executable,
               'platform': platform.platform(), 'dependencies': 'Python standard library'}
result = {'mode': 'scripted-provider-real-tools', 'analysis': summarize(read_measurements(source)),
          'input': {'path': source.name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()},
          'methods': selection['methods'], 'environment': environment,
          'unknown': ['Real-model method selection and research quality not evaluated',
                      'No significance, causal inference or human scientific acceptance',
                      'No Native, Windows/Linux or signed-package acceptance in this run']}
Path('result.json').write_text(json.dumps(result, indent=2) + '\n')
Path('environment.json').write_text(json.dumps(environment, indent=2) + '\n')
Path('report.md').write_text(
    '# Paired measurement report — deterministic fixture\n\n'
    f"{result['analysis']['complete_pairs']} complete pairs: "
    f"{result['analysis']['before_mean']} → {result['analysis']['after_mean']} mg/L; "
    f"mean paired change {result['analysis']['mean_change']} mg/L.\n\n"
    'p5 has no after measurement and is excluded without imputation. No significance, '
    'causality or population generalization is claimed.\n\n'
    f"Input SHA-256: `{result['input']['sha256']}`.\n\n"
    'Exact selected skill IDs, revisions and instruction hashes: skill-selection.json. '
    'Observed interpreter: environment.json. Actual test output: tests.log. '
    'Independent Decimal calculation: independent-check.json.\n\n'
    'Reproduce in the delivered file directory:\n\n'
    '```sh\npython3 -m unittest discover -p "test_*.py" -v\n'
    'python3 workflow.py\npython3 check_task.py\n```\n\n'
    'The scripted loopback provider issued the real tool calls; code and decisions are '
    'hand-authored fixtures, not evidence of model research quality. The Host artifact '
    'owner stores readable versions; Notebook attachment is not claimed.\n')
print(json.dumps({'completed': True, 'input': result['input'], 'analysis': result['analysis']}))
