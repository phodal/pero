"""Authenticated Pero App transport; domain and literature work stay separate."""
from datetime import datetime, timezone
import hmac
from http.server import BaseHTTPRequestHandler
import json
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit

from .literature import LiteratureClient
from .model import Invalid, PaperSnapshot, ResearchRequest, canonical, mapping
from .reports import EvidenceReference
from .discovery import DiscoveryQuery, DiscoveryBatch
from .pdf import PdfAnnotation
from .pdf_files import PdfFiles
from .retrieval import SearchQuery

MAX_BODY = 1024 * 1024


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def handler(store, secret, literature=None, now=utc_now, pdf_files=None):
    literature = literature if literature is not None else LiteratureClient()
    pdf_files = pdf_files if pdf_files is not None else PdfFiles()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            body = canonical(value)
            self.binary(status, body, 'application/json; charset=utf-8')

        def binary(self, status, body, mime):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def dispatch(self):
            if self.command == "GET" and self.path == "/health":
                return self.reply(200, {"ok": True})
            try:
                if self.headers.get("Transfer-Encoding"):
                    raise Invalid("Transfer encoding is unsupported")
                length = int(self.headers.get("Content-Length", 0))
                if not 0 <= length <= MAX_BODY:
                    raise Invalid("Request exceeds 1 MiB", 413)
                if not secret or not hmac.compare_digest(secret, self.headers.get("X-Pero-App-Token", "")):
                    raise Invalid("Host proxy authentication required", 401)
                self.connection.settimeout(15)
                body = self.rfile.read(length)
                if len(body) != length:
                    raise Invalid("Incomplete request body")
                data = {}
                if self.command == "POST":
                    if not self.headers.get("Content-Type", "").startswith("application/json"):
                        raise Invalid("JSON is required", 415)
                    data = mapping(json.loads(body), "request")
                parsed = urlsplit(self.path)
                path = parsed.path
                if self.command == "GET":
                    if path == '/api/matrix':
                        return self.reply(200, dict(cells=store.reading_matrix()))
                    if path == '/api/pdf':
                        document = store.paper_pdf(parse_qs(parsed.query).get('paperId', [''])[0])
                        return self.reply(200, dict(document=document.to_dict() if document else None,
                                                    annotations=[item.to_dict() for item in store.annotations(document.id)] if document else []))
                    document_match = re.fullmatch(r'/api/pdf/([a-f0-9]{64})', path)
                    if document_match:
                        document = store.pdf(document_match[1])
                        return self.reply(200, dict(document=document.to_dict(), annotations=[item.to_dict() for item in store.annotations(document.id)]))
                    pdf_match = re.fullmatch(r'/api/pdf/([a-f0-9]{64})/file', path)
                    if pdf_match:
                        return self.binary(200, store.pdf_bytes(store.pdf(pdf_match[1])), 'application/pdf')
                    image_match = re.fullmatch(r'/api/annotations/([a-f0-9]{64})/image', path)
                    if image_match:
                        return self.binary(200, store.annotation_image(image_match[1]), 'image/png')
                    if path == "/api/library":
                        return self.reply(200, store.library())
                    if path == "/api/example":
                        return self.reply(200, {
                            "title": "Synthetic reading · a reproducible citation example",
                            "sourceId": "synthetic-evidence-example-v1",
                            "url": "https://example.invalid/synthetic-paper",
                            "authors": ["Pero synthetic fixture"],
                            "contentKind": "full-text",
                            "content": "# Synthetic citation example\n\n## Method\nThis is a synthetic paper fixture, not published research.\n\nA source snapshot preserves the exact text used for a report.\n\n## Results\nNo experiment was performed. Any report about this example must retain that limitation.\n",
                        })
                    discovery_match = re.fullmatch(r'/api/discoveries/([a-f0-9]{64})', path)
                    if discovery_match:
                        return self.reply(200, store.discovery(discovery_match[1]).to_dict())
                    match = re.fullmatch(r"/api/(papers|intents|reports)/([a-f0-9]{64})(/export)?", path)
                    if match:
                        kind, identity, exporting = match.groups()
                        if exporting:
                            if kind != "reports":
                                raise Invalid("Only reports can be exported", 404)
                            return self.reply(200, store.export(identity, parse_qs(parsed.query).get("format", ["markdown"])[0]))
                        record = {"papers": store.paper, "intents": store.intent, "reports": store.report}[kind](identity)
                        return self.reply(200, record.to_dict())
                if self.command == "POST":
                    if path == '/api/matrix':
                        return self.reply(201, store.add_reading_cell(data.get('annotationId'), data.get('column'), now()).to_dict())
                    if path == '/api/pdf':
                        paper = store.paper(data.get('paperId'))
                        document = store.paper_pdf(paper.id)
                        if document is None:
                            content = pdf_files.download(paper)
                            document = store.save_pdf(pdf_files.inspect(paper, content, now()), content)
                        return self.reply(200, dict(document=document.to_dict(), annotations=[item.to_dict() for item in store.annotations(document.id)]))
                    if path == '/api/annotations':
                        document = store.pdf(data.get('documentId'))
                        annotation = PdfAnnotation.create(data, document, now())
                        image = pdf_files.crop(store.pdf_bytes(document), annotation) if annotation.kind == 'figure' else None
                        return self.reply(201, store.save_annotation(annotation, image).to_dict())
                    if path == '/api/discover':
                        query = DiscoveryQuery.parse(data)
                        result = literature.discover(query, store.paper(query.seed_id))
                        if isinstance(result, DiscoveryBatch):
                            return self.reply(201, dict(status='complete', **store.save_discovery(result).to_dict()))
                        return self.reply(200, result.to_dict())
                    if path == '/api/favorites':
                        return self.reply(201, store.save_favorite(data.get('batchId'), data.get('workId')).to_dict())
                    if path == '/api/discoveries/read':
                        batch = store.discovery(data.get('batchId'))
                        paper = batch.paper(data.get('workId')).reading(now())
                        return self.reply(201, store.save_paper(paper).to_dict())
                    if path == "/api/search":
                        return self.reply(200, literature.search(data))
                    if path == '/api/library/search':
                        return self.reply(200, store.search(SearchQuery.parse(data)).to_dict())
                    if path == "/api/papers":
                        paper = PaperSnapshot.from_reading(literature.read(data), now())
                        return self.reply(201, store.save_paper(paper).to_dict())
                    if path == "/api/papers/import":
                        paper = PaperSnapshot.from_reading({**data, "source": "import"}, now())
                        return self.reply(201, store.save_paper(paper).to_dict())
                    if path == "/api/intents":
                        return self.reply(201, store.prepare(ResearchRequest.parse(data), now()).to_dict())
                    if path == "/api/reports":
                        saved = store.save_report(data.get("intentId"), data.get("text"), now(), data.get("sessionId"))
                        return self.reply(201, saved.to_dict())
                    if path == "/api/evidence":
                        intent = store.intent(data.get("intentId"))
                        cited = tuple(paper.id for paper in intent.papers)
                        evidence = EvidenceReference.parse_many([{"paperId": data.get("paperId"), "quote": data.get("quote"), "passageId": data.get("passageId")}], cited, intent.papers, intent.passages)[0]
                        location = evidence.locate(intent.papers, intent.passages)
                        if 'pdf' in location:
                            locator = location['pdf']
                            document = store.pdf(locator['documentId'])
                            rects = pdf_files.locate_quote(store.pdf_bytes(document), document, locator['pages'][0], locator['sourceStart'], evidence.quote)
                            locator['rects'] = [r.to_dict() for r in rects]
                            return self.reply(200, location)
                        document = store.paper_pdf(evidence.paper_id)
                        pages = document.matching_pages(evidence.quote) if document else ()
                        if pages:
                            location['pdf'] = dict(documentId=document.id, pages=list(pages))
                        return self.reply(200, location)
                raise Invalid("Route not found", 404)
            except Invalid as error:
                self.reply(error.status, {"code": "research_invalid", "detail": error.detail})
            except (ValueError, TypeError, KeyError, UnicodeError, RecursionError) as error:
                self.reply(400, {"code": "request_invalid", "detail": str(error) or "Invalid request"})
            except OSError:
                self.reply(500, {"code": "backend_io_error", "detail": "Cannot read or write the research data directory"})
            except sqlite3.Error:
                self.reply(503, {"code": "search_index_error", "detail": "Cannot read or update the local search index. Check the App data directory and retry."})

        do_GET = do_POST = dispatch

    return Handler
