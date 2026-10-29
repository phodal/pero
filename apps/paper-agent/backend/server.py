"""Pero Host-owned Paper Agent Python backend; no model or execution loop."""
from http.server import ThreadingHTTPServer
import json
import os
import signal
import threading

from paper_agent.http import handler
from paper_agent.store import ResearchStore


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler(
        ResearchStore(os.environ["PERO_APP_DATA"]), os.environ["PERO_APP_TOKEN"]))
    server.daemon_threads = True
    print(json.dumps({"port": server.server_port}), flush=True)

    def stop(_signal, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()

    for name in (signal.SIGTERM, signal.SIGINT):
        signal.signal(name, stop)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
