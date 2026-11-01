#!/usr/bin/env python3
"""One JSON request on stdin, one JSON result on stdout. Never executes source.

Use a dedicated --cache directory (not the concurrently running App profile).
Actions: inspect, commit, analysis, source, source-read, pdf, export.
Exit: 0 success, 2 invalid input, 3 permission, 4 unavailable, 5 acquisition
failure, 6 interrupted. Inspect/start wait for bounded workers to finish.
"""
import argparse
import json
from pathlib import Path
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.model import Invalid
from paper_agent.research_commands import execute
from paper_agent.store import ResearchStore


def run(store, envelope):
    if not isinstance(envelope, dict) or set(envelope) != {'action', 'input'}:
        raise Invalid('Supply action and input only')
    action, request = envelope['action'], envelope['input']
    result = execute(store, action, request)
    try:
        while result.get('status') in ('inspecting', 'running'):
            time.sleep(0.1)
            poll = dict(draftId=result['id']) if action == 'inspect' else {**request, 'operation': 'status'}
            result = execute(store, action, poll)
    except KeyboardInterrupt:
        cancel = dict(draftId=result['id'], cancel=True) if action == 'inspect' else {**request, 'operation': 'cancel'}
        execute(store, action, cancel)
        raise
    return result


def main(argv=None, *, store=None, stdin=None, stdout=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=store is None)
    args = parser.parse_args(argv)
    stdin, stdout = stdin or sys.stdin, stdout or sys.stdout
    owned = store is None
    store = store or ResearchStore(args.cache)
    try:
        raw = stdin.read(131073)
        if len(raw) > 131072:
            raise Invalid('JSON request exceeds 128 KiB', 413)
        result = run(store, json.loads(raw))
        status = result.get('status')
        code = 5 if status in ('failed', 'denied') else 6 if status in ('cancelled', 'interrupted') else 4 if status == 'unavailable' else 0
        output = dict(ok=code == 0, result=result, code=code)
    except (Invalid, ValueError, TypeError) as error:
        status = error.status if isinstance(error, Invalid) else 400
        code = 3 if status in (401, 403) else 4 if status == 404 else 2
        output = dict(ok=False, code=code, error=str(error))
    except OSError as error:
        code, output = 4, dict(ok=False, code=4, error='Local evidence unavailable: ' + type(error).__name__)
    except KeyboardInterrupt:
        code, output = 6, dict(ok=False, code=6, error='Cancelled')
    finally:
        if owned:
            for name in ('source_downloads', 'pdf_downloads', 'imports'):
                worker = getattr(store, name, None)
                if worker:
                    worker.close()
    stdout.write(json.dumps(output, ensure_ascii=False) + '\n')
    return code


if __name__ == '__main__':
    raise SystemExit(main())
