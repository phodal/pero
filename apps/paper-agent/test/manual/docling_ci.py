"""Explicit GitHub-hosted Mac verification, never an App installation entrypoint.

Uses the existing Host smoke/approval path and committed official pins. Only the
three public NASA originals in numeric-corpus.json are fetched for conversion.
The model/runtime and original PDFs stay in RUNNER_TEMP, outside the evidence
artifact. This proves neither native dialog clicks nor scientific acceptance.
"""
import argparse
from dataclasses import dataclass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import time
from urllib.request import build_opener, HTTPRedirectHandler

HERE = Path(__file__).resolve()
REPO = HERE.parents[4]
CORPUS = HERE.parents[1] / 'fixtures/numeric-corpus.json'
INSTALL_TEST = 'apps::docling_runtime::tests::official_optional_runtime_end_to_end'
HTTP_TEST = ('test_numeric_records.NumericRecordsHttpTests.'
             'test_real_layout_http_persists_review_only_structure_and_reopens_original')


@dataclass(frozen=True)
class CorpusSample:
    id: str
    filename: str
    url: str
    sha256: str
    byte_length: int

    @classmethod
    def parse(cls, value):
        identifier = value['ntrsId']
        if not isinstance(identifier, str) or not re.fullmatch(r'\d{11}', identifier):
            raise ValueError('Expected a fixed NASA NTRS identifier')
        filename = identifier + '.pdf'
        url = f'https://ntrs.nasa.gov/api/citations/{identifier}/downloads/{filename}'
        if value['fileName'] != filename or value['downloadUrl'] != url:
            raise ValueError('Only canonical NASA original PDF URLs and filenames are allowed')
        size, digest = value['byteLength'], value['sha256']
        if (type(size) is not int or not 0 < size <= 20 * 1024 * 1024
                or not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest)):
            raise ValueError('Expected a bounded byte length and fixed SHA-256')
        return cls(value['id'], filename, url, digest, size)

    def verify(self, data):
        if (len(data) != self.byte_length or not data.startswith(b'%PDF-')
                or hashlib.sha256(data).hexdigest() != self.sha256):
            raise ValueError('Original PDF size, signature or SHA-256 mismatch: ' + self.id)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('NASA download redirected; review the pinned source before retrying')


def fetch_originals(directory):
    samples = [CorpusSample.parse(value) for value in json.loads(CORPUS.read_text())['samples']]
    if len(samples) != 3 or len({sample.filename for sample in samples}) != 3:
        raise ValueError('This opt-in is bounded to the three distinct committed NASA originals')
    directory.mkdir(parents=True, exist_ok=True)
    opener = build_opener(NoRedirect())
    rows = []
    for sample in samples:
        started = time.perf_counter()
        with opener.open(sample.url, timeout=60) as response:
            data = response.read(sample.byte_length + 1)
        sample.verify(data)
        (directory / sample.filename).write_bytes(data)
        rows.append(dict(id=sample.id, url=sample.url, sha256=sample.sha256,
                         bytes=len(data), wallSeconds=time.perf_counter() - started))
    return rows


