"""App-local immutable documents. Host owns processes and session execution.

Behavior ported from Point Paper Agent (Apache-2.0, Point contributors).
"""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import tempfile
import threading

from .model import ID, Invalid, PaperSnapshot, ResearchInput, canonical, digest, text
from .reports import ResearchReport
from .discovery import DiscoveryBatch, SavedDiscovery
from .pdf import PdfDocument, PdfAnnotation
from .reading_matrix import ReadingCell
from .retrieval import SearchQuery, SourceVersion, chunks
from .search_index import SearchIndex


@dataclass(frozen=True)
class SavedReport:
    id: str
    report: ResearchReport
    input_digest: str
    created_at: str
    session_id: str | None = None

    @classmethod
    def create(cls, report, intent, now, session_id=None):
        binding = dict(provenance="client-reported", sessionId=session_id) if session_id else dict(provenance="user-imported")
        input_digest = "sha256:" + digest(intent.to_dict(False))
        identity = digest({**report.to_dict(), "binding": binding, "inputDigest": input_digest})
        return cls(identity, report, input_digest, now, session_id)

    def to_dict(self):
        return {**self.report.to_dict(), "id": self.id, "inputDigest": self.input_digest, "createdAt": self.created_at,
                "binding": dict(provenance="client-reported", sessionId=self.session_id) if self.session_id else dict(provenance="user-imported")}


