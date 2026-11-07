"""Paper-owned UI adapter for one bounded, built-in numerical reanalysis.

No arbitrary paths, commands, downloads, environments, model calls or scheduler.
The Host already owns this App process; an explicit UI request computes 100
fixed values and runs the existing bounded independent checker. PC-Gym and its
private Host execution authority are deliberately unchanged.
"""
from dataclasses import asdict
from io import BytesIO
from pathlib import Path
import sys
from zipfile import ZipFile, ZIP_DEFLATED

from .fisher_result import (CASE, DATA_SHA256, DEFAULT_TOLERANCE, PDF_SHA256, RESULT_RECT, SOURCE_NOTE,
    FisherCommand, FisherProtocol, FisherSelection, observations)
from .fisher_reproduction import interpreter_digest, pipeline_digest, run, sha
from .pcgym import read_json, write_json
from .pcgym_domain import Invalid, digest
from .pdf import PdfAnnotation
from .verification import ComparisonPolicy


class FisherApp:
    def __init__(self, store, pdf_files):
        self.store = store
        self.pdf_files = pdf_files

    def selection(self, annotation_id):
        annotation = self.store.annotation(annotation_id)
        document = self.store.pdf(annotation.document_id)
        return FisherSelection.create(document, annotation)

    def protocol(self, selection, comparison):
        return FisherProtocol(digest(selection.to_dict()), pipeline_digest(), sys.version,
                              interpreter_digest(), comparison)

    def bundle(self, item_id):
        # All external identifiers have been validated by FisherCommand.
        self.store._read('fisher-items', item_id)
        return self.store.root / 'fisher-bundles' / item_id

    def attempt(self, root, attempt_id):
        target = root / 'attempts' / attempt_id
        if not (target / 'execution.json').is_file():
            raise Invalid('attempt_missing', 'The saved Fisher attempt is unavailable')
        def optional(name):
            return read_json(target / name) if (target / name).is_file() else None
        return dict(attemptId=attempt_id, execution=read_json(target / 'execution.json'),
            report=optional('failure.json') or optional('comparison.json'),
            independent=optional('independent.json'), annotation=optional('annotation-result.json'))

    def command(self, raw, now):
        command = FisherCommand.parse(raw)
        if command.action == 'select':
            document = self.store.pdf(command.identity)
            if document.file_digest != PDF_SHA256:
                raise Invalid('pdf_version', 'This case requires the reviewed Fisher PDF bytes')
            original = self.store.pdf_bytes(document)
            if sha(original) != PDF_SHA256:
                raise Invalid('pdf_version', 'This case requires the reviewed Fisher PDF bytes')
            annotation = PdfAnnotation.create(dict(page=4, kind='figure', quote='',
                rects=[RESULT_RECT], note=SOURCE_NOTE), document, now)
            saved = self.store.save_annotation(annotation, self.pdf_files.crop(original, annotation))
            return dict(annotation=saved.to_dict())
        if command.action in ('status', 'freeze'):
            selection = self.selection(command.identity)
            if command.action == 'status':
                items = []
                for identity in self.store._list('fisher-items'):
                    item = self.store._read('fisher-items', identity)
                    if item['annotationId'] != command.identity:
                        continue
                    root = self.bundle(identity)
                    attempts = [self.attempt(root, path.parent.name)
                                for path in (root / 'attempts').glob('*/execution.json')]
                    attempts.sort(key=lambda value: (value['execution']['started_at'], value['attemptId']))
                    items.append(dict(itemId=identity, spec=read_json(root / 'spec.json'),
                                      attempts=attempts, createdAt=item['createdAt']))
                items.sort(key=lambda value: (value['createdAt'], value['itemId']))
                preview = self.protocol(selection, ComparisonPolicy('absolute', tolerance=DEFAULT_TOLERANCE))
                rows = observations(Path(__file__).with_name('fisher_table1.csv').read_bytes())
                return dict(case=CASE, scope=preview.payload()['scope'], preview=preview.to_dict(), items=items,
                    data=dict(sha256=DATA_SHA256, location='Table I, PDF page 3 / printed page 180',
                              rows=[asdict(row) for row in rows]))
            original = self.store.pdf_bytes(self.store.pdf(selection.annotation.document_id))
            if sha(original) != PDF_SHA256:
                raise Invalid('pdf_version', 'Saved original PDF bytes changed')
            data = Path(__file__).with_name('fisher_table1.csv').read_bytes()
            observations(data)
            protocol = self.protocol(selection, command.comparison)
            root = self.store.root / 'fisher-bundles' / protocol.id
            with self.store.lock:
                if not (root / 'spec.json').exists():
                    root.mkdir(parents=True, exist_ok=True)
                    write_json(root / 'selection.json', selection.to_dict())
                    (root / 'paper.pdf').write_bytes(original)
                    (root / 'data.csv').write_bytes(data)
                    write_json(root / 'spec.json', protocol.to_dict())
                if protocol.id not in self.store._list('fisher-items'):
                    self.store._write('fisher-items', protocol.id, dict(annotationId=command.identity,
                        specId=protocol.id, createdAt=now))
            return dict(itemId=protocol.id, spec=protocol.to_dict())
        root = self.bundle(command.identity)
        if command.action == 'run':
            # The store may live under a symlinked parent such as macOS /tmp.
            # Rebuild from the resolved store root so the leaf itself is still
            # rejected when it is a symlink, while the owned directory remains usable.
            root = self.store.root.resolve() / 'fisher-bundles' / command.identity
            protocol = FisherProtocol.parse(read_json(root / 'spec.json'))
            if command.spec_id != protocol.id:
                raise Invalid('approval_required', 'Confirm this exact frozen specification')
            # Stable request identity makes a lost response a read, never another
            # computation. The existing store lock serializes this short local operation.
            with self.store.lock:
                for path in (root / 'attempts').glob('*/execution.json'):
                    if read_json(path).get('request_id') == command.request_id:
                        return self.attempt(root, path.parent.name)
                result = run(root, protocol.id, confirm=True, store=self.store,
                             request_id=command.request_id)
                return self.attempt(root, result['attempt_id'])
        attempt = self.attempt(root, command.attempt_id)
        target = root / 'attempts' / command.attempt_id
        if command.action == 'logs':
            logs = []
            for name in ('failure.log', 'checker.stdout.log', 'checker.stderr.log'):
                path = target / name
                if path.is_file():
                    logs.append(name + '\n' + path.read_text('utf-8')[:64000])
            return dict(text='\n\n'.join(logs) or 'No checker log was produced. Inspect execution status.',
                        execution=attempt['execution'])
        # An explicit export preserves failures too; an incomplete bundle cannot
        # be mistaken for a successful offline verification.
        output = BytesIO()
        names = ('spec.json', 'selection.json', 'data.csv', 'paper.pdf', 'observations.json',
            'execution.json', 'verify.py', 'manifest.json', 'comparison.json', 'independent.json',
            'annotation-result.json', 'failure.json', 'failure.log', 'checker.stdout.log', 'checker.stderr.log')
        with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
            for name in names:
                path = target / name
                if path.is_file():
                    archive.writestr(name, path.read_bytes())
            archive.writestr('README.txt',
                'Fisher (1936), Table III, one sepal-length within-species sum of squares.\n'
                'This is not a whole-paper reproduction, independent laboratory replication or attestation.\n'
                'The PDF and reviewed Table I transcription are pinned by SHA-256. No network is needed.\n'
                'To independently recompute, extract this archive and run: python -I -S verify.py\n'
                'Exit 0 = reproduced within the frozen policy; 3 = mismatch; 2 = incomplete/invalid evidence.\n'
                'An absent checker/manifest means this failed attempt cannot be verified.\n'
                'Read spec.json for data/method/environment/command and selection.json for the original PDF anchor.\n'
                'Comparison, independent check and result-annotation receipts are separate.\n')
        return output.getvalue()
