"""App state for the pinned case. Environment matching and cluster jobs stay with their owners."""
import json
import os
from pathlib import Path

import csv

from .catalog import load_rows
from .identity import model_canonical, overlap
from .domain import COMMIT, EXAMPLE_SETS, METHOD, PAPER, POPULATION, REPORTED_MAE_PP, UPSTREAM, Invalid, cf_agreement, example_agreement, product_smiles, published_fit, type_counts, unique_products, yield_table_verdict
from .rerun import pinned_tables, run_predictions, score, verify_checkout

PAPER_REASON = 'The released yield columns match 4.74 percentage points only as published arithmetic. Chromatograms were not remeasured, and a correction-factor rerun does not recompute those yields.'


def _data_root():
    raw = os.environ.get('PERO_APP_DATA')
    if not raw:
        return None
    root = Path(raw)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _read_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return None


def checkout_path():
    root = _data_root()
    if root is None:
        return None
    candidate = root / 'upstream'
    try:
        return str(verify_checkout(candidate))
    except Invalid:
        return None


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix('.pending')
    pending.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding='utf-8')
    pending.replace(path)


def load_rerun():
    root = _data_root()
    if root is None:
        return None
    saved = _read_json(root / 'rerun.json')
    if not isinstance(saved, dict) or saved.get('commit') != COMMIT:
        return None
    return saved


def load_examples(name):
    root = _data_root()
    if root is None:
        return None
    saved = _read_json(root / f'examples-{name}.json')
    if not isinstance(saved, dict) or saved.get('commit') != COMMIT or saved.get('set') != name:
        return None
    return saved


def execute_examples(name='readme'):
    examples = EXAMPLE_SETS.get(name)
    if examples is None:
        raise Invalid('example', 'Choose the README demo or the reaction-type examples')
    path = checkout_path()
    if not path:
        raise FileNotFoundError('Prepare the environment before running the official examples')
    predicted = run_predictions(path, [item[1] for item in examples])
    report = {
        'status': example_agreement(predicted, examples),
        'commit': COMMIT,
        'set': name,
        'predictions': [
            {'id': item[0], 'smiles': item[1], 'published': item[2], 'predicted': predicted[index]}
            for index, item in enumerate(examples)
        ],
    }
    root = _data_root()
    if root is not None:
        _write(root / f'examples-{name}.json', report)
    return report


def execute_custom(smiles):
    if not isinstance(smiles, list) or not 1 <= len(smiles) <= 32 or any(not isinstance(item, str) or not item.strip() or len(item) > 500 for item in smiles):
        raise Invalid('smiles', 'Provide 1 to 32 SMILES, each at most 500 characters')
    path = checkout_path()
    if not path:
        raise FileNotFoundError('Prepare the environment before running weights')
    predicted = run_predictions(path, smiles)
    report = {'commit': COMMIT, 'predictions': [{'smiles': item, 'predicted': predicted[index]} for index, item in enumerate(smiles)]}
    root = _data_root()
    if root is not None:
        _write(root / 'custom.json', report)
    return report


def execute_rerun(rows):
    path = checkout_path()
    if not path:
        raise FileNotFoundError('Prepare the environment before running weights')
    predicted = run_predictions(path, [row.product_smiles for row in rows])
    report = score([row.cf_pred for row in rows], predicted)
    report['commit'] = COMMIT
    root = _data_root()
    if root is not None:
        _write(root / 'rerun.json', report)
    return report


