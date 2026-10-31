"""Host-owned Control Lab backend; the Host continues to own Agent execution."""
from http.server import ThreadingHTTPServer
import json
import os
import signal
import threading
from control_lab.http import handler
from control_lab.store import ExperimentStore


def main():
    os.environ.setdefault('MPLCONFIGDIR',os.path.join(os.environ['PERO_APP_DATA'],'.matplotlib'))
    os.environ.setdefault('XDG_CACHE_HOME',os.path.join(os.environ['PERO_APP_DATA'],'.cache'))
    store = ExperimentStore(os.environ['PERO_APP_DATA'])
    server = ThreadingHTTPServer(('127.0.0.1',0),handler(store,os.environ['PERO_APP_TOKEN']))
    server.daemon_threads = True
    print(json.dumps({'port':server.server_port}),flush=True)
    def stop(_signal,_frame):
        store.cancelled.set()
        threading.Thread(target=server.shutdown,daemon=True).start()
    for sig in (signal.SIGTERM,signal.SIGINT): signal.signal(sig,stop)
    try:
        server.serve_forever()
    finally:
        store.close()
        server.server_close()


if __name__=='__main__': main()
