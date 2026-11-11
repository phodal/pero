"""Allowlisted deterministic ACP method. No model, arbitrary shell or scheduling."""
import argparse
import asyncio
import json
from pathlib import Path
import sys
import uuid

from contract import digest, encoded
from bundle import ROOT, load_identity
from dispatch import PREFIX, ACCEPTANCE, task_prompt


async def serve(workspace: Path):
    session = str(uuid.uuid4())
    started = False
    pending = None
    process = None
    cancelled = False
    identity = load_identity()

    def send(value):
        print(json.dumps({'jsonrpc': '2.0', **value}, allow_nan=False), flush=True)

    def notice(text):
        send({'method': 'session/update', 'params': {'sessionId': session,
              'update': {'sessionUpdate': 'agent_message_chunk', 'content': {'type': 'text', 'text': text}}}})

    async def execute(request_id, experiment):
        nonlocal process
        try:
            output = workspace / 'pybamm-results' / session
            output.mkdir(parents=True, exist_ok=False)
            result_path = output / 'result.jsonl'
            process = await asyncio.create_subprocess_exec(
                sys.executable, str(ROOT / 'run.py'), experiment, str(result_path),
                cwd=workspace, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            notice('PERO_PYBAMM_START ' + json.dumps({'experiment': experiment, 'pid': process.pid, 'session': session}))
            stdout, stderr = await process.communicate()
            (output / 'stdout.log').write_bytes(stdout)
            (output / 'stderr.log').write_bytes(stderr)
            notice('PERO_PYBAMM_STOP ' + json.dumps({'pid': process.pid, 'exit_code': process.returncode,
                   'cancelled': cancelled, 'stdout': stdout.decode(errors='replace')[-4000:],
                   'stderr': stderr.decode(errors='replace')[-4000:]}))
            if cancelled:
                send({'id': request_id, 'result': {'stopReason': 'cancelled'}})
            elif process.returncode:
                send({'id': request_id, 'error': {'code': -32603, 'message': 'Frozen calculation failed; see persisted process log'}})
            else:
                content = result_path.read_text()
                notice(PREFIX + encoded({'sha256': digest(content.encode()), 'content': content,
                                        'path': str(result_path.relative_to(workspace)), 'session': session}).decode())
                send({'id': request_id, 'result': {'stopReason': 'end_turn'}})
        except Exception as error:
            # A background task must settle its ACP request even when process I/O fails.
            failure = f'{type(error).__name__}: {error}'
            notice('PERO_PYBAMM_ERROR ' + json.dumps({'error': failure}))
            send({'id': request_id, 'error': {'code': -32603, 'message': failure}})

    async def stop():
        nonlocal cancelled
        cancelled = True
        if process and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 1)
            except TimeoutError:
                process.kill()
                await process.wait()
        if pending:
            await pending

    while line := await asyncio.to_thread(sys.stdin.readline):
        request = json.loads(line)
        method, request_id, params = request.get('method'), request.get('id'), request.get('params', {})
        try:
            if method == 'initialize':
                send({'id': request_id, 'result': {'protocolVersion': 1, 'agentCapabilities': {},
                      'agentInfo': {'name': identity.method.method_id, 'version': '1'}}})
            elif method == 'session/new':
                if Path(params['cwd']).resolve() != workspace:
                    raise ValueError('Session workspace is not the operator-configured directory')
                send({'id': request_id, 'result': {'sessionId': session}})
            elif method == 'session/prompt':
                if started or params['sessionId'] != session:
                    raise ValueError('This process accepts one frozen experiment only')
                text = ''.join(block.get('text', '') for block in params['prompt'])
                matches = [e.id for e in identity.method.experiments if text ==
                           task_prompt(e.id, identity.sha256) + '\n\nAcceptance criteria:\n' + ACCEPTANCE]
                if len(matches) != 1:
                    raise ValueError('Prompt does not match the frozen method/input/acceptance')
                started = True
                pending = asyncio.create_task(execute(request_id, matches[0]))
            elif method == 'session/cancel':
                if params.get('sessionId') != session:
                    raise ValueError('Unknown session')
                await stop()
            elif request_id is not None:
                send({'id': request_id, 'error': {'code': -32601, 'message': 'Method not supported'}})
        except (ValueError, KeyError) as error:
            if request_id is not None:
                send({'id': request_id, 'error': {'code': -32602, 'message': str(error)}})
    await stop()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=Path)
    args = parser.parse_args()
    asyncio.run(serve(args.workspace.resolve(strict=True)))
