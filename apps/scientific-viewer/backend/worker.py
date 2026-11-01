"""One fixed computation process; receives JSON data, never executable code."""
import json
import sys
from molecules import MAX_OUTPUT, MAX_REQUEST, MoleculeRequest, preview


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
        if len(raw) > MAX_REQUEST:
            raise ValueError('Request exceeds 1 MiB')
        result = preview(MoleculeRequest.parse(json.loads(raw)))
        body = json.dumps(result, allow_nan=False).encode('utf-8')
        if len(body) > MAX_OUTPUT:
            raise ValueError('Preview exceeds 4 MiB; select fewer molecules')
        sys.stdout.buffer.write(body)
    except (ValueError, TypeError, UnicodeError) as error:
        sys.stdout.write(json.dumps({'error': str(error)}))
        sys.exit(2)


if __name__ == '__main__':
    main()