class ResearchStore:
    def __init__(self, root):
        self.root = Path(root) / "research-v1"
        self.lock = threading.RLock()

    def _read(self, kind, identity):
        if not isinstance(identity, str) or not ID.fullmatch(identity):
            raise Invalid("Invalid research record reference")
        try:
            return json.loads((self.root / kind / (identity + ".json")).read_text("utf-8"))
        except FileNotFoundError as error:
            raise Invalid("Research record not found", 404) from error

    def _list(self, kind):
        directory = self.root / kind
        if not directory.exists():
            return []
        names = sorted(path.stem for path in directory.glob("*.json") if ID.fullmatch(path.stem))
        if len(names) > 200:
            raise Invalid("Research library exceeds the 200-record limit", 413)
        return names

    def _write(self, kind, identity, value):
        with self.lock:
            directory = self.root / kind
            directory.mkdir(parents=True, exist_ok=True)
            target = directory / (identity + ".json")
            if target.exists():
                if self._read(kind, identity) != value:
                    raise Invalid("Immutable research document conflict", 409)
                return
            if len(self._list(kind)) >= 200:
                raise Invalid("Research library reached the 200-record limit", 413)
            descriptor, name = tempfile.mkstemp(dir=directory, prefix=".research-")
            try:
                with os.fdopen(descriptor, "wb") as output:
                    output.write(canonical(value))
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(name, target)
            finally:
                if os.path.exists(name):
                    os.unlink(name)

    def paper(self, identity):
        return PaperSnapshot.from_record(self._read("papers", identity))

    def pdf(self, identity):
        return PdfDocument.from_record(self._read('pdfs', identity))

    def paper_pdf(self, paper_id):
        self.paper(paper_id)
        documents = [self.pdf(i) for i in self._list('pdfs')]
        return max((doc for doc in documents if doc.paper_id == paper_id), key=lambda doc: (doc.created_at, doc.id), default=None)

    def pdf_bytes(self, document):
        return (self.root / 'pdf-files' / (document.file_digest + '.pdf')).read_bytes()

    def save_pdf(self, document, data):
        directory = self.root / 'pdf-files'
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / (document.file_digest + '.pdf')
        with self.lock:
            if not target.exists():
                descriptor, name = tempfile.mkstemp(dir=directory)
                try:
                    with os.fdopen(descriptor, 'wb') as output:
                        output.write(data)
                    os.replace(name, target)
                finally:
                    if os.path.exists(name):
                        os.unlink(name)
            try:
                return self.pdf(document.id)
            except Invalid as error:
                if error.status != 404:
                    raise
            self._write('pdfs', document.id, document.to_dict())
        return document

    def annotations(self, document_id):
        items = [self.annotation(i) for i in self._list('annotations')]
        return sorted((item for item in items if item.document_id == document_id), key=lambda item: (item.page, item.created_at))

    def annotation(self, identity):
        return PdfAnnotation.from_record(self._read('annotations', identity))

    def save_annotation(self, annotation, image=None):
        with self.lock:
            try:
                return self.annotation(annotation.id)
            except Invalid as error:
                if error.status != 404:
                    raise
            if image is not None:
                directory = self.root / 'pdf-images'
                directory.mkdir(parents=True, exist_ok=True)
                (directory / (annotation.id + '.png')).write_bytes(image)
            self._write('annotations', annotation.id, annotation.to_dict())
        return annotation

    def annotation_image(self, identity):
        annotation = self.annotation(identity)
        if annotation.kind != 'figure':
            raise Invalid('This annotation has no image', 404)
        return (self.root / 'pdf-images' / (annotation.id + '.png')).read_bytes()

    def reading_matrix(self):
        cells = [ReadingCell.from_record(self._read('reading-cells', i)) for i in self._list('reading-cells')]
        cells.sort(key=lambda cell: (cell.created_at, cell.id))
        return [dict(**cell.to_dict(), annotation=self.annotation(cell.annotation_id).to_dict()) for cell in cells]

    def add_reading_cell(self, annotation_id, column, now):
        cell = ReadingCell.create(self.annotation(annotation_id), column, now)
        with self.lock:
            try:
                return ReadingCell.from_record(self._read('reading-cells', cell.id))
            except Invalid as error:
                if error.status != 404:
                    raise
            self._write('reading-cells', cell.id, cell.to_dict())
        return cell

    def intent(self, identity):
        return ResearchInput.from_record(self._read("intents", identity))

    def report(self, identity):
        value = self._read("reports", identity)
        intent = self.intent(value["intentId"])
        report = ResearchReport.parse(value, intent)
        binding = value.get("binding", {})
        result = SavedReport.create(report, intent, value["createdAt"], binding.get("sessionId"))
        if result.id != value.get("id") or result.input_digest != value.get("inputDigest"):
            raise Invalid("Stored report integrity check failed")
        return result

    def library(self):
        papers = [self.paper(identity).to_dict(False) for identity in self._list("papers")]
        intents = []
        for identity in self._list("intents"):
            intent = self.intent(identity)
            intents.append(dict(id=intent.id, question=intent.question, paperIds=[paper.id for paper in intent.papers],
                                verifyCode=intent.verify_code, createdAt=intent.created_at))
        reports = []
        for identity in self._list("reports"):
            saved = self.report(identity)
            reports.append(dict(id=saved.id, intentId=saved.report.intent_id, title=saved.report.title,
                                acceptance="unverified", createdAt=saved.created_at))
        discoveries = [self.discovery(i) for i in self._list('discoveries')]
        discoveries.sort(key=lambda batch: batch.fetched_at, reverse=True)
        favorites = [self.favorite(i).to_dict() for i in self._list('favorites')]
        return dict(papers=papers, intents=intents, reports=reports, favorites=favorites, matrixCount=len(self._list('reading-cells')),
                    discoveries=[dict(id=b.id, seedId=b.seed_id, seedTitle=b.seed_title, relation=b.relation,
                                      page=b.page, fetchedAt=b.fetched_at) for b in discoveries])

    def discovery(self, identity):
        return DiscoveryBatch.from_record(self._read('discoveries', identity))

    def save_discovery(self, batch):
        self._write('discoveries', batch.id, batch.to_dict())
        return batch

    def favorite(self, identity):
        value = self._read('favorites', identity)
        batch = self.discovery(value.get('batchId'))
        result = SavedDiscovery(batch, batch.paper(value.get('paper', {}).get('id')))
        if result.id != value.get('id'):
            raise Invalid('Stored favorite integrity check failed')
        return result

    def save_favorite(self, batch_id, work_id):
        batch = self.discovery(batch_id)
        result = SavedDiscovery(batch, batch.paper(work_id))
        with self.lock:
            try:
                return self.favorite(result.id)
            except Invalid as error:
                if error.status != 404:
                    raise
            self._write('favorites', result.id, result.to_dict())
        return result

    def save_paper(self, paper):
        with self.lock:
            try:
                return self.paper(paper.id)
            except Invalid as error:
                if error.status != 404:
                    raise
            self._write("papers", paper.id, paper.to_dict())
            return paper

    def search(self, query: SearchQuery):
        with self.lock, SearchIndex(self.root / 'search-v1.sqlite3') as index:
            paper_ids, pdf_ids = self._list('papers'), self._list('pdfs')
            # JSON is authoritative. Index only new immutable versions; removing
            # a source also removes its derived search rows on the next query.
            current = set(paper_ids) | set(pdf_ids)
            index.retain({s.id for s in index.sources() if s.id in current and s.paper_id in paper_ids})
            indexed = {source.id for source in index.sources()}
            for identity in paper_ids:
                if identity not in indexed:
                    paper = self.paper(identity)
                    index.replace(SourceVersion.of(paper), chunks(paper))
            for identity in pdf_ids:
                if identity not in indexed:
                    document = self.pdf(identity)
                    if document.paper_id in paper_ids:
                        paper = self.paper(document.paper_id)
                        index.replace(SourceVersion.of(paper, document), chunks(paper, document))
            return index.search(query)

    def prepare(self, request, now):
        with self.lock:
            identity = digest(request.request_id.encode("utf-8"))
            try:
                existing = self.intent(identity)
            except Invalid as error:
                if error.status != 404:
                    raise
                existing = None
            papers = tuple(self.paper(identity) for identity in request.paper_ids)
            passages = existing.passages if existing else ()
            retrieval = existing.retrieval if existing else None
            if request.full_text and existing is None:
                documents = tuple(self.paper_pdf(paper.id) for paper in papers)
                if any(doc is None for doc in documents):
                    raise Invalid('Open and save a PDF for each selected paper first')
                found = self.search(SearchQuery(request.question, request.paper_ids, pdf_only=True))
                passages = tuple(hit.chunk.pdf_passage() for hit in found.hits)
                if not passages:
                    raise Invalid('No matching PDF passages. Try keywords in the source language, or read the saved PDF directly.')
                retrieval = found.freeze()
            result = ResearchInput.prepare(request, papers, existing.created_at if existing else now, passages,
                                           existing.frozen_prompt if existing else None, retrieval)
            self._write("intents", result.id, result.to_dict(False))
            return result

    def save_report(self, intent_id, source, now, session_id=None):
        intent = self.intent(intent_id)
        if session_id is not None:
            session_id = text(session_id, 250, "session reference")
        report = ResearchReport.from_text(source, intent)
        result = SavedReport.create(report, intent, now, session_id)
        with self.lock:
            try:
                return self.report(result.id)
            except Invalid as error:
                if error.status != 404:
                    raise
            self._write("reports", result.id, result.to_dict())
            return result

    def export(self, identity, format):
        saved = self.report(identity)
        if format == "json":
            value = saved.to_dict()
            intent = self.intent(saved.report.intent_id)
            if intent.retrieval:
                value.update(retrieval=intent.retrieval.to_dict(), sources=[p.to_dict(False) for p in intent.papers],
                             passages=[p.to_dict() for p in intent.passages])
            return dict(filename=f"research-{identity[:12]}.json", content=json.dumps(value, ensure_ascii=False, indent=2), mime="application/json")
        if format == "markdown":
            return dict(filename=f"research-{identity[:12]}.md", content=saved.report.markdown(self.intent(saved.report.intent_id)), mime="text/markdown")
        raise Invalid("Choose markdown or json export")
