"""Opt-in official runt CLI/daemon probe; no installer, model, or Host integration."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time

from task import CELLS
from process_memory import process_memory

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--runt', type=Path, required=True)
parser.add_argument('--socket', required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--daemon-pid', type=int)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
shutil.copyfile(Path(__file__).with_name('input.csv'), output / 'input.csv')
notebook_id = None
calls = []
deadline = time.monotonic()+20
while not Path(args.socket).exists():
    if time.monotonic()>deadline:
        raise TimeoutError('Upstream daemon socket did not appear')
    time.sleep(.05)


def call(tool, values=None):
    command = [str(args.runt.resolve()), 'nb', 'call', tool, '--socket', args.socket, '--json']
    if notebook_id:
        command += ['--notebook-id', notebook_id]
    command += ['--args', json.dumps(values or {})]
    started = time.monotonic()
    result = subprocess.run(command, capture_output=True, text=True, timeout=65)
    raw = json.loads(result.stdout)
    content = []
    for item in raw.get('content', []):
        if item['type'] == 'text':
            try:
                content.append(json.loads(item['text']))
            except json.JSONDecodeError:
                content.append(item['text'])
    calls.append(dict(tool=tool, seconds=time.monotonic()-started, exitCode=result.returncode,
                      isError=raw.get('isError', False), result=content, structured=raw.get('structuredContent'), stderr=result.stderr))
    (output / 'protocol.json').write_text(json.dumps(calls, indent=2))
    assert result.returncode == 0 and not raw.get('isError'), content
    value = raw.get('structuredContent') or (content[0] if len(content) == 1 else content)
    return value.get('cell', value) if isinstance(value, dict) else value


created = call('create_notebook', dict(runtime='python', working_dir=str(output),
                                     package_manager='uv', environment_mode='notebook', ephemeral=False))
notebook_id = created['notebook_id']
kernel_started = time.monotonic()
deadline = time.monotonic() + 40
while not call('inspect_notebook')['readiness']['runtime_ready']:
    if time.monotonic() > deadline:
        raise TimeoutError('Upstream kernel did not become ready')
    time.sleep(.2)
kernel_ready_seconds = time.monotonic()-kernel_started
cell_ids = []
for source in CELLS:
    cell = call('create_cell', dict(source=source, cell_type='code', and_run=True, timeout_secs=30))
    cell_ids.append(cell['cell_id'])
expected = {'control': {'n': 3, 'mean_mg_l': '2'}, 'treatment': {'n': 3, 'mean_mg_l': '4'}}
assert json.loads((output / 'result.json').read_text()) == expected
digest = hashlib.sha256((output / 'result.json').read_bytes()).hexdigest()
call('save_notebook', dict(path=str(output / 'analysis.ipynb')))
saved = json.loads((output / 'analysis.ipynb').read_text())
sources = [''.join(cell['source']) for cell in saved['cells'] if cell['cell_type'] == 'code']
assert all(any(ast.dump(ast.parse(actual)) == ast.dump(ast.parse(source)) for actual in sources) for source in CELLS)
source_preserved = all(source in sources for source in CELLS)
error = call('create_cell', dict(source="raise ValueError('authored upstream probe')", and_run=True, timeout_secs=10))
assert 'ValueError' in json.dumps(error)
assert hashlib.sha256((output / 'result.json').read_bytes()).hexdigest() == digest
long_cell = call('create_cell', dict(source="from pathlib import Path\nPath('running').write_text('ready')\nwhile True: pass",
                                    and_run=True, timeout_secs=0.2))
deadline = time.monotonic() + 10
while not (output / 'running').exists():
    if time.monotonic() > deadline:
        raise TimeoutError('No running-cell signal')
    time.sleep(.05)
call('interrupt_kernel')
result = call('get_results', dict(execution_id=long_cell['execution_id'], timeout_secs=10, full_output=True))
assert result['outcome'] == 'completed' and result['execution_status'] == 'error'
interrupted = call('get_cell', dict(cell_id=long_cell['cell_id']))
assert 'KeyboardInterrupt' in json.dumps(interrupted)
call('restart_kernel')
for name in ('result.json', 'table.html'):
    (output / name).unlink()
for identity in cell_ids:
    call('execute_cell', dict(cell_id=identity, timeout_secs=30))
assert json.loads((output / 'result.json').read_text()) == expected
call('save_notebook')
reopened = call('inspect_notebook', dict(full_source=True))
assert reopened['readiness']['document_ready']
environment = call('create_cell', dict(source="import sys, json, importlib.metadata as metadata\n"
    "from pathlib import Path\nPath('environment.json').write_text(json.dumps(dict(python=sys.version, executable=sys.executable, "
    "packages=sorted((d.metadata['Name'], d.version) for d in metadata.distributions()))))",
    and_run=True, timeout_secs=10))
(output / 'receipt.json').write_text(json.dumps(dict(notebookId=notebook_id, resultSha256=digest,
    execution='completed', verification='authored_fixture_equal', scientificAcceptance='not_assessed',
    saveReopen=True, exactSourcePreserved=source_preserved, sourceASTEqual=True,
    exceptionRetainsResult=True, interrupt=True, restartRecomputes=True,
    kernelReadySeconds=kernel_ready_seconds, environment=environment,
    memory=process_memory(args.daemon_pid) if args.daemon_pid else None), indent=2))
print(json.dumps({'notebookId': notebook_id, 'calls': len(calls), 'resultSha256': digest}))
