"""Run the frozen, offline D reference arm through real Data exports."""
import argparse
from dataclasses import asdict, replace
from hashlib import sha256
import csv
import io
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
from threading import Event, Thread

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / 'apps/data/backend'))
from catalog import Catalog, ImportFile
from analysis import Analysis
from semantics import Definition, QueryIntent, ReadGrant, SemanticSnapshot
from query_store import DataSnapshot, QueryReceipt, ReadOnlyQuery, save


def build_snapshot(output, catalog, label, definitions_file, dataset_id=''):
    source = (HERE / 'fixtures/iris.data').read_bytes()
    records = list(csv.reader(io.StringIO(source.decode().strip())))
    # A synthetic amendment tests history. It does not correct the UCI publication.
    if label == 'v2':
        records[0][0] = '5.2'
    fields = ('sample_id', 'sepal_length_cm', 'sepal_width_cm', 'petal_length_cm', 'petal_width_cm', 'species')
    buffer = io.StringIO(newline='')
    writer = csv.writer(buffer, lineterminator='\n')
    writer.writerow(fields)
    writer.writerows((index, *row) for index, row in enumerate(records, 1))
    asset = catalog.import_file(ImportFile('iris.csv', 'dataset', buffer.getvalue().encode(),
        'UCI Iris; derived row identities' if label == 'v1' else 'Synthetic amendment for history verification',
        'CC-BY-4.0', dataset_id, 'public-iris-study'))
    dataset_id = next(d.id for d in catalog.datasets if asset.id in d.versions)
    export = Analysis(catalog).export(dict(datasetId=dataset_id, assetId=asset.id))
    export_content = export['content'].encode()
    export_file = f'{label}.export.json'
    (output / export_file).write_bytes(export_content)
    data = json.loads(export_content)
    if data['manifest']['sha256'] != asset.sha256 or data['manifest']['records'] != 150:
        raise ValueError('Unexpected Data export provenance or count')
    synthetic = json.loads((HERE / 'fixtures/synthetic.json').read_bytes())
    database = output / f'{label}.sqlite'
    connection = sqlite3.connect(database)
    try:
        connection.executescript((HERE / 'schema.sql').read_text())
        connection.execute('INSERT INTO dataset_version VALUES (?,?,?)',
                           (label, export['id'], sha256(source).hexdigest()))
        for row in data['rows']:
            sample_id = int(row['sample_id'])
            connection.execute('INSERT INTO sample VALUES (?,?,?,?,?,?)',
                               (sample_id, label, *(float(row[field]) for field in fields[1:5])))
            connection.execute('INSERT INTO annotation VALUES (?,?)', (sample_id, row['species']))
        connection.executemany('INSERT INTO run VALUES (?,?,?,?,?,?,?,?)', synthetic['runs'])
        connection.executemany('INSERT INTO metric VALUES (?,?,?,?,?)', synthetic['metrics'])
        connection.commit()
        tables = tuple(row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"))
        columns = tuple((table, tuple(row[1] for row in connection.execute(f'PRAGMA table_info({table})'))) for table in tables)
    finally:
        connection.close()
    snapshot = DataSnapshot(label, database, sha256(database.read_bytes()).hexdigest(), export_file,
                            sha256(export_content).hexdigest(), asset.id, asset.sha256, dataset_id,
                            sha256(source).hexdigest(), sha256((HERE / definitions_file).read_bytes()).hexdigest(),
                            sha256((HERE / 'fixtures/synthetic.json').read_bytes()).hexdigest(),
                            sha256((HERE / 'schema.sql').read_bytes()).hexdigest())
    semantic = SemanticSnapshot(label, tuple(Definition.admit(row) for row in
                                json.loads((HERE / definitions_file).read_bytes())['definitions']))
    grant = ReadGrant('local-study-reader', 'public-iris-study', columns)
    return snapshot, semantic, grant


def safety_probes(snapshot, grant, budget, output):
    query = ReadOnlyQuery(snapshot.database, grant, budget)
    probes = {
        'ddl': 'CREATE TABLE injected (id INTEGER)',
        'dml': 'UPDATE run SET status=\'complete\'',
        'attach': "ATTACH DATABASE ':memory:' AS external",
        'multiple_statements': 'SELECT COUNT(*) FROM sample; DELETE FROM sample',
        'load_extension': "SELECT load_extension('not-a-library')",
        'read_file': "SELECT readfile('/etc/passwd')",
        'cross_database': 'SELECT * FROM external.sample',
        'schema_read': 'SELECT sql FROM sqlite_master',
        'pragma_write': 'PRAGMA query_only=OFF',
        'resource_budget': 'SELECT COUNT(*) FROM sample a, sample b, sample c, sample d',
    }
    checks = []
    for name, sql in probes.items():
        try:
            query.execute(sql, {})
        except sqlite3.DatabaseError as error:
            checks.append(dict(name=name, passed=True, error=str(error)))
        else:
            checks.append(dict(name=name, passed=False))
    for name, limited, sql in (
        ('table_scope', replace(grant, columns=tuple((t, c) for t, c in grant.columns if t != 'metric')), 'SELECT * FROM metric'),
        ('column_scope', replace(grant, columns=(('sample', ('sample_id',)),)), 'SELECT sepal_length_cm FROM sample'),
    ):
        try:
            ReadOnlyQuery(snapshot.database, limited, budget).execute(sql, {})
        except sqlite3.DatabaseError as error:
            checks.append(dict(name=name, passed=True, error=str(error)))
        else:
            checks.append(dict(name=name, passed=False))
    # Signal actual VM progress before cancellation; no timing sleep or racing timestamp.
    started, cancel = Event(), Event()
    outcome = []

    def running_query():
        try:
            ReadOnlyQuery(snapshot.database, grant, 10**12).execute(
                'SELECT COUNT(*) FROM sample a, sample b, sample c, sample d, sample e', {}, cancel, started)
        except sqlite3.DatabaseError as error:
            outcome.append(str(error))

    thread = Thread(target=running_query)
    thread.start()
    began = started.wait(5)
    cancel.set()
    thread.join(5)
    if thread.is_alive():
        raise RuntimeError('Cancellation did not terminate query')
    checks.append(dict(name='running_cancellation', passed=began and outcome == ['interrupted'], error=outcome))
    # Source or user text remains a bound value, never SQL or an authority grant.
    injected = query.execute('SELECT COUNT(*) AS count FROM annotation WHERE species=:species',
                             {'species': "' OR 1=1; ATTACH DATABASE '/etc/passwd' AS x; --"})
    checks.append(dict(name='bound_injection', passed=injected.rows == ({'count': 0},)))
    checks.append(dict(name='database_unchanged', passed=sha256(snapshot.database.read_bytes()).hexdigest() == snapshot.database_sha256))
    save(output / 'safety.json', checks)
    if not all(check['passed'] for check in checks):
        raise AssertionError(checks)
    return checks


def run(output):
    frozen = json.loads((HERE / 'freeze.json').read_bytes())
    for name, digest in frozen['files'].items():
        if sha256((HERE / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f'Frozen input changed: {name}')
    output.mkdir(parents=True, exist_ok=False)
    inputs = output / 'inputs'
    inputs.mkdir()
    for name in [*frozen['files'], 'freeze.json']:
        destination = inputs / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(HERE / name, destination)
    catalog = Catalog(output / 'data-home')
    snapshot, semantics, grant = build_snapshot(output, catalog, 'v1', 'definitions.v1.json')
    policy = json.loads((HERE / 'policy.json').read_bytes())
    intents = tuple(QueryIntent.admit(value) for value in json.loads((HERE / 'manual-plans.json').read_bytes())['plans'])
    receipts = output / 'receipts'
    receipts.mkdir()
    query = ReadOnlyQuery(snapshot.database, grant, policy['sql_vm_budget'])
    for repetition in range(1, policy['repetitions'] + 1):
        for intent in intents:
            decision = semantics.decide(intent, grant)
            rows = query.execute(decision.definition.sql, dict(intent.parameters)) if decision.definition else None
            QueryReceipt.record(receipts, intent, decision, grant, snapshot, repetition, rows, policy['presentation_row_cap'])
    safety = safety_probes(snapshot, grant, policy['sql_vm_budget'], output)
    original_files = {path: sha256(path.read_bytes()).hexdigest() for path in receipts.iterdir()}
    original_files[snapshot.database] = snapshot.database_sha256
    original_asset = catalog.files / snapshot.asset_id
    original_files[original_asset] = snapshot.asset_sha256
    original_files[output / snapshot.export_file] = snapshot.export_sha256
    # Publish a new Data asset in the same dataset plus a new definition revision.
    second, second_semantics, second_grant = build_snapshot(output, catalog, 'v2', 'definitions.v2.json', snapshot.dataset_id)
    revised_intent = replace(next(intent for intent in intents if intent.question == 'B03'), snapshot='v2')
    decision = second_semantics.decide(revised_intent, second_grant)
    revised_rows = ReadOnlyQuery(second.database, second_grant, policy['sql_vm_budget']).execute(
        decision.definition.sql, dict(revised_intent.parameters))
    revised = output / 'v2-receipts'
    revised.mkdir()
    QueryReceipt.record(revised, revised_intent, decision, second_grant, second, 1, revised_rows, 100)
    # Reopen the actual Data catalog and export the old version again after new publication.
    reopened = Catalog(output / 'data-home')
    old_export = Analysis(reopened).export(dict(datasetId=snapshot.dataset_id, assetId=snapshot.asset_id))
    history = dict(
        old_files_unchanged=all(sha256(path.read_bytes()).hexdigest() == digest for path, digest in original_files.items()),
        old_export_reproduced=old_export['id'] == snapshot.export_sha256,
        dataset_versions=list(reopened.dataset(snapshot.dataset_id).versions),
        old_receipt=QueryReceipt.replay(receipts / 'B03-1.receipt.json'),
        new_receipt=QueryReceipt.replay(revised / 'B03-1.receipt.json'),
        revision_scope='Synthetic first-row amendment and explicit cm-to-mm definition change; not a scientific correction',
    )
    if not history['old_files_unchanged'] or not history['old_export_reproduced']:
        raise AssertionError('Historical artifacts changed')
    save(output / 'history.json', history)
    save(output / 'run.json', dict(schema=1, scope='offline manual D reference; no model or upstream deployment',
         repository_commit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip(),
         repository_dirty=bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=REPO, text=True).strip()),
         freeze_sha256=sha256((HERE / 'freeze.json').read_bytes()).hexdigest(),
         python_version=sys.version, sqlite_version=sqlite3.sqlite_version,
         repetitions=policy['repetitions'], receipt_count=len(list(receipts.glob('*.receipt.json'))),
         safety_passed=len(safety), model_arms=dict(A='not_run', B='not_run', C='not_run'),
         model_usage=None, maintenance_time=None))
    print(f'Wrote frozen study evidence: {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='New directory; existing paths are never overwritten')
    run(parser.parse_args().output.resolve())
