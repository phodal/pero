"""File entry for the pinned predictor.

DataLoader workers spawn this file. The call stays inside ``__main__`` so those
workers do not start another prediction. Loader defaults are unchanged.
"""
import json
import os
import sys
from pathlib import Path


def main():
    checkout = Path(sys.argv[1])
    smiles = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
    print(f'loaded {len(smiles)} smiles', file=sys.stderr, flush=True)
    sys.path.insert(0, str(checkout / 'model'))
    from predict import predict_by_smiles_list
    print('imported predictor', file=sys.stderr, flush=True)
    result = predict_by_smiles_list(smiles)
    predictions = result.get('preds')
    if predictions is None:
        raise SystemExit('upstream predict_by_smiles_list returned no preds')
    print('prediction returned', file=sys.stderr, flush=True)
    json.dump([format(float(value), '.17g') for value in predictions], sys.stdout)
    sys.stdout.write('\n')
    sys.stdout.flush()
    os._exit(0)


if __name__ == '__main__':
    main()
