"""Shared deterministic commands for App tools and the local JSON CLI."""
from datetime import datetime, timezone
from .model import Invalid


def execute(store, action, request):
    if not isinstance(request, dict):
        raise Invalid('Command input must be an object')
    now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    if action == 'inspect':
        return store.imports.inspect(request, now).to_dict()
    if action == 'commit':
        return store.imports.commit(request, now).to_dict()
    if action == 'analysis':
        return store.imports.analysis(request)
    if action == 'pdf':
        return store.pdf_downloads.request(request)
    if action == 'source':
        return store.source_downloads.request(request)
    if action == 'source-read':
        from .source_reading import source_read
        return source_read(store, request)
    if action == 'source-report':
        from .source_reports import source_report
        return source_report(store, request, now)
    if action == 'export':
        if set(request) != {'bundleId'}:
            raise Invalid('Export accepts only bundleId')
        bundle = store.imports.bundle(request['bundleId'])
        receipts = []
        for resource in bundle.resources:
            action = 'source' if resource.kind == 'source_archive' else 'pdf' if resource.kind == 'pdf_candidate' else None
            if action:
                receipts.append(execute(store, action, dict(operation='status', bundleId=bundle.id, resourceId=resource.id))
                                if resource.id in (*bundle.sourceDownloadIds, *bundle.pdfDownloadIds) else
                                dict(resourceId=resource.id, status='reference_only'))
        source_indexes = []
        for receipt in receipts:
            original = receipt.get('receipt') or {}
            archive_digest = original.get('archiveDigest')
            if archive_digest:
                index = store._read('source-archives', archive_digest)
                # Export locations and hashes, not captions, source text or images.
                source_indexes.append(dict(archiveDigest=archive_digest, members=[dict(
                    id=m['id'], path=m['path'], sha256=m['sha256'], size=m['size'], kind=m['kind'],
                    structures=[{k: v for k, v in anchor.items() if k in ('kind', 'start', 'end', 'startLine', 'endLine')}
                                for anchor in m.get('structures', [])]) for m in index['members']]))
        reports = execute(store, 'source-report', dict(operation='list', bundleId=bundle.id))['reports']
        return dict(schema='pero.research-evidence.v1', bundle=bundle.to_dict(), acquisitions=receipts, sourceIndexes=source_indexes,
                    sourceReports=reports,
                    limitation='Evidence manifest only. No archive members, paper full text or execution results exported. Report interpretations remain unresolved.')
    raise Invalid('Unknown research command')
