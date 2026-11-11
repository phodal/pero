"""Authenticated loopback transport for the local Notebook App."""

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import signal
import sqlite3
import threading
from uuid import uuid4
from urllib.parse import parse_qs, urlsplit

from drafts import Draft, DraftStore, StoredDraftError
from agent_read import AgentRead
from document import MAX_DOCUMENT_BYTES, NotebookDocument, fields, integer
from operations import apply_operations, parse_operations
from store import EntryStore, MissingEntry, RevisionConflict, StoredDocumentError
from templates import TemplateStore, TemplateDefinition, MissingTemplate
from saved_search import SavedSearchStore, SavedSearchDefinition, MissingSavedSearch
from reviews import ReviewStore
from review_routes import review_route
from catalog import CatalogStore, SubmissionConflict, SchemaConflict
from template_collections import TemplateCollectionStore
from table_workflows import TableWorkflowStore
from catalog_archive import CatalogArchiveStore
from table_workflow_routes import table_workflow_route
from scientific_designs import ScientificDesignStore
from scientific_routes import scientific_route
from ai_proposals import AIProposalStore
from ai_routes import ai_route
from app_canvas import verify_source
from worksheet_amendments import WorksheetAmendmentStore, worksheet_amendment_route
from source_parsers import source_extraction_route
from notebook_home import notebook_home


ENTRY_ID = re.compile(r'[a-f0-9]{32}')
ENTRY_PATH = re.compile(r'/api/entries/([a-f0-9]{32})(/revisions(?:/([1-9][0-9]{0,9}))?)?')


def entry_id(value):
    if not isinstance(value, str) or not ENTRY_ID.fullmatch(value):
        raise ValueError('Invalid entry ID')
    return value


def invalid_constant(_value):
    raise ValueError('Non-finite JSON number')


