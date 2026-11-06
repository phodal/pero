"""Run the pinned upstream predictor and compare correction factors.

The subprocess is the upstream `predict_by_smiles_list` entry, with its loader
defaults left unchanged. Yield columns are not recomputed from this output.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from .domain import CF_ABSOLUTE_TOLERANCE, COMMIT, PREDICT_SHA256, WEIGHT_SHA256, Invalid, cf_agreement

PINNED = {
    'model/model_pth/20250721.pth': WEIGHT_SHA256,
    'model/predict.py': PREDICT_SHA256,
}
DRIVER = Path(__file__).with_name('predict_driver.py')


def _file_sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def verify_checkout(path):
    raw = Path(path)
    if raw.is_symlink():
        raise Invalid('checkout', 'Use an existing canonical, non-symlink LCMS2Yield checkout')
    root = raw.resolve()
    if not root.is_dir():
        raise Invalid('checkout', 'Use an existing canonical, non-symlink LCMS2Yield checkout')
    for relative, expected in PINNED.items():
        target = (root / relative).resolve()
        if target.is_symlink() or not target.is_relative_to(root) or not target.is_file():
            raise Invalid('asset', f'Missing pinned file {relative}')
        if _file_sha256(target) != expected:
            raise Invalid('asset', f'{relative} is not the pinned {COMMIT[:12]} release')
    return root


def run_predictions(checkout, smiles, timeout_seconds=600):
    root = verify_checkout(checkout)
    if not smiles:
        raise Invalid('population', 'There are no product SMILES to score')
    python = os.environ.get('PERO_LCMS2YIELD_PYTHON') or sys.executable
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', suffix='.json', delete=False) as handle:
        json.dump(list(smiles), handle)
        smiles_path = handle.name
    with tempfile.TemporaryFile() as err:
        try:
            completed = subprocess.run(
                [python, str(DRIVER), str(root), smiles_path],
                stdout=subprocess.PIPE, stderr=err, cwd=root / 'model', timeout=timeout_seconds, check=False,
            )
        finally:
            Path(smiles_path).unlink(missing_ok=True)
        err.seek(0)
        error_text = err.read().decode('utf-8', 'replace')
    if completed.returncode != 0:
        raise Invalid('inference', error_text[-2000:] or 'The pinned predictor exited without a correction-factor list')
    text = completed.stdout.decode('utf-8', 'replace')
    payload = next((line for line in reversed(text.splitlines()) if line.startswith('[')), '')
    try:
        values = json.loads(payload)
    except json.JSONDecodeError as error:
        raise Invalid('inference', 'The predictor did not return a JSON list') from error
    if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
        raise Invalid('inference', 'The predictor did not return decimal strings')
    return tuple(values)


def score(published, predicted):
    return {
        'status': cf_agreement(published, predicted),
        'tolerance': format(CF_ABSOLUTE_TOLERANCE, 'f'),
        'population': len(published),
        'predictions': list(predicted),
    }
