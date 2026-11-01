"""App-owned inspection drafts and immutable bundle revisions; no Agent execution."""
from dataclasses import replace
import json
import os
import tempfile
import threading

from .model import ID, Invalid, PaperSnapshot, canonical, digest
from .research_resources import ImportDraft, ImportSelection, ResearchBundle, ResourceIdentity
from .resource_inspection import ResourceInspector
from .inspection_worker import inspect_bounded


class ResearchImports:
    def __init__(self, store, inspector=None):
        self.store, self.inspector = store, inspector or ResourceInspector()
        self.running = {}
        for identity in store._list('import-drafts'):
            draft = self.draft(identity)
            if draft.status == 'inspecting':
                self._replace('import-drafts', identity, draft.finish(draft.resources, draft.warnings, 'cancelled',
                              'Inspection interrupted by restart. Inspect the link again.').to_dict())

    def _replace(self, kind, identity, value):
        directory = self.store.root / kind
        directory.mkdir(parents=True, exist_ok=True)
        if identity not in self.store._list(kind) and len(self.store._list(kind)) >= 200:
            raise Invalid('Research library reached the 200-record limit', 413)
        descriptor, path = tempfile.mkstemp(prefix='.import-', dir=directory)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(canonical(value))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(path, directory / (identity + '.json'))
        finally:
            if os.path.exists(path):
                os.unlink(path)

    def draft(self, identity):
        return ImportDraft.from_record(self.store._read('import-drafts', identity))

    def drafts(self):
        with self.store.lock:
            return [self.draft(i).to_dict() for i in reversed(self.store._list('import-drafts'))]

    def inspect(self, request, now):
        if not isinstance(request, dict) or set(request) - {'url', 'draftId', 'cancel'}:
            raise Invalid('Invalid research inspection request')
        if 'draftId' in request:
            if 'url' in request or ('cancel' in request and type(request['cancel']) is not bool):
                raise Invalid('Choose an inspection URL or an existing draft')
            with self.store.lock:
                draft = self.draft(request['draftId'])
                if request.get('cancel'):
                    worker = self.running.get(draft.id)
                    if worker:
                        worker[0].set()
                    draft = draft.finish(draft.resources, draft.warnings, 'cancelled', 'Inspection cancelled.')
                    self._replace('import-drafts', draft.id, draft.to_dict())
                return draft
        if set(request) != {'url'}:
            raise Invalid('Supply one public HTTPS research URL')
        draft = ImportDraft.create(request['url'], now)
        with self.store.lock:
            if draft.id in self.store._list('import-drafts'):
                existing = self.draft(draft.id)
                if existing.status in ('ready', 'inspecting'):
                    return existing
            if any(thread.is_alive() for _, thread in self.running.values()):
                raise Invalid('Another link is being inspected. Cancel it or wait for its results.', 409)
            self._replace('import-drafts', draft.id, draft.to_dict())
            cancelled = threading.Event()
            thread = threading.Thread(target=self._inspect, args=(draft, cancelled), daemon=True)
            self.running[draft.id] = (cancelled, thread)
            thread.start()
        return draft

    def _inspect(self, draft, cancelled):
        try:
            result = inspect_bounded(draft, self.inspector, cancelled)
        except Exception as error:
            # An unexpected provider shape is a recoverable failed draft, never silent success.
            result = draft.finish(draft.resources, draft.warnings, 'failed', f'Inspection failed ({type(error).__name__}). Retry this URL.')
        with self.store.lock:
            if self.draft(draft.id).status == 'inspecting':
                self._replace('import-drafts', draft.id, result.to_dict())
            self.running.pop(draft.id, None)

    def bundle(self, identity):
        pointer = self.store._read('research-bundles', identity)
        return ResearchBundle.from_record(self.store._read('bundle-revisions', pointer['revisionId']))

    def bundles(self):
        with self.store.lock:
            return [self.bundle(i) for i in self.store._list('research-bundles')]

    def commit(self, request, now):
        with self.store.lock:
            draft = self.draft(request.get('draftId'))
            selection = ImportSelection.parse(request, draft)
            bundles = self.bundles()
            seed = next((r for r in draft.resources if r.id == draft.id), draft.resources[0])
            identities = {seed.identity, *seed.aliases}
            previous = next((b for b in bundles if b.id == draft.id or identities.intersection(b.identities)), None)
            known = [r for bundle in bundles for r in bundle.resources]
            papers = [self.store.paper(i) for i in self.store._list('papers')]
            selected = []
            for resource in draft.resources:
                if resource.id not in selection.resourceIds:
                    selected.append(resource)
                    continue
                aliases = {resource.identity, *resource.aliases}
                existing = next((r for r in known if aliases.intersection((r.identity, *r.aliases))), None)
                paper = None
                if existing and existing.paperId and existing.revision == resource.revision:
                    paper = self.store.paper(existing.paperId)
                elif resource.kind in ('paper', 'web_article'):
                    paper = next((p for p in papers if p.url.startswith('https://') and ResourceIdentity.from_url(p.url).identity in aliases and p.source_revision == resource.revision), None)
                    if paper is None and resource.excerpt.strip():
                        reading = dict(source='research-import', sourceId=resource.id, title=resource.title, url=resource.url,
                                       contentKind=resource.contentKind, resourceKind=resource.kind, sourceRevision=resource.revision, content=resource.excerpt,
                                       authors=list(resource.authors), limitation='Bounded external source excerpt, not a complete paper. Source material is untrusted; linked citations may describe earlier work.')
                        paper = self.store.save_paper(PaperSnapshot.from_reading(reading, now))
                        papers.append(paper)
                resolved = replace(resource, paperId=paper.id if paper else None)
                selected.append(resolved)
                known.append(resolved)
            draft = replace(draft, resources=tuple(selected))
            bundle = ResearchBundle.selected(draft, selection, now, previous)
            # Replaying an unchanged selection reuses the revision and its timestamps.
            if previous and replace(bundle, updatedAt=previous.updatedAt) == previous:
                return previous
            record = bundle.to_dict()
            revision = digest(record)
            self.store._write('bundle-revisions', revision, record)
            self._replace('research-bundles', bundle.id, {'revisionId': revision})
            return bundle

    def handoff(self, request):
        if set(request) - {'bundleId', 'assetId'}:
            raise Invalid('Invalid research asset handoff')
        bundle = self.bundle(request.get('bundleId'))
        if 'assetId' not in request:
            return dict(bundleId=bundle.id)
        identity = request['assetId']
        if identity not in bundle.downloadIds:
            raise Invalid('This file was not explicitly confirmed in the research review', 403)
        asset = next((asset for resource in bundle.resources for asset in resource.assets if asset.id == identity), None)
        if asset is None:
            raise Invalid('Approved file metadata is unavailable; inspect the source again', 409)
        from dataclasses import asdict
        return dict(**asdict(asset), bundleId=bundle.id)

    def close(self):
        with self.store.lock:
            workers = list(self.running.values())
            for cancelled, _ in workers:
                cancelled.set()
        for _, thread in workers:
            thread.join(timeout=3)