def handler(store, secret):
    token = secret.encode()
    templates, saved_searches = TemplateStore(store), SavedSearchStore(store)
    reviews = ReviewStore(store)
    drafts = DraftStore(store)
    catalog = CatalogStore(store.path)
    collections = TemplateCollectionStore(store, templates)
    workflows = TableWorkflowStore(store, catalog)
    archives = CatalogArchiveStore(catalog)
    scientific = ScientificDesignStore(store)
    proposals = AIProposalStore(store)
    amendments = WorksheetAmendmentStore(store)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            raw = json.dumps(value, allow_nan=False, ensure_ascii=False, separators=(',', ':')).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def error(self, status, code, detail, **extra):
            self.reply(status, {'error': detail, 'detail': detail, 'code': code, **extra})

        def body(self):
            media_type = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
            if self.headers.get('Transfer-Encoding') or media_type != 'application/json':
                raise ValueError('A JSON request with Content-Length is required')
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= MAX_DOCUMENT_BYTES + 65536:
                raise ValueError('Notebook request exceeds the size limit')
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError('Incomplete Notebook request')
            try:
                return json.loads(raw.decode(), parse_constant=invalid_constant)
            except (json.JSONDecodeError, UnicodeDecodeError, RecursionError) as error:
                raise ValueError('Invalid Notebook JSON') from error

        def do_GET(self):
            self.dispatch(self.get)

        def do_POST(self):
            self.dispatch(self.post)

        def do_DELETE(self):
            self.dispatch(self.delete)

        def dispatch(self, route):
            if not token or not hmac.compare_digest(token, self.headers.get('X-Pero-App-Token', '').encode('latin1')):
                return self.error(401, 'unauthorized', 'Host authentication required')
            try:
                self.connection.settimeout(15)
                return route()
            except RevisionConflict as error:
                return self.error(409, 'revision-conflict', str(error), currentRevision=error.current_revision)
            except (SubmissionConflict, SchemaConflict) as error:
                return self.error(409, 'catalog-conflict', str(error))
            except (MissingEntry, MissingTemplate, MissingSavedSearch) as error:
                return self.error(404, 'not-found', str(error))
            except StoredDraftError as error:
                return self.error(409, 'stored-draft-error', str(error), recovery=error.raw)
            except StoredDocumentError as error:
                return self.error(500, 'stored-document-error', str(error),
                                  entryId=error.identity, revision=error.revision)
            except ValueError as error:
                return self.error(400, 'invalid-request', str(error))
            except (OSError, sqlite3.Error):
                return self.error(500, 'storage-error', 'Notebook storage operation failed')

        def get(self):
            if self.path == '/api/notebook-home':
                return self.reply(200, notebook_home(store))
            for route, owner in ((ai_route, proposals), (scientific_route, scientific), (worksheet_amendment_route, amendments)):
                response = route(owner, 'GET', self.path, self.body)
                if response is not None:
                    return self.reply(*response)
            response = table_workflow_route(collections, workflows, archives, 'GET', self.path, self.body)
            if response is not None:
                return self.reply(*response)
            response = review_route(reviews, 'GET', self.path, self.body)
            if response is not None:
                return self.reply(*response)
            parts = urlsplit(self.path)
            if parts.path == '/api/catalog/lookup':
                query = parse_qs(parts.query, keep_blank_values=True)
                if set(query) - {'schemaId', 'text', 'limit'} or any(len(values) != 1 for values in query.values()):
                    raise ValueError('Invalid catalog query parameters')
                lookup = {'schemaId': query.get('schemaId', [''])[0], 'text': query.get('text', [''])[0],
                          'limit': int(query.get('limit', ['100'])[0])}
                return self.reply(200, catalog.lookup(lookup))
            if parts.path in ('/api/templates', '/api/saved-searches'):
                if parts.query:
                    raise ValueError('Collection routes do not accept query parameters')
                return self.reply(200, {'templates': templates.list()} if parts.path == '/api/templates'
                                  else {'searches': saved_searches.list()})
            library = re.fullmatch(r'/api/(templates|saved-searches)/([a-f0-9]{32})', parts.path)
            if library:
                query = parse_qs(parts.query, keep_blank_values=True)
                if set(query) - {'revision'} or len(query.get('revision', [])) > 1:
                    raise ValueError('Invalid library query parameters')
                revision = integer(int(query['revision'][0]), 'revision') if 'revision' in query else None
                owner = templates if library[1] == 'templates' else saved_searches
                return self.reply(200, owner.read(library[2], revision))
            draft_path = re.fullmatch(r'/api/entries/([a-f0-9]{32})/draft', self.path)
            if draft_path:
                return self.reply(200, {'draft': drafts.read(draft_path[1])})
            if self.path == '/api/entries':
                return self.reply(200, {'entries': store.list()})
            match = ENTRY_PATH.fullmatch(self.path)
            if not match:
                return self.error(404, 'not-found', 'Route not found')
            if match[3]:
                revision = integer(int(match[3]), 'revision')
                return self.reply(200, store.read(match[1], revision).wire())
            if match[2]:
                return self.reply(200, {'revisions': store.history(match[1])})
            return self.reply(200, store.read(match[1]).wire())

        def post(self):
            response = source_extraction_route('POST', self.path, self.body)
            if response is not None:
                return self.reply(*response)
            if self.path == '/internal/canvas/source':
                return self.reply(200, verify_source(store, self.body()))
            for route, owner in ((ai_route, proposals), (scientific_route, scientific), (worksheet_amendment_route, amendments)):
                response = route(owner, 'POST', self.path, self.body)
                if response is not None:
                    return self.reply(*response)
            response = table_workflow_route(collections, workflows, archives, 'POST', self.path, self.body)
            if response is not None:
                return self.reply(*response)
            draft_path = re.fullmatch(r'/api/entries/([a-f0-9]{32})/draft(/discard)?', self.path)
            if draft_path:
                if draft_path[2]:
                    data = fields(self.body(), {'baseRevision'})
                    drafts.discard(draft_path[1], integer(data['baseRevision'], 'base revision'))
                    return self.reply(200, {'discarded': True})
                return self.reply(200, drafts.save(draft_path[1], Draft.parse(self.body())))
            response = review_route(reviews, 'POST', self.path, self.body)
            if response is not None:
                return self.reply(*response)
            if self.path == '/api/catalog/register':
                return self.reply(200, catalog.register(self.body()))
            if self.path == '/api/templates':
                return self.reply(201, templates.publish(TemplateDefinition.parse(self.body())))
            if self.path == '/api/saved-searches':
                return self.reply(201, saved_searches.save(SavedSearchDefinition.parse(self.body())))
            library = re.fullmatch(r'/api/(templates|saved-searches)/([a-f0-9]{32})/(revisions|archive|run)', self.path)
            if library:
                kind, identity, action = library.groups()
                if action == 'revisions':
                    data = fields(self.body(), {'expectedRevision', 'definition'})
                    revision = integer(data['expectedRevision'], 'expected revision')
                    result = templates.publish(TemplateDefinition.parse(data['definition']), identity, revision) if kind == 'templates' else saved_searches.save(SavedSearchDefinition.parse(data['definition']), identity, revision)
                    return self.reply(201, result)
                if kind == 'templates' and action == 'archive':
                    data = fields(self.body(), {'archived'})
                    return self.reply(200, templates.archive(identity, data['archived']))
                if kind == 'saved-searches' and action == 'run':
                    data = fields(self.body(), {'revision'})
                    return self.reply(200, saved_searches.run(identity, integer(data['revision'], 'query revision')))
                return self.error(404, 'not-found', 'Route not found')
            if self.path == '/api/document/validate':
                data = fields(self.body(), {'document'})
                return self.reply(200, {'document': NotebookDocument.parse(data['document']).wire()})
            if self.path == '/api/entries':
                data = fields(self.body(), set(), {'title', 'document'})
                if 'document' in data and 'title' in data:
                    raise ValueError('Import a document or create a title, not both')
                document = NotebookDocument.parse(data['document'] if 'document' in data else {
                    'schemaVersion': 1, 'title': data.get('title', 'Untitled'),
                    'content': {'type': 'doc', 'content': [{'type': 'paragraph', 'attrs': {'blockId': uuid4().hex}}]},
                })
                return self.reply(201, store.create(document).wire())
            if self.path == '/api/agent-read':
                data = fields(self.body(), {'entryId'}, {'revision', 'blockId', 'offset', 'view'})
                if any(value is None for value in data.values()):
                    raise ValueError('Read fields cannot be null')
                selection = AgentRead(data.get('revision'), data.get('blockId'), data.get('offset'), data.get('view'))
                entry = store.read(entry_id(data['entryId']), selection.revision)
                try:
                    content = selection.read(entry.document)
                except LookupError as error:
                    return self.error(404, 'not-found', str(error))
                return self.reply(200, {**entry.wire(summary=True), **content})
            if self.path == '/api/agent-apply':
                data = fields(self.body(), {'entryId', 'baseRevision', 'operations'})
                identity = entry_id(data['entryId'])
                revision = integer(data['baseRevision'], 'base revision')
                operations = parse_operations(data['operations'], lambda: uuid4().hex)
                entry = store.commit(identity, revision, lambda document: apply_operations(document, operations))
                return self.reply(200, {**entry.wire(summary=True), 'blockIds': [op.identity for op in operations]})
            match = ENTRY_PATH.fullmatch(self.path)
            if match and not match[2]:
                data = fields(self.body(), {'baseRevision', 'document'})
                revision = integer(data['baseRevision'], 'base revision')
                document = NotebookDocument.parse(data['document'])
                return self.reply(200, store.commit(match[1], revision, lambda _previous: document).wire())
            return self.error(404, 'not-found', 'Route not found')

        def delete(self):
            match = ENTRY_PATH.fullmatch(self.path)
            if match and not match[2]:
                store.delete(match[1])
                return self.reply(200, {'deleted': True, 'id': match[1]})
            return self.error(404, 'not-found', 'Route not found')

    return Handler


def main():
    store = EntryStore(os.environ['PERO_APP_DATA'])
    with ThreadingHTTPServer(('127.0.0.1', 0), handler(store, os.environ['PERO_APP_TOKEN'])) as server:
        def stop(_signal, _frame):
            threading.Thread(target=server.shutdown, daemon=True).start()

        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, stop)
        print(json.dumps({'port': server.server_port}), flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
