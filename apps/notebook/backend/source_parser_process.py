"""One bounded local source parser process in the existing Host Python environment.

Uses the same trusted request/result-file pattern as Paper's optional parser.
No interpreter provisioning, remote execution or configurable HTTP commands.
"""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

# -I excludes the script directory. Add only this installed backend's own path.
if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from source_extraction import ExtractionRequest, SourceExtraction

MAX_OUTPUT_BYTES = 2 * 1024 * 1024
MEMORY_BYTES = 512 * 1024 * 1024
TIMEOUT_SECONDS = 120


@dataclass(frozen=True)
class ParserProcessError(ValueError):
    detail: str
    unavailable: bool = False

    def __str__(self):
        return self.detail


def run_source_parser(request, *, timeout=TIMEOUT_SECONDS, memory_bytes=MEMORY_BYTES):
    """Internal test seams may lower budgets; HTTP callers cannot supply them."""
    file = request.file
    payload = dict(file=dict(filename=file.filename, mime=file.mime, data=file.data, sha256=file.sha256),
                   mode=request.mode, page=request.page)
    with tempfile.TemporaryDirectory(prefix='pero-source-parser-') as directory:
        request_path, output_path = Path(directory) / 'request.json', Path(directory) / 'result.json'
        request_path.write_text(json.dumps(payload), encoding='utf-8')
        try:
            process = subprocess.Popen([sys.executable, '-I', '-B', str(Path(__file__).resolve()),
                                        str(request_path), str(output_path), str(memory_bytes)],
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, start_new_session=os.name == 'posix')
        except OSError as error:
            raise ParserProcessError('Cannot start the local parser. Repair Notebook dependencies in Host and retry.', True) from error
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired as error:
            if os.name == 'posix':
                # The parser's local OCR subprocess inherits this group.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            else:
                process.kill()
            process.wait()
            raise ParserProcessError('Local extraction exceeded its time limit. Choose a smaller file or PDF page.') from error
        if process.returncode and os.name == 'posix':
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if process.returncode:
            raise ParserProcessError('The local parser stopped without a result. The file may be malformed or exceed the parser memory budget. Choose a smaller file or export the needed page separately.')
        try:
            if output_path.stat().st_size > MAX_OUTPUT_BYTES:
                raise ParserProcessError('Extracted source exceeds the 2 MiB parser result budget. Choose a smaller file.')
            response = json.loads(output_path.read_text(encoding='utf-8'))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ParserProcessError('The local parser did not return a readable result. Try a smaller file or repair Notebook dependencies in Host.') from error
        if not response.get('ok'):
            raise ParserProcessError(response.get('detail', 'Local extraction failed.'), response.get('unavailable') is True)
        result = response['result']
        # Admit the result at this process boundary, bound to the bytes sent.
        SourceExtraction.parse(result['extraction'], result['text'], file.sha256)
        return result


def main():
    request_path, output_path, memory_bytes = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
    memory_limited = sys.platform.startswith('linux')
    if os.name == 'posix':
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))
        if memory_limited:
            resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    from source_parsers import extract_source, ParserUnavailable
    try:
        request = ExtractionRequest.parse(json.loads(request_path.read_text(encoding='utf-8')))
        result = extract_source(request)
        memory = f'{memory_bytes // (1024 * 1024)} MiB virtual-address limit per process on Linux' if memory_limited else 'no enforced parser memory cap on this platform'
        result['extraction']['limitations'].append(f'Local parser process: {memory}; bounded result file. Native parser failure does not run in the Notebook server process.')
        response = dict(ok=True, result=result)
    except MemoryError:
        response = dict(ok=False, detail='Local extraction exceeded its memory budget. Choose a smaller file or export the needed page separately.')
    except (ValueError, ImportError, OSError) as error:
        response = dict(ok=False, detail=str(error)[:1000], unavailable=isinstance(error, (ParserUnavailable, ImportError)))
    raw = json.dumps(response, ensure_ascii=False, allow_nan=False).encode('utf-8')
    if len(raw) > MAX_OUTPUT_BYTES:
        raw = json.dumps(dict(ok=False, detail='Extracted source exceeds the 2 MiB parser result budget. Choose a smaller file.')).encode()
    output_path.write_bytes(raw)


if __name__ == '__main__':
    main()
