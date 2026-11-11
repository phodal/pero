"""Opt-in JupyterLab+AI Server/Contents/kernel protocol probe, with no Agent provider."""
import argparse
import asyncio
from datetime import datetime, timezone
from importlib import metadata
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
from urllib.request import Request, urlopen
from uuid import uuid4

import nbformat
from fastmcp import Client
from tornado.websocket import websocket_connect
from task import CELLS
from process_memory import process_memory

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
for name in ('config', 'data', 'runtime'):
    (output / name).mkdir(mode=0o700)
shutil.copyfile(Path(__file__).with_name('input.csv'), output / 'input.csv')
token = secrets.token_hex(24)
env = dict(os.environ, JUPYTER_CONFIG_DIR=str(output/'config'), JUPYTER_DATA_DIR=str(output/'data'),
           JUPYTER_RUNTIME_DIR=str(output/'runtime'), JUPYTER_TOKEN=token, PYTHONNOUSERSITE='1')
log = (output/'server.log').open('w')
started = time.monotonic()
process = subprocess.Popen([sys.executable, '-m', 'jupyterlab', '--no-browser', '--ServerApp.ip=127.0.0.1',
    '--ServerApp.port=0', '--ServerApp.port_retries=0', '--ServerApp.log_level=ERROR',
    '--MCPExtensionApp.mcp_port=0', '--MCPServer.host=127.0.0.1',
    '--ServerApp.root_dir='+str(output)], env=env, cwd=output, stdout=log, stderr=log)
calls = []


def api(path, method='GET', value=None):
    request = Request(base+path, method=method, headers={'Authorization': 'token '+token,
        'Content-Type': 'application/json'}, data=json.dumps(value).encode() if value is not None else None)
    with urlopen(request, timeout=20) as response:
        body = response.read()
        calls.append(dict(path=path, method=method, status=response.status))
        return json.loads(body) if body else None