def run_stage(name, command, directory, environment, timeout, output, receipt):
    started = time.perf_counter()
    row = dict(name=name, status='running', timeoutSeconds=timeout, log=name + '.log')
    receipt['stages'].append(row)
    (output / 'run.json').write_text(json.dumps(receipt, indent=2))
    with (output / row['log']).open('w') as log:
        process = subprocess.Popen(command, cwd=directory, env=environment,
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            row['exitCode'] = process.wait(timeout=timeout)
            row['status'] = 'passed' if row['exitCode'] == 0 else 'failed'
        except subprocess.TimeoutExpired:
            # Stop this test group. The Host gives installer children their own
            # groups/leases; a timed-out smoke is not a child-cleanup assertion.
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            row['status'] = 'timed_out'
        row['wallSeconds'] = time.perf_counter() - started
    (output / 'run.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(row), flush=True)
    return row['status'] == 'passed'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-official-downloads', action='store_true')
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.allow_official_downloads:
        parser.error('Explicit --allow-official-downloads is required')
    if os.environ.get('GITHUB_ACTIONS') != 'true' or not os.environ.get('RUNNER_TEMP'):
        parser.error('This entrypoint only provisions disposable GitHub Actions runners')
    if (sys.platform != 'darwin' or platform.machine() != 'arm64'
            or sys.version_info[:2] != (3, 12)):
        parser.error('A real macOS arm64 CPython 3.12 runner is required')
    import resource
    root, output = args.root.resolve(), args.output.resolve()
    if not root.is_relative_to(Path(os.environ['RUNNER_TEMP']).resolve()) or root.exists():
        parser.error('--root must be a new directory inside RUNNER_TEMP')
    if output.is_relative_to(root) or root.is_relative_to(output):
        parser.error('Evidence output must be separate from downloaded/runtime files')
    if importlib.util.find_spec('docling') or importlib.util.find_spec('torch'):
        parser.error('The ordinary Paper interpreter must not contain Docling or Torch')
    root.mkdir(parents=True)
    output.mkdir(parents=True, exist_ok=True)
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip()
    if head != os.environ.get('EXPECTED_HEAD_SHA'):
        parser.error('Checkout does not match the explicitly selected workflow head')
    receipt = dict(status='running', headSha=head, runId=os.environ.get('GITHUB_RUN_ID'),
        runAttempt=os.environ.get('GITHUB_RUN_ATTEMPT'), platform=platform.platform(),
        machine=platform.machine(), python=sys.version, stages=[], scientificAcceptance='not_assessed',
        nativeDialog='not_exercised', baseline='not_run; no Tesseract installation',
        corpusManifestSha256=hashlib.sha256(CORPUS.read_bytes()).hexdigest(),
        wheelManifestSha256=hashlib.sha256((REPO / 'crates/pero-runtime/src/apps/'
            'docling-wheels-macos-arm64.json').read_bytes()).hexdigest())
    environment = {**os.environ, 'PERO_DOCLING_INSTALL_SMOKE_ROOT': str(root),
                   'PERO_DOCLING_INSTALL_SMOKE_PYTHON': sys.executable}
    started = time.perf_counter()
    try:
        installed = run_stage('host-install', ['node', 'scripts/cargo.mjs', 'test', '--locked',
            '-p', 'pero-runtime', '--lib', INSTALL_TEST, '--', '--ignored', '--exact',
            '--nocapture', '--test-threads=1'], REPO, environment, 1200, output, receipt)
        if not installed:
            raise RuntimeError('Host installation failed; dependent conversion tests were not run')
        # Use the Host's actual activation receipt, not a second runtime path map.
        activation_path = root / 'paper-data/research-v1/docling-runtime.json'
        activation_bytes = activation_path.read_bytes()
        activation = json.loads(activation_bytes)
        python, models = Path(activation['python']), Path(activation['artifactsPath'])
        if (activation.get('disabled') or activation.get('profile') != 'macos-arm64-cp312'
                or not python.is_absolute() or not python.parent.resolve().is_relative_to(root)
                or not models.resolve().is_relative_to(root)):
            raise ValueError('Host did not activate the expected isolated Mac runtime')
        receipt['activation'] = activation
        receipt['activationSha256'] = hashlib.sha256(activation_bytes).hexdigest()
        receipt['hostStatus'] = json.loads((root / 'runtime/status.json').read_text())
        # Configure HF/Transformers offline mode after the approved install.
        # This is not an OS-level network-denial sandbox or a network audit.
        environment.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', OMP_NUM_THREADS='2')
        vision = run_stage('vision', [str(python), str(HERE.with_name('docling_macos.py')),
            str(models), str(output / 'vision')], REPO, environment, 120, output, receipt)
        receipt['originals'] = fetch_originals(root / 'pdfs')
        corpus = run_stage('corpus', [sys.executable, str(HERE.with_name('docling_corpus.py')),
            str(root / 'pdfs'), str(output / 'corpus'), '--engines', 'docling',
            '--docling-python', str(python), '--models', str(models)],
            REPO, environment, 600, output, receipt)
        environment.update(PAPER_AGENT_REAL_DOCLING='1', PAPER_AGENT_NUMERIC_CORPUS_DIR=str(root / 'pdfs'),
            PAPER_AGENT_DOCLING_CONFIG=str(activation_path), PAPER_AGENT_DOCLING_PYTHON=str(python),
            PERO_DOCLING_ARTIFACTS_PATH=str(models))
        http = run_stage('http-save-reopen', [sys.executable, '-m', 'unittest', '-v', HTTP_TEST],
            HERE.parents[1], environment, 240, output, receipt)
        receipt['status'] = 'passed' if vision and corpus and http else 'failed'
    except Exception as error:
        receipt.update(status='failed', error=f'{type(error).__name__}: {error}')
    finally:
        receipt['wallSeconds'] = time.perf_counter() - started
        for filename in ('installation.log', 'status.json'):
            source = root / 'runtime' / filename
            if source.is_file():
                shutil.copyfile(source, output / ('host-' + filename))
        receipt['runtimeAndInputFileBytes'] = sum(path.stat().st_size for path in root.rglob('*')
                                                if path.is_file() and not path.is_symlink())
        receipt['childPeakRssKiB'] = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024
        receipt['resourceScope'] = ('Logical file bytes exclude symlinks and include runtime, retained wheels, model and PDFs; '
            'child RSS is a high-water mark, not simultaneous process-tree memory or a memory cap. '
            'Per-conversion timing and RSS are in corpus outputs. Stage timeouts do not prove Host '
            'installer child cleanup; the disposable runner job is the final execution bound.')
        (output / 'run.json').write_text(json.dumps(receipt, indent=2))
        print(json.dumps(dict(status=receipt['status'], receipt=str(output / 'run.json'))))
    return 0 if receipt['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
