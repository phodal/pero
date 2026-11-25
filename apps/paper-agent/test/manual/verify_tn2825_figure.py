"""Recheck the Figure 10 digitization with a separate Poppler raster and tick pair."""

import argparse
from fractions import Fraction
from hashlib import sha256
import json
from pathlib import Path


PDF_DIGEST = 'd03f1dabbc5fecbc8333443794ba9c33fb6632c2af9efd0237d76a96528829b8'
PAGE_DIGEST = 'fc24055886409c262f1bec6c02482c6a068f5a6efebbd7ff16f81f163135a1bf'
FIGURE_REGION = {'x': 0.27, 'y': 0.12, 'width': 0.46, 'height': 0.63}
IDENTITY = {
    'metric': 'Upper-surface section normal-force coefficient',
    'condition': 'Mach 0.7 at the printed tick; angle of attack 4 degrees',
    'series': 'NACA 0006 solid curve',
    'statistic': 'approximate visually selected point',
    'unit': 'dimensionless',
}


def verify(directory):
    for filename, expected in (('source.pdf', PDF_DIGEST), ('independent-page.png', PAGE_DIGEST)):
        if sha256((directory / filename).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Unexpected source bytes: {filename}')

    report = json.loads((directory / 'report.json').read_text())
    frozen = report.get('reference') or {}
    reference = frozen.get('reference') or {}
    anchor = reference.get('anchor') or {}
    if (not frozen.get('id') or reference.get('status') != 'numeric_ready'
            or reference.get('identity') != IDENTITY or anchor != report.get('anchor')
            or anchor.get('page') != 28 or anchor.get('rects') != [FIGURE_REGION]
            or anchor.get('fileDigest') != PDF_DIGEST):
        return {'digitization': 'INCONCLUSIVE', 'paperVerdict': 'INCONCLUSIVE',
                'reason': 'No matching reviewed and frozen Figure 10 reference.'}

    binding = {key: frozen[key] for key in ('assessmentId', 'annotationId', 'reference')}
    canonical = json.dumps(binding, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    if sha256(canonical.encode('utf-8')).hexdigest() != frozen['id']:
        raise ValueError('Frozen reference content does not match its digest')

    # Marks read from the independent 1619 × 2071 full-page raster at 185 DPI.
    # The Mach .7 gridline is x=910 at the crossing. Its irregular tick spacing
    # never enters the y-axis arithmetic. Allow for the merged curve/grid strokes.
    upper_tick, zero_tick = 272, 945
    low_pixel, high_pixel = 520, 526
    bounds = [Fraction(4, 5) * Fraction(zero_tick - y, zero_tick - upper_tick)
              for y in (high_pixel, low_pixel)]
    saved_value = Fraction(str(reference['value']))
    return {
        'referenceId': frozen['id'], 'page': 28, 'figure': '10',
        'machGridlineX': 910, 'curvePixelY': [low_pixel, high_pixel],
        'tickPixelsY': {'.8': upper_tick, '0': zero_tick},
        'independentReadingInterval': [float(value) for value in bounds],
        'frozenReading': float(saved_value),
        'digitization': 'CONSISTENT' if bounds[0] <= saved_value <= bounds[1] else 'DISAGREES',
        'paperVerdict': 'INCONCLUSIVE',
        'reason': 'Two readings of the same scan. The review is AI-labelled and the raw experiment was not rerun.',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', type=Path, default=Path(__file__).resolve().parent)
    print(json.dumps(verify(parser.parse_args().directory), indent=2))
