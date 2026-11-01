"""Bounded original-byte measurement ingestion; provenance is not a prediction."""
import base64
import csv
import hashlib
import io
import json
import math
from evaluation import parse_measurements

MAX_BYTES = 65536

def import_measurements(data):
    if not isinstance(data, dict) or set(data) != {'trialId', 'filename', 'content_base64', 'source'}:
        raise ValueError('Import requires trialId, filename, content_base64 and source')
    filename, source = data['filename'], data['source']
    if not isinstance(filename,str) or not 1 <= len(filename) <= 120 or not filename.endswith(('.csv','.json')):
        raise ValueError('Choose a CSV or JSON file (filename maximum 120 characters)')
    if not isinstance(source,str) or not 1 <= len(source.strip()) <= 500:
        raise ValueError('Describe the measurement source (1–500 characters)')
    encoded = data['content_base64']
    if not isinstance(encoded,str) or len(encoded)>MAX_BYTES*2:
        raise ValueError('Measurement file exceeds 64 KiB')
    raw = base64.b64decode(encoded, validate=True)
    if not 0<len(raw)<=MAX_BYTES: raise ValueError('Measurement file must be 1–65536 bytes')
    text = raw.decode('utf-8-sig')
    if filename.endswith('.csv'):
        reader = csv.DictReader(io.StringIO(text))
        if reader.fieldnames != ['well','value','unit']: raise ValueError('CSV columns must be well,value,unit')
        rows = list(reader)
    else:
        rows = json.loads(text, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON number')))
    if not isinstance(rows,list) or not 1<=len(rows)<=96: raise ValueError('Supply 1–96 measurement rows')
    if filename.endswith('.csv'):
        for row in rows:
            if set(row)!={'well','value','unit'}: raise ValueError('Each measurement requires well,value,unit')
            row['value']=float(row['value'])
    measurements=[measurement.to_dict() for measurement in parse_measurements(rows)]
    return raw, {'origin':'imported','source':source,'filename':filename,'sha256':hashlib.sha256(raw).hexdigest(),'measurements':measurements}
