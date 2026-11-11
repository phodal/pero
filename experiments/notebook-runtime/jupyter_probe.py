"""Real Jupyter execution and kernel lifecycle, with no Notebook server or AI."""
import json
from pathlib import Path
import sys
import time

import nbformat
from nbclient import NotebookClient
from nbconvert import HTMLExporter
from jupyter_client import KernelManager


def execute(source, target):
    notebook = nbformat.read(source, as_version=4)
    nbformat.validate(notebook)
    started = time.perf_counter()
    NotebookClient(notebook, timeout=20, kernel_name='pero-poc',
                   resources={'metadata': {'path': str(target.parent)}}).execute()
    elapsed = time.perf_counter() - started
    nbformat.write(notebook, target)
    reopened = nbformat.read(target, as_version=4)
    nbformat.validate(reopened)
    assert reopened.cells == notebook.cells
    html, _ = HTMLExporter().from_notebook_node(reopened)
    target.with_suffix('.html').write_text(html)
    print(json.dumps({'execution_seconds': elapsed, 'reopened_outputs': True,
                      'cells': len(notebook.cells)}))


def lifecycle():
    km = KernelManager(kernel_name='pero-poc')
    client = None
    events = {}
    started = time.perf_counter()
    km.start_kernel()
    try:
        client = km.client()
        client.start_channels()
        client.wait_for_ready(timeout=20)
        events['start_ready_seconds'] = time.perf_counter() - started

        def collect(message_id):
            messages = []
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                message = client.get_iopub_msg(timeout=max(.01, deadline - time.monotonic()))
                if message['parent_header'].get('msg_id') != message_id:
                    continue
                messages.append(message)
                if message['msg_type'] == 'status' and message['content']['execution_state'] == 'idle':
                    return messages
            raise TimeoutError('Kernel did not become idle')

        # An observed stream proves the cell is running before interruption.
        request = client.execute('sentinel = 42\nprint("CELL_STARTED", flush=True)\nwhile True: pass')
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            message = client.get_iopub_msg(timeout=max(.01, deadline - time.monotonic()))
            if message['parent_header'].get('msg_id') == request and message['msg_type'] == 'stream' and 'CELL_STARTED' in message['content']['text']:
                break
        else:
            raise TimeoutError('Cell start not observed')
        started = time.perf_counter()
        km.interrupt_kernel()
        messages = collect(request)
        assert any(m['msg_type'] == 'error' and m['content']['ename'] == 'KeyboardInterrupt' for m in messages)
        events['interrupt_idle_seconds'] = time.perf_counter() - started
        messages = collect(client.execute('print(sentinel)'))
        assert any(m['msg_type'] == 'stream' and '42' in m['content']['text'] for m in messages)
        events['interrupt_preserves_prior_mutation'] = True
        started = time.perf_counter()
        km.restart_kernel(now=True)
        client.wait_for_ready(timeout=20)
        messages = collect(client.execute('print("sentinel" in globals())'))
        assert any(m['msg_type'] == 'stream' and 'False' in m['content']['text'] for m in messages)
        events['restart_ready_seconds'] = time.perf_counter() - started
        events['restart_discards_state'] = True
    finally:
        km.shutdown_kernel(now=True)
        if client:
            client.stop_channels()
    events['shutdown_confirmed'] = not km.is_alive()
    print(json.dumps(events))


if __name__ == '__main__':
    if sys.argv[1] == 'execute':
        execute(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        lifecycle()
