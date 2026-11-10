"""Versioned conversation receipt for one Scientific Viewer molecule preview.

The drawing and descriptors come from the existing preview. This module does not
implement a second chemistry engine. A saved row is shown only for its own record.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from molecules import MoleculeRequest, preview

KIND = 'pero.molecule-conversation.v1'
MAX_INLINE = 4
UNITS = {
    'MolWt': 'g/mol', 'ExactMolWt': 'Da', 'MolLogP': '1', 'TPSA': 'Å²',
    'NumHDonors': 'count', 'NumHAcceptors': 'count', 'NumRotatableBonds': 'count',
}
SCOPE = ('Each row is bound to its original record. The drawing is computed 2D geometry, not a measured conformation. '
         'Descriptors are calculated by RDKit. They are not experimental measurements, bioactivity, or a reason to fill a failed row with zero.')


def project(value):
    request = MoleculeRequest.parse(value)
    if len(request.records) > MAX_INLINE:
        raise ValueError(f'An inline molecule receipt shows 1–{MAX_INLINE} records; open Scientific Viewer for a larger set')
    try:
        result = preview(request)
    except ImportError as error:
        return _unavailable(request, str(error))
    return project_preview(request, result)


def project_preview(request, result):
    if not isinstance(result, dict) or set(result) != {'engine', 'rows'}:
        raise ValueError('Molecule preview must contain engine and rows')
    engine = result['engine']
    if not isinstance(engine, dict) or engine.get('name') != 'RDKit' or not isinstance(engine.get('version'), str) or not engine['version']:
        raise ValueError('Molecule preview engine must be RDKit')
    rows_in = result['rows']
    if not isinstance(rows_in, list) or len(rows_in) != len(request.records):
        raise ValueError('Molecule preview rows must match the request')
    rows = [_row(record, item) for record, item in zip(request.records, rows_in)]
    status = 'depicted' if all(row['status'] == 'depicted' for row in rows) else 'partial' if any(row['status'] == 'depicted' for row in rows) else 'failed'
    identity = {'format': request.format, 'records': list(request.records), 'engine': {'name': 'RDKit', 'version': engine['version']},
                'rows': [{'input': row['input'], 'status': row['status'], 'svgSha256': row.get('svgSha256'), 'descriptors': row.get('descriptors', {})} for row in rows]}
    version = hashlib.sha256(_canonical(identity)).hexdigest()
    depicted = sum(row['status'] == 'depicted' for row in rows)
    return {
        'kind': KIND, 'version': version, 'citation': f'scientific-viewer:{version}', 'status': status,
        'inheritedCheck': False, 'format': request.format, 'engine': {'name': 'RDKit', 'version': engine['version']},
        'method': f"RDKit {engine['version']} structure parsing, 2D depiction, and the existing descriptor set.",
        'scope': SCOPE,
        'explanation': f"{depicted} of {len(rows)} records depicted with RDKit {engine['version']}. Citation scientific-viewer:{version}. {SCOPE}",
        'rows': rows,
    }


def _unavailable(request, detail):
    identity = {'format': request.format, 'records': list(request.records), 'engine': None, 'rows': []}
    version = hashlib.sha256(_canonical(identity)).hexdigest()
    return {
        'kind': KIND, 'version': version, 'citation': f'scientific-viewer:{version}', 'status': 'unavailable',
        'inheritedCheck': False, 'format': request.format, 'engine': None,
        'method': 'RDKit was not imported. No structure or descriptor was calculated.',
        'scope': SCOPE, 'explanation': f"RDKit is unavailable ({detail[:240]}). No drawing or descriptor was invented. Citation scientific-viewer:{version}.",
        'rows': [{'input': record, 'status': 'unavailable', 'error': 'RDKit is unavailable'} for record in request.records],
    }


def _row(record, item):
    if not isinstance(item, dict) or item.get('input') != record:
        raise ValueError('A molecule row must echo its original record')
    if 'error' in item:
        if set(item) - {'input', 'error'} or not isinstance(item['error'], str) or not item['error']:
            raise ValueError('An invalid molecule row contains only its input and error')
        return {'input': record, 'status': 'invalid', 'error': item['error'][:300]}
    svg = item.get('svg')
    descriptors = item.get('descriptors')
    if not isinstance(svg, str) or not _svg(svg) or not isinstance(descriptors, dict):
        raise ValueError('A depicted molecule needs its SVG and descriptors')
    values = {}
    for name, value in descriptors.items():
        if not isinstance(name, str) or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError('Descriptor values must be finite numbers')
        values[name] = {'value': value, 'unit': UNITS.get(name, '')}
    return {'input': record, 'status': 'depicted', 'svg': svg, 'svgSha256': hashlib.sha256(svg.encode()).hexdigest(), 'descriptors': values}


def _svg(value):
    lowered = value.lower()
    return '<svg' in lowered and '<script' not in lowered and 'javascript:' not in lowered and '<foreignobject' not in lowered and len(value.encode()) <= 256 * 1024


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


if __name__ == '__main__':
    import sys
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError('Request exceeds 1 MiB')
        body = json.dumps(project(json.loads(raw)), allow_nan=False).encode()
        if len(body) > 2 * 1024 * 1024:
            raise ValueError('Inline molecule receipt exceeds 2 MiB')
        sys.stdout.buffer.write(body)
    except (ValueError, TypeError, UnicodeError, json.JSONDecodeError) as error:
        sys.stdout.write(json.dumps({'error': str(error)}))
        sys.exit(2)
