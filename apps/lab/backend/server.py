"""Host-owned Python lifecycle. Token never leaves this private transport."""
from http.server import ThreadingHTTPServer
import json
import os
import signal
import threading
from experiments import ExperimentStore
from http_api import handler


def main():
    store=ExperimentStore(os.environ['PERO_APP_DATA'])
    server=ThreadingHTTPServer(('127.0.0.1',0),handler(store,os.environ['PERO_APP_TOKEN']))
    server.daemon_threads=True
    print(json.dumps({'port':server.server_port}),flush=True)
    def stop(_signal,_frame):
        store.cancelled.set()
        threading.Thread(target=server.shutdown,daemon=True).start()
    for sig in (signal.SIGTERM,signal.SIGINT): signal.signal(sig,stop)
    try: server.serve_forever()
    finally:
        store.close(); server.server_close()

if __name__=='__main__': main()
