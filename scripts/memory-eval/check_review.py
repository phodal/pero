#!/usr/bin/env python3
"""Replay review failure/checkpoint recovery in fresh processes over real files."""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def check(args):
    root = args.output.absolute()
    root.mkdir(parents=True, exist_ok=False)
    command = [sys.executable, str(Path(__file__).with_name('review_run.py').resolve()),
               '--search-binary', str(args.search_binary.resolve())]
    attempts = [('off', 'off', [], 0),
                ('failure', 'recovery', ['--approve', '--fail-after-artifact'], 3),
                ('recover', 'recovery', ['--approve', '--resume'], 0),
                ('retry', 'recovery', ['--approve', '--resume'], 0)]
    receipts = []
    for name, folder, flags, expected in attempts:
        completed = subprocess.run(command + ['--output', str(root / folder)] + flags,
                                   capture_output=True, text=True, timeout=20)
        (root / (name + '.stdout')).write_text(completed.stdout)
        (root / (name + '.stderr')).write_text(completed.stderr)
        assert completed.returncode == expected, (name, completed.stderr)
        checkpoint = root / folder / 'checkpoint.json'
        if name in ('off', 'failure'):
            assert not checkpoint.exists(), name
        else:
            state = json.loads(checkpoint.read_text())
            assert state['revision'] == 1 and state['watermark'] == 3
            assert len(state['active']) == len(state['history']) == 1
        receipts.append({'attempt': name, 'exit_code': completed.returncode,
                         'checkpoint_exists': checkpoint.exists()})
    report = json.loads((root / 'recovery/report.json').read_text())
    assert report['immutable_versions'] == 1
    assert report['revocation_hides_context'] is True
    assert all(row['same_decision'] for row in report['wiki_comparison'])
    assert all(row['search_calls'] > 1 for row in report['wiki_comparison'])
    report['process_recovery'] = receipts
    (root / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print('PASS default-off, interrupted publication, fresh-process recovery, idempotent retry, actual search/Wiki parity')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--search-binary', type=Path, required=True)
    check(parser.parse_args())
