"""Approved source-first preparation and offline scientific reads in ResearchStore.

The existing imports owner grants acquisition. This module neither accepts URLs
nor creates observed evidence: that remains the shared source observation owner.
"""
from base64 import b64decode, b64encode
from dataclasses import asdict
from pathlib import Path
import json
import tempfile
import threading
from urllib.parse import urlsplit

from .acquisition_worker import acquire_bounded
from .arxiv_html import parse_arxiv_html
from .model import ID, Invalid, canonical, digest
from .research_resources import OfficialHtml, ResearchBundle
from .resource_fetch import PublicMetadata
from .scientific_document import DocumentError, PARSER, ScientificDocument


def prepare_html(output, directory, url, paper_id, transport):
    response = transport.fetch_html(url)
    if response.url != url or response.mime != 'text/html':
        raise Invalid('Official HTML changed its source URL or type; keep using PDF', 422)
    output.send(('stage', 'parsing'))
    try:
        document = parse_arxiv_html(response.data, response.url, paper_id, requested_url=url)
    except DocumentError as error:
        raise Invalid(error.detail, error.status) from error
    if document.source_identity != 'response-explicit-version':
        raise Invalid('HTML response does not establish this explicit paper version; keep using PDF', 422)
    root = Path(directory)
    (root / 'source.html').write_bytes(response.data)
    (root / 'document.json').write_bytes(canonical(document.to_dict()))
    output.send(('complete', document.id))


