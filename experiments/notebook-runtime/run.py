"""Opt-in local runtime experiment. Never invoked by a product or default tests."""
from dataclasses import asdict, dataclass
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import time

import nbformat
from task import CELLS, marimo_source

HERE = Path(__file__).resolve().parent
EXPECTED = {'control': {'n': 3, 'mean_mg_l': '2'}, 'treatment': {'n': 3, 'mean_mg_l': '4'}}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clear_outputs(directory):
    for name in ('result.json', 'table.html'):
        (directory / name).unlink(missing_ok=True)


@dataclass(frozen=True)
class Snapshot:
    candidate: str
    input_sha256: str
    code_sha256: str
    environment_sha256: str
    output_sha256: str
    execution: str = 'completed'
    verification: str = 'authored_fixture_equal'
    scientific_acceptance: str = 'not_assessed'


def run(output):
    output.mkdir(parents=True, exist_ok=False)
    packages = sorted(({'name': d.metadata['Name'], 'version': d.version,
                       'license': d.metadata.get('License-Expression') or d.metadata.get('License', '').split('\n')[0],
                       'record_sha256': hashlib.sha256((d.read_text('RECORD') or '').encode()).hexdigest()}
                       for d in metadata.distributions()), key=lambda row: row['name'].lower())
    environment = {'python': sys.version, 'executable': sys.executable, 'platform': platform.platform(),
                   'interpreter_sha256': digest(Path(sys.executable).resolve()), 'packages': packages,
                   'lock_sha256': digest(HERE / 'requirements.lock')}
    (output / 'environment.json').write_text(json.dumps(environment, indent=2) + '\n')
    env_hash = digest(output / 'environment.json')
    kernel_dir = output / 'kernel-specs/kernels/pero-poc'
    kernel_dir.mkdir(parents=True)
    (kernel_dir / 'kernel.json').write_text(json.dumps({'argv': [sys.executable, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
                                                       'display_name': 'Pero isolated PoC', 'language': 'python'}))
    env = dict(os.environ, JUPYTER_PATH=str(output / 'kernel-specs'), PYTHONNOUSERSITE='1',
               PATH=str(Path(sys.executable).parent) + os.pathsep + os.environ.get('PATH', ''))
    commands = []

    def command(args, cwd, label, success=True):
        started = time.perf_counter()
        process = subprocess.run([sys.executable, *args], cwd=cwd, env=env, capture_output=True, text=True, timeout=45)
        elapsed = time.perf_counter() - started
        (output / f'{label}.stdout.log').write_text(process.stdout)
        (output / f'{label}.stderr.log').write_text(process.stderr)
        commands.append({'label': label, 'argv': [sys.executable, *args], 'cwd': str(cwd),
                         'seconds': elapsed, 'exit_code': process.returncode})
        (output / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        if success and process.returncode:
            raise RuntimeError(f'{label} failed: {process.stderr[-3000:]}')
        return process

    snapshots = []
    for candidate in ('marimo', 'jupyter'):
        directory = output / candidate
        directory.mkdir()
        shutil.copyfile(HERE / 'input.csv', directory / 'input.csv')
        if candidate == 'marimo':
            source = directory / 'analysis.py'
            source.write_text(marimo_source())
        else:
            source = directory / 'analysis.ipynb'
            notebook = nbformat.v4.new_notebook(cells=[nbformat.v4.new_markdown_cell(
                '# Authored CSV runtime fixture\nSynthetic data; engineering equality only. '
                'Group means are 2 and 4 mg/L; no scientific claim.\n')]
                + [nbformat.v4.new_code_cell(cell) for cell in CELLS]
                + [nbformat.v4.new_code_cell('from IPython.display import HTML, display\ndisplay(HTML(table_html))')])
            nbformat.write(notebook, source)
        initial = digest(source)
        for attempt in ('first', 'reopen'):
            clear_outputs(directory)
            if candidate == 'marimo':
                args = ['-m', 'marimo', 'export', 'html', str(source), '-o', f'{attempt}.html', '-f']
            else:
                args = [str(HERE / 'jupyter_probe.py'), 'execute', str(source), str(directory / f'{attempt}.ipynb')]
            command(args, directory, f'{candidate}-{attempt}')
            assert json.loads((directory / 'result.json').read_text()) == EXPECTED
            assert digest(source) == initial
            snapshot = Snapshot(candidate, digest(directory / 'input.csv'), initial, env_hash, digest(directory / 'result.json'))
            snapshots.append(asdict(snapshot))
            (directory / f'{attempt}-receipt.json').write_text(json.dumps(asdict(snapshot), indent=2) + '\n')
        # Relocation with cleared outputs ensures this is rerun, not a saved-output preview.
        relocated = output / f'{candidate}-relocated'
        relocated.mkdir()
        shutil.copyfile(source, relocated / source.name)
        shutil.copyfile(directory / 'input.csv', relocated / 'input.csv')
        if candidate == 'marimo':
            args = ['-m', 'marimo', 'export', 'html', str(relocated / source.name), '-o', 'rerun.html']
        else:
            args = [str(HERE / 'jupyter_probe.py'), 'execute', str(relocated / source.name), str(relocated / 'rerun.ipynb')]
        command(args, relocated, f'{candidate}-relocated')
        assert digest(relocated / 'result.json') == snapshot.output_sha256
        # Changed input must produce a new digest/output without mutating earlier receipts.
        (relocated / 'input.csv').write_text((relocated / 'input.csv').read_text().replace('c1,control,1', 'c1,control,4'))
        if candidate == 'marimo':
            args.append('-f')
        clear_outputs(relocated)
        command(args, relocated, f'{candidate}-changed-input')
        assert json.loads((relocated / 'result.json').read_text()) == {**EXPECTED, 'control': {'n': 3, 'mean_mg_l': '3'}}
        assert digest(relocated / 'input.csv') != snapshot.input_sha256
        assert digest(relocated / 'result.json') != snapshot.output_sha256
        assert digest(directory / 'result.json') == snapshot.output_sha256

    # Cross-format portability: execute converted documents, not just parse them.
    marimo = output / 'marimo'
    jupyter = output / 'jupyter'
    command(['-m', 'marimo', 'export', 'ipynb', str(marimo / 'analysis.py'), '-o', 'converted.ipynb'], marimo, 'marimo-to-ipynb')
    clear_outputs(marimo)
    command([str(HERE / 'jupyter_probe.py'), 'execute', str(marimo / 'converted.ipynb'), str(marimo / 'converted-executed.ipynb')], marimo, 'converted-ipynb-execution')
    assert json.loads((marimo / 'result.json').read_text()) == EXPECTED
    command(['-m', 'marimo', 'convert', str(jupyter / 'first.ipynb'), '-o', 'converted.py'], jupyter, 'ipynb-to-marimo')
    clear_outputs(jupyter)
    command(['-m', 'marimo', 'export', 'html', str(jupyter / 'converted.py'), '-o', 'converted.html'], jupyter, 'converted-marimo-execution')
    assert json.loads((jupyter / 'result.json').read_text()) == EXPECTED

    # Recover from real notebook exceptions without overwriting the known-good files.
    broken = marimo / 'broken.py'
    broken.write_text(marimo_source().replace('    rows = list(', '    raise ValueError("AUTHORED_FAILURE")\n    rows = list('))
    failure = command(['-m', 'marimo', 'export', 'html', str(broken), '-o', 'failed.html'], marimo, 'marimo-error', success=False)
    assert failure.returncode != 0
    assert "ValueError" in failure.stderr and "AUTHORED_FAILURE" in failure.stderr
    assert digest(marimo / 'result.json') == snapshots[0]['output_sha256']
    clear_outputs(marimo)
    command(['-m', 'marimo', 'export', 'html', str(marimo / 'analysis.py'), '-o', 'recovered.html'], marimo, 'marimo-error-recovery')
    assert json.loads((marimo / 'result.json').read_text()) == EXPECTED
    bad_nb = nbformat.v4.new_notebook(cells=[nbformat.v4.new_code_cell('raise ValueError("AUTHORED_FAILURE")')])
    nbformat.write(bad_nb, jupyter / 'broken.ipynb')
    failure = command([str(HERE / 'jupyter_probe.py'), 'execute', str(jupyter / 'broken.ipynb'), str(jupyter / 'failed.ipynb')], jupyter, 'jupyter-error', success=False)
    assert failure.returncode != 0
    assert "ValueError" in failure.stderr and "AUTHORED_FAILURE" in failure.stderr
    assert digest(jupyter / 'result.json') == snapshots[-1]['output_sha256']
    clear_outputs(jupyter)
    command([str(HERE / 'jupyter_probe.py'), 'execute', str(jupyter / 'analysis.ipynb'), str(jupyter / 'recovered.ipynb')], jupyter, 'jupyter-error-recovery')
    assert json.loads((jupyter / 'result.json').read_text()) == EXPECTED

    lifecycle = command([str(HERE / 'jupyter_probe.py'), 'lifecycle'], jupyter, 'jupyter-lifecycle')
    lifecycle = {'jupyter': json.loads(lifecycle.stdout)}
    blocked = marimo / 'blocked.py'
    blocked.write_text('import marimo\napp=marimo.App()\n@app.cell\ndef _():\n    from pathlib import Path\n    import signal\n    Path("ready").write_text("started")\n    while True: signal.pause()\n    return\n')
    started = time.perf_counter()
    with (output / 'marimo-cancel.log').open('w') as log:
        process = subprocess.Popen([sys.executable, '-m', 'marimo', 'export', 'html', str(blocked), '-o', 'cancelled.html'],
                                   cwd=marimo, env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            deadline = time.monotonic() + 20
            while not (marimo / 'ready').exists():
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError('marimo cell did not announce readiness')
                time.sleep(.01)  # Bounded observation of the external cell's file effect.
            ready_seconds = time.perf_counter() - started
            started = time.perf_counter()
            os.killpg(process.pid, signal.SIGINT)
            forced = False
            try:
                code = process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                forced = True
                os.killpg(process.pid, signal.SIGKILL)
                code = process.wait(timeout=5)
            assert code != 0
            lifecycle['marimo'] = {'process_cell_ready_seconds': ready_seconds,
                                   'interrupt_exit_seconds': time.perf_counter() - started,
                                   'exit_code': code, 'forced_kill_required': forced, 'graceful_interrupt': not forced, 'scope': 'CLI process interrupt, not interactive cell cancellation'}
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
    clear_outputs(marimo)
    command(['-m', 'marimo', 'export', 'html', str(marimo / 'analysis.py'), '-o', 'after-cancel.html'], marimo, 'marimo-cancel-recovery')
    assert json.loads((marimo / 'result.json').read_text()) == EXPECTED
    (output / 'lifecycle.json').write_text(json.dumps(lifecycle, indent=2) + '\n')
    (output / 'snapshots.json').write_text(json.dumps(snapshots, indent=2) + '\n')
    print(json.dumps({'status': 'checks_completed', 'output': str(output), 'lifecycle': lifecycle}, indent=2))


if __name__ == '__main__':
    run(Path(sys.argv[1]).resolve())
