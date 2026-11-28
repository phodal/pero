"""Check an exact Pero Run against the frozen reference, without running PyBaMM."""
import json
import sys

from bundle import ROOT, load_identity
from check import read_results
from contract import digest, encoded
from dispatch import Binding, Observation, summarize, task_prompt


def verify(request):
    identity = load_identity()
    run = request['run']
    frozen = request['trial']
    experiment = next((e.id for e in identity.method.experiments
                       if frozen['task']['prompt'] == task_prompt(e.id, identity.sha256)), '')
    observation = Observation.parse(request)
    references = read_results(ROOT / 'reference.jsonl')
    binding = Binding(experiment, frozen['worker_id'], run['task_id'], run['id'])
    row = summarize(binding, observation, references.get(experiment), identity)
    output = {'status': row.verification, 'experiment': experiment, 'method_digest': identity.sha256,
              'result_digest': row.result_sha256, 'reason': row.reason}
    if row.verification == 'consistent':
        result = json.loads(json.loads(observation.result_messages[0])['content'])
        output['environment_digest'] = digest(encoded({
            field: result[field] for field in ('environment', 'platform', 'architecture')}))
    return output


if __name__ == '__main__':
    print(json.dumps(verify(json.load(sys.stdin)), allow_nan=False))