class PaperDocuments:
    def __init__(self, store, transport=None):
        self.store, self.transport = store, transport or PublicMetadata()

    def _paper_for_resource(self, bundle_id, resource):
        if resource.paperId:
            return self.store.paper(resource.paperId).id
        # Imported PDFs are byte identities, not inferred arXiv identities. Only
        # the exact resource's saved acquisition receipt establishes this link.
        download_id = digest(dict(bundleId=bundle_id, resourceId=resource.id))
        if download_id in self.store._list('pdf-downloads'):
            receipt = self.store._read('pdf-downloads', download_id).get('receipt')
            if receipt:
                source = OfficialHtml.from_resource(resource)
                urls = [urlsplit(receipt.get(key, '')) for key in ('requestUrl', 'finalUrl')]
                if all(parsed.scheme == 'https' and parsed.netloc in ('arxiv.org', 'www.arxiv.org')
                        and parsed.path.removesuffix('.pdf') == '/pdf/' + source.work + source.revision
                        and not parsed.query and not parsed.fragment for parsed in urls):
                    return self.store.paper(receipt['paperId']).id
        return None

    def sources(self, paper_id):
        self.store.paper(paper_id)
        choices = []
        for bundle in self.store.imports.bundles():
            for resource in bundle.resources:
                try:
                    source = OfficialHtml.from_resource(resource)
                    if self._paper_for_resource(bundle.id, resource) != paper_id:
                        continue
                except Invalid:
                    continue
                choices.append(dict(bundleId=bundle.id, resourceId=resource.id, url=source.url,
                    work=source.work, revision=source.revision,
                    authorized=resource.id in bundle.htmlDownloadIds, reviewUrl=bundle.seedUrl))
        return choices

    def _receipt(self, document_id, bundle_id=None, resource_id=None):
        for identity in self.store._list('document-receipts'):
            receipt = self.store._read('document-receipts', identity)
            if receipt.get('documentId') != document_id or resource_id is not None and receipt.get('resourceId') != resource_id:
                continue
            expected = digest({key: receipt[key] for key in ('documentId', 'bundleRevision', 'resourceId')})
            if expected != identity:
                raise Invalid('Document receipt integrity check failed', 409)
            frozen = self.store._read('bundle-revisions', receipt['bundleRevision'])
            if digest(frozen) != receipt['bundleRevision']:
                raise Invalid('Document authorization revision integrity check failed', 409)
            bundle = ResearchBundle.from_record(frozen)
            if bundle_id is not None and bundle.id != bundle_id:
                continue
            resource = bundle.approved_html(receipt['resourceId'])
            if OfficialHtml.from_resource(resource).url == receipt['sourceUrl']:
                return receipt
        raise Invalid('This document has no saved HTML acquisition authorization', 403)

    def read(self, identity):
        receipt = self._receipt(identity)
        record = self.store._read('scientific-documents', identity)
        document = ScientificDocument.from_record(record['document'])
        try:
            original = b64decode(record['sourceBytes'], validate=True)
        except (ValueError, TypeError) as error:
            raise Invalid('Stored HTML original is unavailable', 409) from error
        if (document.id != identity or digest(original) != document.source.digest
                or len(original) != document.source.byte_length or receipt['sourceUrl'] != document.source.url
                or receipt['sourceDigest'] != document.source.digest):
            raise Invalid('Stored HTML original failed integrity checks', 409)
        self.store.paper(document.paper_id)
        return document, original

    def overview(self, paper_id):
        self.store.paper(paper_id)
        revisions = []
        for identity in self.store._list('scientific-documents'):
            record = self.store._read('scientific-documents', identity)
            if record['document']['paperId'] != paper_id:
                continue
            document, _ = self.read(identity)
            receipt = self._receipt(identity)
            revisions.append(dict(id=document.id, source=asdict(document.source), parser=document.parser,
                warnings=list(document.warnings), createdAt=receipt['createdAt'],
                bundleId=ResearchBundle.from_record(self.store._read('bundle-revisions', receipt['bundleRevision'])).id,
                resourceId=receipt['resourceId']))
        revisions.sort(key=lambda item: (item['createdAt'], item['id']), reverse=True)
        return dict(paperId=paper_id, revisions=revisions, sources=self.sources(paper_id))

    def prepare(self, value, now):
        if set(value) - {'operation', 'paperId', 'bundleId', 'resourceId', 'refresh'} or type(value.get('refresh', False)) is not bool:
            raise Invalid('Prepare accepts a saved paper and explicitly approved HTML resource only')
        paper = self.store.paper(value.get('paperId'))
        bundle = self.store.imports.bundle(value.get('bundleId'))
        resource = bundle.approved_html(value.get('resourceId'))
        if self._paper_for_resource(value['bundleId'], resource) != paper.id:
            raise Invalid('This approved HTML resource is not associated with the saved paper', 409)
        source = OfficialHtml.from_resource(resource)
        if not value.get('refresh', False):
            for revision in self.overview(paper.id)['revisions']:
                if revision['source']['url'] == source.url and revision['parser'] == PARSER:
                    return self.read(revision['id'])[0]
        bundle_revision = digest(bundle.to_dict())
        # Bounded worker is shared with PDF/source acquisition. No source scripts,
        # arbitrary paths, model calls or independent task runtime are added.
        with tempfile.TemporaryDirectory(prefix='pero-paper-html-') as directory:
            result = acquire_bounded(prepare_html, (directory, source.url, paper.id, self.transport),
                                     threading.Event(), 45, lambda _stage: None)
            if result[0] != 'complete':
                raise Invalid(result[1], 422)
            document = ScientificDocument.from_record(json.loads((Path(directory) / 'document.json').read_bytes()))
            original = (Path(directory) / 'source.html').read_bytes()
        # Recheck the same authorization after IO; an edited review cannot grant
        # a different version while an earlier request is in flight.
        with self.store.lock:
            current = self.store.imports.approved_html(value['bundleId'], value['resourceId'])
            if OfficialHtml.from_resource(current).url != source.url or self._paper_for_resource(value['bundleId'], current) != paper.id:
                raise Invalid('HTML authorization changed during preparation; review the source again', 409)
            identity = digest(dict(documentId=document.id, bundleRevision=bundle_revision, resourceId=resource.id))
            if identity not in self.store._list('document-receipts'):
                self.store._write('document-receipts', identity, dict(documentId=document.id, bundleRevision=bundle_revision,
                    resourceId=resource.id, sourceUrl=source.url, sourceDigest=document.source.digest, createdAt=now))
            self.store._write('scientific-documents', document.id,
                              dict(document=document.to_dict(), sourceBytes=b64encode(original).decode('ascii')))
        return self.read(document.id)[0]

    def command(self, value, now):
        if not isinstance(value, dict):
            raise Invalid('Document command input must be an object')
        operation = value.get('operation')
        if operation == 'prepare':
            document = self.prepare(value, now)
            return dict(documentId=document.id, source=asdict(document.source), warnings=list(document.warnings),
                        evidenceAdmission='not-observed-in-study')
        if operation == 'list':
            if set(value) != {'operation', 'paperId'}:
                raise Invalid('List accepts only a saved paper')
            return self.overview(value['paperId'])
        allowed = {'operation', 'documentId', 'blockId', 'start', 'limit', 'target'}
        if operation in ('read', 'source'):
            allowed |= {'bundleId', 'resourceId'}
            if ('bundleId' in value) != ('resourceId' in value):
                raise Invalid('Select both bundleId and resourceId, or neither, for this stored read')
            if 'bundleId' in value and any(not isinstance(value[key], str) or not ID.fullmatch(value[key]) for key in ('bundleId', 'resourceId')):
                raise Invalid('Choose saved bundle and resource identities for this stored read')
        if set(value) - allowed:
            raise Invalid('Read accepts fixed document/block references and bounded offsets only')
        document, original = self.read(value.get('documentId'))
        if operation == 'outline':
            return document.outline(value.get('start', 0), value.get('limit', 64))
        if operation == 'read':
            from .source_reports import record_document_observation
            receipt = self._receipt(document.id, value.get('bundleId'), value.get('resourceId'))
            result = document.read(value.get('blockId'), value.get('start', 0), value.get('limit', 4800))
            return record_document_observation(self.store, receipt, document, result)
        if operation == 'source':
            block = document.block(value['blockId']) if value.get('blockId') else None
            start = value.get('start', block.locator.start if block and block.locator else 0)
            text = original.decode('utf-8')
            limit = value.get('limit', 4800)
            if type(start) is not int or type(limit) is not int or not 0 <= start <= len(text) or not 1 <= limit <= 4800:
                raise Invalid('Choose an original HTML character window of at most 4,800 characters')
            end = min(start + limit, len(text))
            result = dict(documentId=document.id, sourceDigest=document.source.digest, content=text[start:end],
                blockId='', unit='original-html',
                start=start, end=end, nextStart=end if end < len(text) else None, totalLength=len(text),
                textKind='original-html', blockLocator=asdict(block.locator) if block and block.locator else None,
                evidenceAdmission='not-observed-in-study')
            from .source_reports import record_document_observation
            receipt = self._receipt(document.id, value.get('bundleId'), value.get('resourceId'))
            return record_document_observation(self.store, receipt, document, result)
        if operation == 'trace':
            block = document.block(value.get('blockId'))
            target = value.get('target')
            tokens = (*block.content, *(token for cell in block.cells for token in cell.content))
            if not isinstance(target, str) or not target or not any(t.target == target for t in tokens):
                raise Invalid('Choose a citation target actually present in this block')
            matches = [b.id for b in document.blocks if target in b.anchors]
            return dict(documentId=document.id, blockId=block.id, target=target, candidates=matches[:64],
                totalCandidates=len(matches), status='source-anchor' if len(matches) == 1 else 'ambiguous' if matches else 'unresolved',
                evidenceAdmission='not-observed-in-study')
        raise Invalid('Choose prepare, list, outline, read, source or trace')
