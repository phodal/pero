"""One killable metadata worker: DNS and response headers share a wall deadline."""
import json
import multiprocessing
import os
import threading
import time

from .model import canonical
from .research_resources import ImportDraft

INSPECTION_SECONDS = 55


def inspect_child(output, draft, inspector, cancelled, seconds):
    parent = multiprocessing.parent_process()
    finished = threading.Event()

    def watch_parent():
        deadline = time.monotonic() + seconds
        while not finished.wait(0.1):
            # DNS/TLS/header I/O cannot prevent this process from exiting. A lost
            # Host parent must not leave a metadata worker behind.
            if cancelled.is_set() or time.monotonic() >= deadline or (parent and not parent.is_alive()):
                os._exit(2)

    watcher = threading.Thread(target=watch_parent, daemon=True)
    watcher.start()
    try:
        try:
            result = inspector.inspect(draft, cancelled)
        except Exception as error:
            result = draft.finish(draft.resources, draft.warnings, 'failed',
                                  f'Inspection failed ({type(error).__name__}). Retry this URL.')
        output.send_bytes(canonical(result.to_dict()))
    finally:
        finished.set()
        output.close()


def inspect_bounded(draft, inspector, cancelled, seconds=INSPECTION_SECONDS):
    context = multiprocessing.get_context('spawn')
    receive, send = context.Pipe(duplex=False)
    process_cancelled = context.Event()
    process = context.Process(target=inspect_child, args=(send, draft, inspector, process_cancelled, seconds), daemon=True)
    try:
        process.start()
        send.close()
        deadline = time.monotonic() + seconds
        while True:
            if cancelled.is_set():
                return draft.finish(draft.resources, draft.warnings, 'cancelled', 'Inspection cancelled.')
            if time.monotonic() >= deadline:
                return draft.finish(draft.resources, draft.warnings, 'failed', 'Inspection timed out. Retry this URL.')
            if receive.poll(0.05):
                try:
                    return ImportDraft.from_record(json.loads(receive.recv_bytes(1_000_000)))
                except (EOFError, OSError):
                    return draft.finish(draft.resources, draft.warnings, 'failed', 'Inspection interrupted or timed out. Retry this URL.')
            if not process.is_alive():
                return draft.finish(draft.resources, draft.warnings, 'failed', 'Inspection interrupted or timed out. Retry this URL.')
    finally:
        process_cancelled.set()
        if process.pid:
            if process.is_alive():
                process.terminate()
            process.join(timeout=1)
            if process.is_alive():
                process.kill()
                process.join(timeout=1)
            process.close()
        receive.close()
        send.close()
