"""Emit constructed, nonphysical score examples using the paper §6.3 implementation."""
import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_scoring import (BETA, EPSILON, TOTAL_WEIGHT, WATER_CLIP, DyeFractions,
                           TargetEstimate, run_score_mnats, target_loss_nats)

SOURCE = {
    'title': 'Semantic Representation for Agentic Self-Play in Automated Laboratories',
    'paper': 'arXiv:2610.32755v1',
    'doi': '10.48550/arXiv.2610.32755',
    'url': 'https://www.gstatic.com/science-ai/verid_semantic_lab.pdf',
    'pdf_sha256': 'b047f7609e237ca371e42fac76fe77e454cdf6bba5436388499a28ccb3f7783c',
    'section': '6.3', 'page': 13, 'equations': [1, 2, 3, 4, 5],
}

# Hand-selected mathematical cases, not measurements or the paper's target set.
CASES = (
    ('identity_zero_dyes', DyeFractions(0, 0, 0, 0), DyeFractions(0, 0, 0, 0)),
    ('concentration_only', DyeFractions(.125, .125, .125, .125), DyeFractions(.0625, .0625, .0625, .0625)),
    ('composition_only', DyeFractions(.5, 0, 0, 0), DyeFractions(0, .5, 0, 0)),
    ('water_clip_extremes', DyeFractions(0, 0, 0, 0), DyeFractions(.25, .25, .25, .25)),
)


def report():
    inputs = [{'id': identity, 'truth': asdict(truth), 'scored': asdict(scored)}
              for identity, truth, scored in CASES]
    case_bytes = json.dumps(inputs, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    return {
        'schema_version': 1,
        'method': 'verid-v1-section-6.3-mathematical-reproduction',
        'origin': 'constructed',
        'physical': False,
        'source': SOURCE,
        'parameters': {'beta': BETA, 'epsilon': EPSILON, 'water_clip': WATER_CLIP,
                       'lambda_total': TOTAL_WEIGHT, 'dye_order': ['red', 'green', 'blue', 'yellow'],
                       'input_unit': 'full-strength-stock fraction', 'logarithm': 'natural',
                       'target_unit': 'nats', 'run_unit': 'mnats', 'targets_per_run': 4},
        'case_set_sha256': hashlib.sha256(case_bytes).hexdigest(),
        'targets': [dict(item, truth_water=truth.water, scored_water=scored.water,
                         loss_nats=target_loss_nats(truth, scored))
                    for item, (_, truth, scored) in zip(inputs, CASES)],
        'run_score_mnats': run_score_mnats(tuple(TargetEstimate(truth, scored) for _, truth, scored in CASES)),
        'limitations': [
            'Four hand-selected mathematical vectors, not paper experimental data or optical readouts.',
            'Only the published equations are reproduced; no wet-lab execution or calibration.',
            'Not a reproduction of the paper’s reported 307→58 mnats result or agent improvement.',
            'Separate from Lab’s single-dye illustrative fixture and its independent verification policy.',
            'Independent analytic high-precision golden cases are in test/test_paper_scoring.py.',
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Write JSON to this file; default: standard output')
    args = parser.parse_args()
    text = json.dumps(report(), indent=2, sort_keys=True, allow_nan=False) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding='utf-8')
    else:
        print(text, end='')


if __name__ == '__main__':
    main()