def identity_status(checkout):
    """Compare training and evaluation molecules with the model's RDKit parse.

    Pretraining and fine-tuning are the training sets. FDA, reaction products,
    and the two isolated-yield tables are the released evaluation sets. Bytes are
    checked before RDKit is imported.
    """
    if not checkout:
        return {'status': 'UNRUN', 'reason': 'The pinned release is not in app data'}
    root = Path(checkout)
    if root.is_symlink() or not root.is_dir():
        return {'status': 'FAIL', 'reason': 'The pinned checkout is not a canonical directory'}
    root = root.resolve()
    try:
        tables = pinned_tables(root)
    except Invalid as error:
        return {'status': 'FAIL', 'reason': error.detail}
    try:
        from rdkit import Chem
        from rdkit import RDLogger
    except ImportError:
        return {'status': 'UNRUN', 'reason': 'RDKit is not installed in this interpreter'}
    RDLogger.DisableLog('rdApp.*')
    groups = {}
    for name, kind, data in tables:
        rows = list(csv.DictReader(data.decode('utf-8').splitlines()))
        column = 'SMILES' if kind == 'smiles' else 'RXN Smiles'
        if not rows or column not in rows[0]:
            return {'status': 'FAIL', 'reason': f'{name} is missing its released SMILES column'}
        if kind == 'reaction':
            try:
                smiles = [product_smiles(row[column]) for row in rows]
            except Invalid as error:
                return {'status': 'FAIL', 'reason': error.detail}
        else:
            smiles = [row[column] for row in rows]
        groups[name] = [model_canonical(Chem, value) for value in smiles]
    return {'status': 'RECORDED', **overlap(groups)}


def _example_state(name):
    examples = EXAMPLE_SETS[name]
    saved = load_examples(name)
    predictions = {item['id']: item.get('predicted') for item in saved.get('predictions', [])} if isinstance(saved, dict) else {}
    status = saved.get('status') if isinstance(saved, dict) else 'UNRUN'
    if status not in ('PASS', 'FAIL'):
        status = 'UNRUN'
    return {
        'status': status,
        'items': [
            {'id': item[0], 'smiles': item[1], 'published': item[2], 'predicted': predictions.get(item[0])}
            for item in examples
        ],
    }


def build_state():
    rows = load_rows()
    verdict, mae = yield_table_verdict(rows)
    rerun = load_rerun()
    predictions = rerun.get('predictions') if isinstance(rerun, dict) else None
    if predictions is None:
        prediction_status = 'UNRUN'
    elif not isinstance(predictions, list) or any(not isinstance(value, str) for value in predictions):
        predictions = None
        prediction_status = 'FAIL'
    else:
        try:
            prediction_status = cf_agreement([row.cf_pred for row in rows], predictions)
        except Invalid:
            predictions = None
            prediction_status = 'FAIL'
    reactions = []
    for row in rows:
        reactions.append({
            'index': row.index,
            'reactionType': row.reaction_type,
            'name': row.name,
            'productSmiles': row.product_smiles,
            'yieldExp': row.yield_exp,
            'yieldPred': row.yield_pred,
            'cfExp': row.cf_exp,
            'cfPred': row.cf_pred,
            'cfRerun': None if predictions is None else predictions[row.index],
        })
    return {
        'schema': 'pero.lcms2yield.case.v1',
        'commit': COMMIT,
        'upstream': UPSTREAM,
        'paper': PAPER,
        'method': METHOD,
        'population': POPULATION,
        'uniqueProducts': unique_products(rows),
        'yieldMaePercentagePoints': format(mae, 'f'),
        'reportedMaePercentagePoints': format(REPORTED_MAE_PP, 'f'),
        'verdicts': {
            'yieldTable': verdict,
            'prediction': prediction_status,
            'paper': 'INCONCLUSIVE',
        },
        'paperReason': PAPER_REASON,
        'typeCounts': type_counts(rows),
        'fit': published_fit(rows),
        'examples': _example_state('readme'),
        'showcase': _example_state('showcase'),
        'custom': _read_json(_data_root() / 'custom.json') if _data_root() else None,
        'checkout': checkout_path(),
        'identity': identity_status(checkout_path()),
        'compute': {'connected': False, 'jobs': None, 'destination': '/apps/compute'},
        'links': {
            'environments': '/apps/environments',
            'compute': '/apps/compute',
            'workers': '/workers',
            'method': METHOD,
        },
        'reactions': reactions,
    }
