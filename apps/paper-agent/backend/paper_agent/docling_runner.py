"""File-based entry point for the separately provisioned Docling interpreter.

Invoked only by the trusted local shell, never with paths from HTTP requests.
Results (including the raw export) go to the response file, not stdout.
"""
import argparse
import json
from pathlib import Path

from .model import Invalid
from .pdf import PdfDocument


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('request_json', type=Path)
    parser.add_argument('output_json', type=Path)
    args = parser.parse_args(argv)
    try:
        request = json.loads(args.request_json.read_text(encoding='utf-8'))
        if not isinstance(request, dict):
            raise Invalid('Docling runner request must be an object', 422)
        operation = request.get('operation')
        if operation not in ('status', 'convert'):
            raise Invalid('Docling runner operation must be status or convert', 422)
        artifacts = request.get('artifactsPath')
        if not isinstance(artifacts, str) or not Path(artifacts).is_absolute():
            raise Invalid('Docling runner requires an absolute artifactsPath', 422)
        # Import after reading the internal request. No Python executable is
        # supplied to this config: this process is already the isolated runner.
        from .docling_layout import (
            DoclingLayoutConfig, convert_docling_pdf, docling_layout_status,
        )
        profile = request.get('profile')
        if profile not in (None, 'linux-x86_64-cp312', 'macos-arm64-cp312'):
            raise Invalid('Unknown isolated Docling runtime profile', 422)
        config = DoclingLayoutConfig(Path(artifacts), profile=profile)
        if operation == 'status':
            result = docling_layout_status(config)
        else:
            pdf_path = request.get('pdfPath')
            if not isinstance(pdf_path, str) or not Path(pdf_path).is_absolute():
                raise Invalid('Docling runner requires an absolute pdfPath', 422)
            if type(request.get('page')) is not int or request['page'] < 1:
                raise Invalid('Docling runner requires a positive page number', 422)
            if not isinstance(request.get('document'), dict):
                raise Invalid('Docling runner requires a saved PDF document record', 422)
            document = PdfDocument.from_record(request['document'])
            result = convert_docling_pdf(Path(pdf_path).read_bytes(), document,
                                         request['page'], config)
        response = dict(ok=True, result=result)
    except Invalid as error:
        response = dict(ok=False, detail=error.detail, status=error.status)
    except (OSError, ValueError) as error:
        response = dict(ok=False, detail=f'Docling runner failed: {error}', status=422)
    args.output_json.write_text(json.dumps(response, ensure_ascii=False, allow_nan=False),
                               encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
