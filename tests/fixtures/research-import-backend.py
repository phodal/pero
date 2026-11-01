"""Fixture composition root; production handlers/store/downloader are unchanged."""
from http.server import ThreadingHTTPServer
import json
import os
import signal
import threading

from research_resources_fixture import download_opener, fetch


def main():
    if os.environ['PERO_APP_NAME'] == 'paper-agent':
        from paper_agent.http import handler
        from paper_agent.resource_inspection import ResourceInspector
        from paper_agent.store import ResearchStore
        store = ResearchStore(os.environ['PERO_APP_DATA'])
        store.imports.inspector = ResourceInspector(fetch=fetch)
        close = store.imports.close
        serving = handler(store, os.environ['PERO_APP_TOKEN'])
    elif os.environ['PERO_APP_NAME'] == 'data':
        from catalog import Catalog
        from downloads import Downloads
        from server import handler
        downloads = Downloads(Catalog(os.environ['PERO_APP_DATA']),
                              opener=download_opener(os.environ['PERO_APP_DATA']))
        close = downloads.close
        serving = handler(downloads, os.environ['PERO_APP_TOKEN'])
    else:
        raise AssertionError('Only the fixture Paper and Data packages may use this composition root')
    server = ThreadingHTTPServer(('127.0.0.1', 0), serving)
    server.daemon_threads = True
    print(json.dumps({'port': server.server_port}), flush=True)
    def stop(_signal, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()
    for name in (signal.SIGTERM, signal.SIGINT):
        signal.signal(name, stop)
    try:
        server.serve_forever()
    finally:
        close()
        server.server_close()


if __name__ == '__main__':
    main()
