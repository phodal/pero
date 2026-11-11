"""Test-only loopback relay to the macOS control plane over Lima's private network."""
import argparse
import json
import os
from pathlib import Path
import select
import socket
import socketserver

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('host')
parser.add_argument('port', type=int)
parser.add_argument('receipt', type=Path)
args = parser.parse_args()


class Relay(socketserver.BaseRequestHandler):
    def handle(self):
        with socket.create_connection((args.host, args.port), timeout=2) as upstream:
            peers = (self.request, upstream)
            while True:
                readable, _, _ = select.select(peers, [], [], 3)
                if not readable:
                    return
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    (upstream if source is self.request else self.request).sendall(data)


with socketserver.ThreadingTCPServer(('127.0.0.1', 0), Relay) as server:
    server.daemon_threads = True
    args.receipt.write_text(json.dumps({'port': server.server_address[1], 'pid': os.getpid()}))
    server.serve_forever()
