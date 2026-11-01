"""Synthetic external-network seam; actual installed Paper handlers and core."""
from http.server import ThreadingHTTPServer
import json
import os
import signal
import threading

from paper_agent.http import handler
from paper_agent.store import ResearchStore
from source_fixture import install
from paper_agent.model import Invalid
from paper_agent.literature import LiteratureClient
from paper_agent.pdf_files import PdfFiles
from paper_agent.thumbnails import PaperThumbnails


def denied_external(*_args, **_kwargs):
    raise Invalid('This campaign does not authorize unrelated external access', 403)


def campaign_handler(store, token):
    return handler(store, token, literature=LiteratureClient(fetch=denied_external),
        pdf_files=PdfFiles(fetch=denied_external), thumbnails=PaperThumbnails(fetch=denied_external))


def main():
    store = ResearchStore(os.environ['PERO_APP_DATA'])
    install(store)
    server = ThreadingHTTPServer(('127.0.0.1', 0), campaign_handler(store, os.environ['PERO_APP_TOKEN']))
    server.daemon_threads = True
    print(json.dumps({'port': server.server_port}), flush=True)

    def stop(_signal, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()

    for name in (signal.SIGTERM, signal.SIGINT):
        signal.signal(name, stop)
    try:
        server.serve_forever()
    finally:
        store.source_downloads.close()
        store.pdf_downloads.close()
        store.imports.close()
        server.server_close()


if __name__ == '__main__':
    main()
