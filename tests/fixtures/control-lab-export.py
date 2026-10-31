"""Validate a downloaded portable export using the existing pure domain verifier.

No solver, tolerance, float normalization, or replacement evidence is used.
"""
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'apps/control-lab/backend'))
from control_lab.experiments import Candidate, ExperimentSpec, canonical
from control_lab.verification import Observation, aggregate


def validate(path):
    bundle = json.loads(Path(path).read_bytes())
    record = bundle['experiment']
    spec = ExperimentSpec.restore(record)
    assert spec.hash == record['specHash'], 'Exported frozen specification digest changed'
    artifacts = {(item['trialId'], item['name']): item for item in bundle['artifacts']}
    assert len(artifacts) == len(bundle['artifacts']), 'Duplicate exported artifact'
    observations = 0
    for trial in record['trials']:
        if trial.get('observation'):
            Observation.parse(trial['observation'])
            observations += 1
        refs = (trial.get('observation') or {}).get('artifacts', trial.get('failureArtifacts', []))
        for reference in refs:
            artifact = artifacts[(trial['id'], reference['name'])]
            actual = hashlib.sha256(artifact['text'].encode('utf-8')).hexdigest()
            assert actual == artifact['sha256'] == reference['sha256'], 'Exported artifact bytes changed'
    if record.get('report'):
        lock = record['candidateLock']
        candidate = Candidate(lock['candidateId'], 'Locked candidate', tuple(lock['parameters'].items()))
        report = aggregate(spec, record['lockedCandidateId'], record['trials'], 'verification',
                           record.get('verificationOperationId'), candidate).to_dict()
        assert canonical(report) == canonical(record['report']), 'Exported evidence does not reproduce the exact saved report'
    return dict(experimentId=record['id'], specHash=spec.hash, observations=observations,
                artifacts=len(artifacts), reportReproduced=bool(record.get('report')))


if __name__ == '__main__':
    print(json.dumps(validate(sys.argv[1]), sort_keys=True))
