"""Opt-in actual solver identity drift and retained-history gate; no downloads."""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

if os.environ.get('CONTROL_LAB_REQUIRE_SOLVERS') != '1':
    raise SystemExit('Set CONTROL_LAB_REQUIRE_SOLVERS=1 for real ngspice acceptance')
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'apps/control-lab/backend'))
from control_lab.store import ExperimentStore
from control_lab.experiments import Invalid

root = Path(tempfile.mkdtemp(prefix='pero-ngspice-identity-'))
program = shutil.which('ngspice')
assert program, 'ngspice must already be installed'
for name in ('first', 'second'):
    (root / name).mkdir()
    shutil.copy2(program, root / name / 'ngspice')
original_path = os.environ['PATH']
os.environ['PATH'] = str(root / 'first') + os.pathsep + original_path
store = ExperimentStore(root / 'records')
try:
    record = store.create({'templateId':'active-filter', 'candidateBudget':1})
    store.start(record['id'], 'search')
    store.worker.join(timeout=30)
    assert not store.worker.is_alive(), 'solver deadline'
    completed = store.read(record['id'])
    assert completed['trials'] and all(t['status']=='completed' for t in completed['trials']), completed
    store.lock_candidate(record['id'], 'baseline')
    original = store.export(record['id'])
    os.environ['PATH'] = str(root / 'second') + os.pathsep + original_path
    try:
        store.start(record['id'], 'verify')
        raise AssertionError('Changed native binding was accepted')
    except Invalid as error:
        assert 'executable changed' in str(error), error
    assert store.export(record['id']) == original
    os.environ['PATH'] = str(root / 'first') + os.pathsep + original_path
    store.start(record['id'], 'verify')
    store.worker.join(timeout=30)
    restored = store.read(record['id'])
    assert any(t['phase']=='verification' and t['status']=='completed' for t in restored['trials'])
    native = restored['nativeExecutable']
    (root / 'result.json').write_text(json.dumps({'native':native, 'experiment':record['id'],
        'checks':['real active-filter calculation','changed executable refusal','history unchanged','original executable recovery']},indent=2))
    print(root)
finally:
    store.close()
