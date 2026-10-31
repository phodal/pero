"""Start the unchanged Point Python backend under the owning Pero process.

Point's PORT, data and HMAC protocol stay intact. Only the stdlib server's
readiness is adapted to the Host's existing startup handshake.
"""
import http.server
import json
import os
from pathlib import Path
import runpy
import sys


def main():
    root = Path(__file__).resolve().parent
    app = json.loads((root / "point-source/app.json").read_text())
    os.environ.update(PORT="0", POINT_APP_DATA=os.environ["PERO_APP_DATA"],
                      POINT_APP_ROOT=str(root / "point-source"), POINT_APP_NAME=app["name"],
                      POINT_APP_PROXY_SECRET=os.environ["PERO_APP_TOKEN"])
    original = http.server.HTTPServer.server_activate

    def activate(server):
        original(server)
        print(json.dumps({"port": server.server_port}), flush=True)

    http.server.HTTPServer.server_activate = activate
    entry = root / "point-source" / app["backend"]["entryPoint"]
    sys.path.insert(0, str(entry.parent))
    os.chdir(root / "point-source")
    runpy.run_path(str(entry), run_name="__main__")


if __name__ == "__main__":
    main()
