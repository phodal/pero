"""Seed a local Control Lab store and emit the bytes returned by its export route."""

from pathlib import Path
import sys

control = Path(__file__).resolve().parents[4] / 'apps' / 'control-lab'
sys.path[:0] = [str(control / 'backend'), str(control / 'test')]

from control_lab.experiments import ExperimentSpec, canonical
from control_lab.store import ExperimentStore
from test_verification import observed


def main(directory):
    request = {'templateId': 'pi-golden', 'candidateBudget': 1,
               'parameters': {'horizon': 2, 'samples': 201}}
    spec = ExperimentSpec.parse(request)

    def execute(_engine, _model, _parameters, scenario, artifacts, _cancelled):
        (artifacts / 'solver.txt').write_text('Fixture observation · µ\n', encoding='utf-8')
        scenario = next(item for item in spec.scenarios if dict(item.parameters) == scenario)
        return observed(spec, scenario).to_dict()

    store = ExperimentStore(directory, execute)
    try:
        identity = store.create(request)['id']
        store.start(identity, 'baseline')
        store.worker.join(timeout=5)
        assert not store.worker.is_alive()
        store.lock_candidate(identity, 'baseline')
        store.start(identity, 'verify')
        store.worker.join(timeout=5)
        assert not store.worker.is_alive()
        export = store.export(identity)
        assert [trial['status'] for trial in export['experiment']['trials']] == ['completed', 'completed']
        sys.stdout.buffer.write(canonical(export))
    finally:
        store.close()


if __name__ == '__main__':
    main(sys.argv[1])
