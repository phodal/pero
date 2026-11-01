"""Opt-in real public source acceptance through the production JSON CLI.

No provider/model or TeX execution. Private caller-owned profile; output contains
only receipts, hashes, locations and statuses, never source/image payloads.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PAPERS = ('2610.24806v1', '2610.32755v1', '2610.33195v1')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--aptamer-bundle', required=True)
    parser.add_argument('--aptamer-resource', required=True)
    args = parser.parse_args()
    if os.environ.get('PERO_SOURCE_STUDY_LIVE') != '1':
        parser.error('Requires explicit PERO_SOURCE_STUDY_LIVE=1; never a default network test')
    deadline = time.monotonic() + 100
    result = dict(outcome='running', network='real public product CLI; no injected transport',
                  model='none', compilation='none', sourceBytesExported=False, papers=[])

    def save():
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')

    def invoke(action, body):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AssertionError('Live journey exceeded its 100-second budget')
        run = subprocess.run([sys.executable, str(ROOT / 'apps/paper-agent/tools/research.py'), '--cache', str(args.cache)],
                             input=json.dumps(dict(action=action, input=body)), text=True,
                             capture_output=True, timeout=min(65, remaining))
        reply = json.loads(run.stdout)
        if run.returncode or not reply.get('ok'):
            # Product errors preserve HTTP status/Retry-After. Never auto-retry.
            failure = reply.get('error') or reply.get('result', {}).get('error') or 'CLI failed'
            raise AssertionError(f'{action}: {failure}')
        return reply['result']

    try:
        for paper in PAPERS:
            item = dict(paper=paper, status='pending', checks=[])
            result['papers'].append(item)
            save()
            if paper == PAPERS[0]:
                # Existing live UI already explicitly selected and acquired this source.
                request = dict(bundleId=args.aptamer_bundle, resourceId=args.aptamer_resource)
                item['consent'] = 'existing live UI source-only selection'
            else:
                draft = invoke('inspect', dict(url=f'https://arxiv.org/src/{paper}'))
                source = next(r for r in draft['resources'] if r['kind'] == 'source_archive')
                assert source['revision'] == 'v1' and source['workIdentity'] == 'arxiv:' + paper[:-2]
                bundle = invoke('commit', dict(draftId=draft['id'], resourceIds=[source['id']],
                    sourceIds=[source['id']], confirmedDownloads=True))
                assert not bundle['pdfDownloadIds']
                request = dict(bundleId=bundle['id'], resourceId=source['id'])
                item['consent'] = 'explicit fixed-v1 source-only CLI selection'
            acquired = invoke('source', dict(**request, operation='start'))
            receipt = acquired['receipt']
            item.update(status=acquired['status'], receipt=receipt,
                        expectedStatus='pdf_only' if paper == '2610.32755v1' else 'source_available',
                        expectationChanged=acquired['status'] != ('pdf_only' if paper == '2610.32755v1' else 'source_available'))
            save()
            assert acquired['status'] in ('source_available', 'pdf_only', 'no_tex')
            assert receipt['revision'] == 'v1' and receipt['workIdentity'] == 'arxiv:' + paper[:-2]
            assert invoke('source', dict(**request, operation='start'))['receipt'] == receipt
            item['checks'].append('separate-process repeated start preserves receipt')
            catalog = invoke('source-read', dict(**request, operation='list'))
            assert catalog['receipt'] == receipt
            observations, scopes = [], []
            tex = next((m for m in catalog['members'] if m['kind'] == 'tex'), None)
            image = next((m for m in catalog['members'] if m.get('preview')), None)
            if paper != '2610.32755v1':
                assert tex and image, 'Expected TeX and safe raster members were not available'
            if tex:
                anchors = [a for a in tex.get('structures', []) if a['kind'] in ('table', 'caption')]
                first = anchors[0]['startLine'] if anchors else 1
                read = invoke('source-read', dict(**request, operation='read', memberId=tex['id'], startLine=first, endLine=first))
                assert read['archiveDigest'] == receipt['archiveDigest'] and read['memberDigest'] == tex['sha256']
                observations.append(read['observationId'])
                scopes.append({key: read[key] for key in ('memberId', 'memberPath', 'memberDigest', 'startLine', 'endLine')})
            if image:
                read = invoke('source-read', dict(**request, operation='image', memberId=image['id']))
                assert hashlib.sha256(base64.b64decode(read['data'])).hexdigest() == read['provenance']['previewSha256']
                observations.append(read['observationId'])
                scopes.append(read['provenance'])
                # Repair only our disposable profile's derived preview; no network retry.
                preview = args.cache / 'research-v1/source-previews' / (image['id'] + '.png')
                preview.unlink()
                repaired = invoke('source', dict(**request, operation='start'))
                assert repaired['receipt'] == receipt and repaired['previewRebuiltAt']
                item['checks'].append('derived preview restored locally without changing receipt')
            compared = invoke('source-read', dict(**request, operation='compare'))
            assert compared['status'] == 'unresolved'
            observations.append(compared['observationId'])
            report = invoke('source-report', dict(operation='create', bundleId=request['bundleId'],
                title=f'{paper}: live source tool evidence, no scientific interpretation', observationIds=observations))
            assert invoke('source-report', dict(operation='read', bundleId=request['bundleId'], reportId=report['id'])) == report
            assert all(o['anchor'].get('visualReview', 'not_reviewed') == 'not_reviewed' for o in report['observations'])
            exported = invoke('export', dict(bundleId=request['bundleId']))
            assert report in exported['sourceReports']
            item.update(scopes=scopes, reportId=report['id'], observationIds=observations)
            item['checks'].append('actual read/image scopes journaled; unresolved comparison; report restart and export')
            save()
        result['outcome'] = 'passed'
    except Exception as error:
        result.update(outcome='incomplete' if isinstance(error, subprocess.TimeoutExpired) or time.monotonic() >= deadline else 'failed',
                      error=str(error)[:1000])
        raise
    finally:
        save()


if __name__ == '__main__':
    main()
