"""Opt-in real solver data for scientific-chat.mjs; requires python-control.

Run with the Control Lab Python environment. This exercises its engine/checker,
not the App authorization/Store workflow. No model or external network is used.
"""
import hashlib
import json
from pathlib import Path
import sys
import threading

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'apps/control-lab/backend'))
from control_lab.engines import execute
from control_lab.experiments import ExperimentSpec, candidates, input_digest
from control_lab.verification import Observation, verify_observation

output = ROOT / 'test-results/scientific-chat/control'
rows = []
for kp in (1.0, 2.0):
    spec = ExperimentSpec.parse({'templateId': 'robust-pid', 'parameters': {'kp': kp}})
    candidate, scenario = candidates(spec, 1)[0], spec.scenarios[0]
    directory = output / f'kp-{kp}'
    directory.mkdir(parents=True, exist_ok=True)
    result = execute('python-control', spec.template_id, dict(candidate.parameters),
                     dict(scenario.parameters), directory, threading.Event())
    artifacts = [{'name': name, 'sha256': hashlib.sha256((directory / name).read_bytes()).hexdigest()}
                 for name in ('environment-observation.json', 'solver-input.json', 'waveforms.json')]
    observation = Observation.from_solver(result, 'python-control', artifacts,
                                          input_digest(spec, candidate, scenario))
    report = verify_observation(spec, candidate.id, observation, scenario)
    (directory / 'record.json').write_text(json.dumps({
        'spec': spec.to_dict(), 'observation': observation.to_dict(), 'report': report.to_dict(),
    }, indent=2))
    response = next(curve for curve in observation.series if curve.name == 'reference')
    rows.append({'method': f'PID kp={kp}', 'value': abs(1 - response.y[-1]),
                 'n': len(response.y), 'verification': report.to_dict()['verdict'],
                 'observation': observation.id, 'spec': spec.hash})
(output / 'results.json').write_text(json.dumps(rows, indent=2))
print(json.dumps(rows, indent=2))
