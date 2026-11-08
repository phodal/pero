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

from agent_read import AgentRead
from document import MAX_DOCUMENT_BYTES, NotebookDocument, fields, integer
from operations import apply_operations, parse_operations
from store import EntryStore, MissingEntry, RevisionConflict


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
            if not 0 < length <= MAX_DOCUMENT_BYTES + 4096:
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

        def dispatch(self, route):
            if not token or not hmac.compare_digest(token, self.headers.get('X-Pero-App-Token', '').encode('latin1')):
                return self.error(401, 'unauthorized', 'Host authentication required')
            try:
                self.connection.settimeout(15)
                return route()
            except RevisionConflict as error:
                return self.error(409, 'revision-conflict', str(error), currentRevision=error.current_revision)
            except MissingEntry as error:
                return self.error(404, 'not-found', str(error))
            except ValueError as error:
                return self.error(400, 'invalid-request', str(error))
            except (OSError, sqlite3.Error):
                return self.error(500, 'storage-error', 'Notebook storage operation failed')

        def get(self):
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
            if self.path == '/api/entries':
                data = fields(self.body(), set(), {'title'})
                document = NotebookDocument.parse({
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
