#!/usr/bin/env python3
"""Midpoint quadrature of 4/(1+x*x) on [0,1], fixed method v1.

Inputs have already been admitted by Host. A numerical check is an observation,
not scientific acceptance. No packages, network, shell or credentials required.
"""
import json
import math
from pathlib import Path
import time

spec = json.loads(Path('input.json').read_text())
n, repetitions = spec['samples'], spec['repetitions']
started = time.monotonic()
print(f'quadrature-v1 samples={n} repetitions={repetitions}', flush=True)
for repetition in range(repetitions):
    chunks = []
    for start in range(0, n, 10000):
        if time.monotonic() - started > 600:
            print('Method walltime limit reached (600 seconds)', flush=True)
            raise SystemExit(124)
        chunks.append(math.fsum(4 / (1 + ((i + 0.5) / n) ** 2)
                                for i in range(start, min(start + 10000, n))))
    estimate = math.fsum(chunks) / n
    if repetition == 0 or (repetition + 1) % 100 == 0:
        print(f'repetition={repetition + 1} estimate={estimate:.16g}', flush=True)
result = {'method': 'quadrature-v1', 'input': spec, 'estimate': estimate,
          'reference': math.pi, 'absoluteError': abs(estimate - math.pi),
          'tolerance': 1 / n ** 2, 'checkPassed': abs(estimate - math.pi) <= 1 / n ** 2,
          'scientificAcceptance': 'unreviewed'}
Path('result.json').write_text(json.dumps(result, indent=2) + '\n')
print('result.json written; numerical observation, unreviewed', flush=True)
