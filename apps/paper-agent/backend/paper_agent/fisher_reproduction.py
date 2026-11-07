"""Explicit CLI for a fixed Fisher Table III reanalysis, with saved Paper anchors.

No download, install, model, Host approval shortcut or arbitrary command runner.
prepare freezes the case; run requires that exact digest and explicit consent.
Each run creates new evidence and a result note at the same original PDF region.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

from .fisher_result import (CASE, DATA_SHA256, DEFAULT_TOLERANCE, DOI, PDF_SHA256,
    PDF_URL, REPORTED, RESULT_RECT, FisherProtocol, FisherResult, observations)
from .pcgym import read_json, root_path, write_json
from .pcgym_domain import Invalid, digest
from .verification import ComparisonPolicy


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pipeline_digest():
    # ComparisonPolicy is also part of the actual executed method.
    directory = Path(__file__).parent
    return digest({name: sha((directory / name).read_bytes()) for name in
        ('fisher_result.py', 'fisher_reproduction.py', 'fisher_verify.py', 'verification.py', 'pcgym_domain.py')})


def interpreter_digest():
    return sha(Path(sys.executable).read_bytes())


def prepare(pdf, output, comparison=None):
    from .model import PaperSnapshot
    from .pdf import PdfAnnotation, PdfDocument
    from .pdf_files import PdfFiles
    from .store import ResearchStore

    pdf = Path(pdf)
    if pdf.is_symlink() or not pdf.is_file() or pdf.stat().st_size > 16 * 1024 * 1024:
        raise Invalid('pdf_version', 'Supply the bounded original PDF file, not a link')
    original = pdf.read_bytes()
    if sha(original) != PDF_SHA256:
        raise Invalid('pdf_version', 'This case requires the reviewed Fisher PDF bytes')
    data = Path(__file__).with_name('fisher_table1.csv').read_bytes()
    observations(data)
    policy = ComparisonPolicy.parse(comparison or dict(mode='absolute', tolerance=DEFAULT_TOLERANCE))
    reader = PdfFiles()
    pages = reader.pages(original)  # Real PDF parsing; never synthetic source text.
    root = root_path(output)
    root.mkdir(parents=True, exist_ok=False)
    store = ResearchStore(root / 'paper-store')
    created = now()
    paper = store.save_paper(PaperSnapshot.from_reading(dict(source='import', sourceId=DOI,
        title='The use of multiple measurements in taxonomic problems', url='https://doi.org/' + DOI,
        contentKind='full-text', content='\n\n'.join(page.text for page in pages)[:120000]), created))
    document = store.save_pdf(PdfDocument.create(paper.id, PDF_SHA256, PDF_URL, pages, created), original)
    annotation = PdfAnnotation.create(dict(page=4, kind='figure', quote='', rects=[RESULT_RECT],
        note='Fisher (1936), Table III: sepal-length within-species sum of squares, 19.1434 cm². '
             'Source value visually reviewed; PDF text-layer extraction misses this cell.'), document, created)
    store.save_annotation(annotation, reader.crop(original, annotation))
    selection = dict(paper_id=paper.id, document_id=document.id, annotation=annotation.to_dict(),
                     source_url=PDF_URL, review='Curated visual transcription of the pinned original scan')
    protocol = FisherProtocol(digest(selection), pipeline_digest(), sys.version,
                              interpreter_digest(), policy)
    write_json(root / 'selection.json', selection)
    write_json(root / 'spec.json', protocol.to_dict())
    (root / 'paper.pdf').write_bytes(original)
    (root / 'data.csv').write_bytes(data)
    return dict(spec_id=protocol.id, status='prepared', execution='not-run',
                paper_verdict='NOT_ASSESSED', annotation_id=annotation.id,
                data_home=str(root / 'paper-store'), comparison=policy.to_dict())


def verified_inputs(root, protocol):
    data, paper = (root / 'data.csv').read_bytes(), (root / 'paper.pdf').read_bytes()
    if sha(data) != DATA_SHA256 or sha(paper) != PDF_SHA256:
        raise Invalid('input_mismatch', 'Frozen paper or data bytes changed')
    selection = read_json(root / 'selection.json')
    if digest(selection) != protocol.selection_digest:
        raise Invalid('input_mismatch', 'Frozen PDF selection changed')
    return observations(data), selection


def annotate(root, protocol, selection, attempt_id, report):
    from .pdf import PdfAnnotation
    from .store import ResearchStore

    store = ResearchStore(root / 'paper-store')
    source = store.annotation(selection['annotation']['id'])
    document = store.pdf(source.document_id)
    if source.to_dict() != selection['annotation'] or sha(store.pdf_bytes(document)) != PDF_SHA256:
        raise Invalid('input_mismatch', 'Saved Paper selection changed before result annotation')
    note = (f"Fisher Table III reanalysis: {report['result_verdict']}. "
            f"Reported {REPORTED}; actual {report['actual']:.12g}; "
            f"difference {report['difference']:+.12g} cm². "
            f"Policy {json.dumps(protocol.comparison.to_dict(), sort_keys=True)}. "
            f"Independent exact raw-moment check: PASS. Attempt {attempt_id}. "
            f"Source annotation {source.id}. This verifies one statistic, not the whole paper.")
    # Annotations are immutable. Add a linked result revision at the identical
    # region, rather than rewriting the reviewed original or any prior result.
    annotation = PdfAnnotation.create(dict(page=source.page, kind='figure', quote='',
        rects=[rect.to_dict() for rect in source.rects], note=note), document, now())
    store.save_annotation(annotation, store.annotation_image(source.id))
    saved = dict(sourceAnnotationId=source.id, resultAnnotationId=annotation.id,
                 specId=protocol.id, attemptId=attempt_id, report=report)
    store._write('fisher-results', digest(saved), saved)
    return saved


def run(root, spec_id, *, confirm=False):
    root = root_path(root)
    protocol = FisherProtocol.parse(read_json(root / 'spec.json'))
    if spec_id != protocol.id or confirm is not True:
        raise Invalid('approval_required', 'Confirm execution of this exact frozen specification')
    for previous in (root / 'attempts').glob('*/execution.json'):
        if read_json(previous).get('status') == 'running':
            raise Invalid('reconcile_required', 'An unfinished attempt exists; inspect its owner and evidence before rerunning')
    attempt_id = uuid.uuid4().hex
    target = root / 'attempts' / attempt_id
    target.mkdir(parents=True, exist_ok=False)
    receipt = dict(spec_id=protocol.id, attempt_id=attempt_id, status='running', started_at=now(),
                   origin='explicit-local-cli', execution_identity_attested=False)
    write_json(target / 'execution.json', receipt)
    phase = 'inputs'
    try:
        rows, selection = verified_inputs(root, protocol)
        phase = 'environment'
        if (protocol.python_version != sys.version or protocol.interpreter_digest != interpreter_digest()
                or protocol.pipeline_digest != pipeline_digest()):
            raise Invalid('environment_changed', 'Python or implementation changed; prepare a new protocol')
        phase = 'computation'
        result = dict(spec_id=protocol.id, attempt_id=attempt_id, **FisherResult.compute(rows).to_dict())
        write_json(target / 'observations.json', result)
        receipt.update(status='completed', finished_at=now(),
                       observations_sha256=sha((target / 'observations.json').read_bytes()))
        write_json(target / 'execution.json', receipt)
        for name in ('spec.json', 'selection.json', 'data.csv', 'paper.pdf'):
            shutil.copyfile(root / name, target / name)
        shutil.copyfile(Path(__file__).with_name('fisher_verify.py'), target / 'verify.py')
        names = ('spec.json', 'selection.json', 'data.csv', 'paper.pdf', 'observations.json',
                 'execution.json', 'verify.py')
        write_json(target / 'manifest.json', {name: sha((target / name).read_bytes()) for name in names})
        phase = 'independent_verification'
        checked = subprocess.run([sys.executable, '-I', '-S', str(target / 'verify.py')],
                                 capture_output=True, text=True, timeout=30, check=False)
        (target / 'checker.stdout.log').write_text(checked.stdout)
        (target / 'checker.stderr.log').write_text(checked.stderr)
        independent = json.loads(checked.stdout)
        write_json(target / 'independent.json', independent)
        matches = (checked.returncode in (0, 3) and independent.get('numeric_recomputation') == 'PASS'
                   and independent.get('spec_id') == protocol.id
                   and independent.get('attempt_id') == attempt_id)
        report = dict(spec_id=protocol.id, attempt_id=attempt_id, execution_status='completed',
                      **protocol.compare(result['actual'], matches))
        # Rounding in the float implementation may differ by ulps at a policy
        # boundary. Exact arithmetic owns the published-value comparison.
        if matches:
            report['observed_actual'] = result['actual']
            for key in ('comparison_status', 'result_verdict', 'difference', 'actual'):
                report[key] = independent[key]
            report['relative_error'] = abs(independent['difference']) / REPORTED
        write_json(target / 'comparison.json', report)
        phase = 'annotation'
        if matches:
            write_json(target / 'annotation-result.json', annotate(root, protocol, selection, attempt_id, report))
        return dict(**report, annotation_status='saved' if matches else 'not-written',
                    evidence_directory=str(target), log=str(target / 'checker.stdout.log'))
    except (Invalid, OSError, ValueError, subprocess.SubprocessError) as error:
        # A checker/annotation error cannot retroactively turn a completed
        # calculation into an environment failure or discard its evidence.
        status = ('input_mismatch' if phase == 'inputs' else 'environment_failed'
                  if phase == 'environment' else 'failed' if phase == 'computation' else 'completed')
        if receipt['status'] != 'completed':
            receipt.update(status=status, finished_at=now())
            write_json(target / 'execution.json', receipt)
        failure = ({**report, 'annotation_status': 'failed', 'workflow_status': 'incomplete'}
                   if phase == 'annotation' else
                   dict(spec_id=protocol.id, attempt_id=attempt_id, execution_status=status,
                        result_verdict='INCONCLUSIVE', paper_verdict='NOT_ASSESSED'))
        failure.update(phase=phase, reason=str(error))
        write_json(target / 'failure.json', failure)
        (target / 'failure.log').write_text(str(error) + '\n')
        return dict(**failure, evidence_directory=str(target), log=str(target / 'failure.log'))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prep = commands.add_parser('prepare')
    prep.add_argument('--pdf', type=Path, required=True)
    prep.add_argument('--output', type=Path, required=True)
    prep.add_argument('--absolute-tolerance', type=float, default=DEFAULT_TOLERANCE)
    execute = commands.add_parser('run')
    execute.add_argument('--bundle', type=Path, required=True)
    execute.add_argument('--spec-sha', required=True)
    execute.add_argument('--confirm-execution', action='store_true')
    args = parser.parse_args(argv)
    try:
        result = (prepare(args.pdf, args.output, dict(mode='absolute', tolerance=args.absolute_tolerance))
                  if args.command == 'prepare' else run(args.bundle, args.spec_sha, confirm=args.confirm_execution))
    except (Invalid, OSError, ValueError) as error:
        print(json.dumps(dict(status='blocked', reason=str(error), paper_verdict='NOT_ASSESSED')))
        return 2
    print(json.dumps(result, indent=2))
    if result.get('result_verdict') == 'INCONCLUSIVE' or result.get('workflow_status') == 'incomplete':
        return 2
    return 3 if result.get('result_verdict') == 'MISMATCH' else 0


if __name__ == '__main__':
    raise SystemExit(main())
