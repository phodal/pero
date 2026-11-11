#!/usr/bin/env python3
"""Opt-in real scientific execution with synthetic Paper selection metadata.

Run using an App interpreter without scientific dependencies. Supply a separately
prepared scientific Python and the actual pinned checkout. No installation or
download occurs here. This proves runtime separation, not PDF/UI acceptance.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'apps/paper-agent/backend'))
from paper_agent import pcgym
from paper_agent.model import PaperSnapshot, digest
from paper_agent.pdf import PdfAnnotation, PdfDocument, PdfPage
from paper_agent.pcgym_app import PcgymApp
from paper_agent.scientific_python import current, observe
from paper_agent.store import ResearchStore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--science-python', required=True)
    parser.add_argument('--checkout', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--managed-profile', type=Path)
    args = parser.parse_args()
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=args.managed_profile is not None)
    if args.managed_profile:
        assert sys.stdin.readline() == 'execute\n', 'Wait for the Rust process owner'
        binding = root / '.compute/binding.json'
        binding.parent.mkdir(parents=True, exist_ok=True)
        binding.write_bytes(args.managed_profile.read_bytes())
    service, science = current(), observe(args.science_python, args.managed_profile)
    assert service.executable != science.executable, 'Use separate App and scientific interpreters'
    assert all(version != 'MISSING' for _, version in science.packages)
    store = ResearchStore(root)
    now = datetime.now(timezone.utc).isoformat()
    paper = store.save_paper(PaperSnapshot.from_reading(dict(title='Synthetic selection for live runtime acceptance',
        source='import', sourceId='runtime-fixture', url='https://example.invalid/runtime-fixture',
        contentKind='full-text', content='Synthetic Paper metadata. Compute uses real pinned PC-Gym.'), now))
    pdf_bytes = b'Synthetic PDF selection fixture; not the original paper'
    pages = tuple(PdfPage(n, 400, 600, 'arXiv 2410.22093v4' if n == 1 else
        'Table 6 Base reward 0.0727 Shaped reward 0.0003 Oracle 0.0000 episodes trajectory'
        if n == 20 else 'Synthetic selection') for n in range(1, 21))
    document = store.save_pdf(PdfDocument.create(paper.id, digest(pdf_bytes),
        'https://example.invalid/runtime-fixture.pdf', pages, now), pdf_bytes)
    annotation = store.save_annotation(PdfAnnotation.create(dict(page=20, kind='highlight', quote='0.0727',
        rects=[dict(x=.1, y=.2, width=.1, height=.1)]), document, now))
    app = PcgymApp(store, checkout=args.checkout.resolve(), allow_execution=True,
                   scientific_python=args.science_python)
    store.pcgym = app
    try:
        item = app.prepare_item(dict(action='prepare-item', annotationId=annotation.id, policy='base',
            comparison=dict(mode='absolute', tolerance=.001), profile='smoke', seed=0,
            includeOracle=True, maxSeconds=600))
        ids = dict(itemId=item['id'], specId=item['spec_id'], requestId='separate-runtime-smoke')
        ticket = app.host_command(dict(operation='prepare', **ids))
        assert ticket['state'] == 'requires-approval'
        started = app.host_command(dict(operation='decide', **ids, ticket=ticket['ticket'],
            bindingDigest=ticket['bindingDigest'], decision='allow'))
        assert started['status'] == 'starting'
        deadline = time.monotonic() + 660
        while app.processes[ids['specId']].poll() is None:
            if time.monotonic() >= deadline:
                raise TimeoutError('Scientific runtime did not finish within its frozen budget')
            time.sleep(.2)
        status = app.status(ids['specId'])
        attempt = status['attempts'][0]
        assert attempt['status'] == 'completed', attempt
        bundle = app.bundle(ids['specId'])
        if args.managed_profile:
            use = pcgym.read_json(bundle / 'attempts' / attempt['attempt_id'] / 'environment-use.json')
            assert use['use']['state'] == 'Released', use
            assert use['approval'] == ticket['bindingDigest']
        checked = pcgym.check_attempt(bundle, attempt['attempt_id'])
        assert checked['numeric_recomputation'] == 'PASS', checked
        assert checked['execution_evidence'] == 'CONSISTENT', checked
        archive = root / 'evidence.zip'
        pcgym.export(bundle, attempt['attempt_id'], archive)
        unpacked = root / 'independent-check'
        with ZipFile(archive) as exported:
            assert 'local.json' not in exported.namelist()
            exported.extractall(unpacked)
        independent = subprocess.run([sys.executable, '-E', '-s', '-S', 'verify.py'],
            cwd=unpacked, capture_output=True, text=True, check=True, timeout=30)
        cancel_ids = {**ids, 'requestId': 'separate-runtime-cancel'}
        ticket = app.host_command(dict(operation='prepare', **cancel_ids))
        app.host_command(dict(operation='decide', **cancel_ids, ticket=ticket['ticket'],
            bindingDigest=ticket['bindingDigest'], decision='allow'))
        deadline = time.monotonic() + 30
        while True:
            candidate = next((a for a in app.status(ids['specId'])['attempts']
                              if a['attempt_id'] != attempt['attempt_id'] and a.get('worker_started')), None)
            if candidate is not None:
                break
            if time.monotonic() >= deadline:
                raise TimeoutError('Cancellation fixture never observed scientific worker startup')
            time.sleep(.1)
        # Cancellation must retain the original process owner after selection changes.
        app.scientific_python = '/environment-no-longer-selected/bin/python'
        app.host_command(dict(operation='cancel', **cancel_ids))
        app.processes[ids['specId']].wait(timeout=15)
        cancelled = next(a for a in app.status(ids['specId'])['attempts']
                         if a['attempt_id'] == candidate['attempt_id'])
        assert cancelled['status'] == 'cancelled', cancelled
        if args.managed_profile:
            cancelled_use = pcgym.read_json(bundle / 'attempts' / candidate['attempt_id'] / 'environment-use.json')
            assert cancelled_use['use']['state'] == 'Released', cancelled_use
        result = dict(scope='Real PC-Gym computation; synthetic Paper selection; Rust Use bridge when managed; no Desktop acceptance',
            app_runtime=service.to_dict(), scientific_runtime=science.to_dict(), item=ids,
            attempt=attempt, cancelled_attempt=cancelled, verification=checked,
            standalone_checker=json.loads(independent.stdout))
        (root / 'result.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(dict(spec=ids['specId'], attempt=attempt['attempt_id'],
            numeric_recomputation=checked['numeric_recomputation'], paper_verdict=checked['paper_verdict'])))
    finally:
        app.close()


if __name__ == '__main__':
    main()