async def probe():
    notebook = nbformat.v4.new_notebook(cells=[nbformat.v4.new_code_cell(source) for source in CELLS])
    notebook.metadata.kernelspec = dict(name='python3', display_name='Python 3', language='python')
    api('/api/contents/analysis.ipynb', 'PUT', dict(type='notebook', format='json', content=notebook))
    session = api('/api/sessions', 'POST', dict(path='analysis.ipynb', type='notebook', name='analysis.ipynb', kernel={'name':'python3'}))
    kernel = '/api/kernels/'+session['kernel']['id']
    client_id = uuid4().hex

    async def connect():
        return await websocket_connect(base.replace('http:', 'ws:')+kernel+'/channels?session_id='+client_id+'&token='+token)

    ws = await connect()

    async def execute(source, interrupt=False):
        identity = uuid4().hex
        ws.write_message(json.dumps(dict(header=dict(msg_id=identity, username='probe', session=client_id,
            date=datetime.now(timezone.utc).isoformat(), msg_type='execute_request', version='5.3'),
            parent_header={}, metadata={}, channel='shell', content=dict(code=source, silent=False,
            store_history=True, user_expressions={}, allow_stdin=False, stop_on_error=True))))
        outputs, count, interrupted = [], None, False
        deadline = asyncio.get_running_loop().time()+30
        while True:
            raw = await asyncio.wait_for(ws.read_message(), deadline-asyncio.get_running_loop().time())
            message = json.loads(raw)
            if message.get('parent_header', {}).get('msg_id') != identity:
                continue
            kind, content = message['header']['msg_type'], message['content']
            if kind == 'execute_input': count = content['execution_count']
            if kind in ('stream', 'error', 'display_data', 'execute_result'):
                outputs.append(nbformat.v4.output_from_msg(message))
            if interrupt and kind == 'stream' and 'ready' in content.get('text', '') and not interrupted:
                api(kernel+'/interrupt', 'POST'); interrupted = True
            if kind == 'status' and content['execution_state'] == 'idle':
                return outputs, count

    for cell in notebook.cells:
        cell.outputs, cell.execution_count = await execute(cell.source)
    expected = {'control': {'n': 3, 'mean_mg_l': '2'}, 'treatment': {'n': 3, 'mean_mg_l': '4'}}
    assert json.loads((output/'result.json').read_text()) == expected
    api('/api/contents/analysis.ipynb', 'PUT', dict(type='notebook', format='json', content=notebook))
    reopened = nbformat.reads(json.dumps(api('/api/contents/analysis.ipynb')['content']), as_version=4)
    for before, after in zip(notebook.cells, reopened.cells, strict=True):
        for key in ('source', 'outputs', 'execution_count'):
            assert before[key] == after[key], key
    errors, _ = await execute("raise ValueError('authored upstream probe')")
    assert errors[0].ename == 'ValueError'
    interrupted, _ = await execute("print('ready', flush=True)\nwhile True: pass", interrupt=True)
    assert any(item.get('ename') == 'KeyboardInterrupt' for item in interrupted)
    api(kernel+'/restart', 'POST'); ws.close(); ws = await connect()
    (output/'result.json').unlink()
    for source in CELLS: await execute(source)
    assert json.loads((output/'result.json').read_text()) == expected
    ws.close()
    mcp_file = output/'runtime'/f'jpserver-mcp-{process.pid}.json'
    deadline = time.monotonic()+10
    while not mcp_file.exists():
        if time.monotonic()>deadline: raise TimeoutError('Jupyter MCP readiness')
        await asyncio.sleep(.05)
    mcp_info = json.loads(mcp_file.read_text())
    async with Client(mcp_info['url']) as client:
        tools = await client.list_tools()
        mcp_tools = [dict(name=tool.name, inputSchema=tool.inputSchema) for tool in tools]
    assert mcp_tools
    (output/'mcp-tools.json').write_text(json.dumps(mcp_tools, indent=2))
    # Browser uses this private, short-lived token only on loopback; no token in receipts.
    connection = output/'connection.json'
    connection.write_text(json.dumps(dict(url=base+'/lab/tree/analysis.ipynb?token='+token)))
    connection.chmod(0o600)
    subprocess.run(['node', str(Path(__file__).with_name('service_browser.mjs')), str(output)], check=True, timeout=60)
    connection.unlink()
    memory = process_memory(process.pid)
    api('/api/sessions/'+session['id'], 'DELETE')
    return dict(execution='completed', verification='authored_fixture_equal', scientificAcceptance='not_assessed',
                saveReopen=True, error=True, interrupt=True, restart=True, aiProvider='none; no model request',
                mcp=dict(initialize=True, toolCount=len(mcp_tools), jupyterTokenRequired=False,
                         scope='native MCP discovery only; no ACP Agent or Host bridge'), memory=memory, calls=calls)


try:
    deadline = time.monotonic()+30
    server_info = output/'runtime'/f'jpserver-{process.pid}.json'
    while not server_info.exists():
        if process.poll() is not None or time.monotonic()>deadline: raise TimeoutError('Jupyter server readiness')
        time.sleep(.05)
    info = json.loads(server_info.read_text())
    base = info['url'].rstrip('/')
    ready_seconds = time.monotonic()-started
    receipt = asyncio.run(probe())
    receipt['startupSeconds'] = ready_seconds
    receipt['totalSeconds'] = time.monotonic()-started
    receipt['packages'] = {name: metadata.version(name) for name in ('jupyterlab','jupyter-ai','jupyter_server','ipykernel')}
    (output/'receipt.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))
finally:
    process.terminate()
    try: process.wait(timeout=10)
    except subprocess.TimeoutExpired: process.kill(); process.wait()
    log.close()
    path = output/'server.log'
    path.write_text(path.read_text().replace(token, '[redacted]'))
    (output/'connection.json').unlink(missing_ok=True)
