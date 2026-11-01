"""Pero Host-owned Paper Agent Python backend. The Host owns the research loop.

A local embedding model is optional. Without it, saved-paper search stays keyword-only.
"""
from http.server import ThreadingHTTPServer
import json
import os
import signal
import threading

from app_infra.embed import open_embedder
from paper_agent.http import handler
from paper_agent.store import ResearchStore
from paper_agent.pcgym_app import PcgymApp
from pathlib import Path


def main():
    store = ResearchStore(os.environ["PERO_APP_DATA"], open_embedder())
    checkout = os.environ.get('PERO_PAPER_PCGYM_CHECKOUT')
    compute_secret = os.environ.get('PERO_PAPER_COMPUTE_TOKEN')
    if checkout and compute_secret:
        path = Path(checkout)
        if not path.is_absolute() or not path.is_dir() or path.resolve() != path:
            raise ValueError('Trusted PC-Gym checkout must be an existing canonical absolute directory')
        store.pcgym = PcgymApp(store, checkout=path, allow_execution=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler(store, os.environ["PERO_APP_TOKEN"], compute_secret=compute_secret))
    server.daemon_threads = True
    print(json.dumps({"port": server.server_port}), flush=True)

    def stop(_signal, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()

    for name in (signal.SIGTERM, signal.SIGINT):
        signal.signal(name, stop)
    try:
        server.serve_forever()
    finally:
        store.pcgym.close()
        store.source_downloads.close()
        store.pdf_downloads.close()
        store.imports.close()
        server.server_close()


if __name__ == "__main__":
    main()
