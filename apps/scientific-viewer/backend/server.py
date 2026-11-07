"""Host-token loopback adapter; bounded, single-flight local molecule worker."""
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import socket
import time
import subprocess
import sys
import threading
from molecules import MAX_OUTPUT, MAX_REQUEST
from windows_job import WorkerJob
from notebooks import NotebookCommand, Notebooks


class PreviewRunner:
    def __init__(self, command=None, timeout=20):
        self.command = command or [sys.executable, '-E', '-s', str(Path(__file__).with_name('worker.py'))]
        self.timeout = timeout
        self.lock = threading.Lock()
        self.closed = threading.Event()
        self.process = None

    def close(self):
        self.closed.set()
        process = self.process
        if process is not None and process.poll() is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            process.wait()

    def run(self, body):
        if self.closed.is_set():
            return 503, {'error': 'Molecule backend is stopping'}
        if not self.lock.acquire(blocking=False):
            return 503, {'error': 'A molecule preview is already running'}
        process = None
        job = None
        try:
            job = WorkerJob()
            env = {**os.environ, 'OMP_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1'}
            process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
            self.process = process
            # Bind ownership before sending any input. The fixed worker waits
            # for stdin EOF before parsing data or importing RDKit.
            job.assign(process)
            if self.closed.is_set():
                process.kill()
            output = []
            def read():
                output.append(process.stdout.read(MAX_OUTPUT + 1))
                if len(output[0]) > MAX_OUTPUT:
                    process.kill()
            def write():
                try:
                    process.stdin.write(body)
                    process.stdin.close()
                except (BrokenPipeError, OSError):
                    pass
            reader = threading.Thread(target=read)
            writer = threading.Thread(target=write)
            reader.start()
            writer.start()
            try:
                process.wait(timeout=self.timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                return 504, {'error': 'Molecule preview exceeded 20 seconds'}
            finally:
                reader.join()
                writer.join()
                process.stdout.close()
                process.stdin.close()
            if len(output[0]) > MAX_OUTPUT:
                return 413, {'error': 'Preview exceeds 4 MiB; select fewer molecules'}
            if process.returncode not in (0, 2):
                return 500, {'error': 'RDKit worker failed; check the configured App Python environment'}
            return (200 if process.returncode == 0 else 400), json.loads(output[0])
        except (OSError, ValueError):
            return 500, {'error': 'RDKit worker ownership or runtime unavailable; preview was not completed'}
        finally:
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
            if process is not None:
                for pipe in (process.stdin, process.stdout):
                    try:
                        pipe.close()
                    except OSError:
                        pass
            if job is not None:
                job.close()
            self.process = None
            self.lock.release()


def handler(runner, secret, notebooks=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            if status >= 400 and 'error' in value:
                value = {**value, 'detail': value['error']}
            body = json.dumps(value, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def reject(self, status, value):
            # Send the response and a FIN before discarding any unread request
            # bytes. Closing a socket with unread data can reset the response,
            # especially on Windows. Neither the drain nor its wait is unbounded.
            self.reply(status, value)
            try:
                self.wfile.flush()
                self.connection.shutdown(socket.SHUT_WR)
                deadline = time.monotonic() + 1
                remaining = MAX_REQUEST
                while remaining:
                    timeout = deadline - time.monotonic()
                    if timeout <= 0:
                        break
                    self.connection.settimeout(timeout)
                    chunk = self.rfile.read1(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
            except (OSError, ValueError):
                pass

        def do_POST(self):
            if not secret or not hmac.compare_digest(secret.encode(), self.headers.get('X-Pero-App-Token', '').encode()):
                return self.reject(401, {'error': 'Host authentication required'})
            if self.path not in ('/api/molecules', '/api/notebooks'):
                return self.reject(404, {'error': 'Route not found'})
            try:
                self.connection.settimeout(20)
                if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('JSON with Content-Length is required')
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= MAX_REQUEST:
                    raise ValueError('Request must be between 1 byte and 1 MiB')
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError('Incomplete request')
                if self.path == '/api/notebooks':
                    if notebooks is None:
                        raise ValueError('Notebook execution is unavailable')
                    return self.reply(200, notebooks.dispatch(NotebookCommand.parse(json.loads(raw))))
                return self.reply(*runner.run(raw))
            except (ValueError, TimeoutError, ImportError, RuntimeError) as error:
                return self.reject(400, {'error': str(error)})
    return Handler


def main():
    runner = PreviewRunner()
    notebooks = Notebooks(os.environ['PERO_APP_DATA'])
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler(runner, os.environ['PERO_APP_TOKEN'], notebooks))
    server.daemon_threads = True
    print(json.dumps({'port': server.server_port}), flush=True)
    def stop(_signal, _frame):
        runner.close()
        notebooks.close()
        threading.Thread(target=server.shutdown, daemon=True).start()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, stop)
    try:
        server.serve_forever()
    finally:
        runner.close()
        notebooks.close()
        server.server_close()


if __name__ == '__main__':
    main()
