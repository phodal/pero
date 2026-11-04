"""Opt-in native Mac acceptance probe. No installation or network downloads.

Run with the Host-managed optional interpreter and already approved model assets:
  /path/to/venv/bin/python test/manual/docling_macos.py /path/to/models /path/to/output
Then use docling_corpus.py --engines docling for the three original scans.
This synthetic OCR smoke is runtime evidence, not scientific acceptance.
"""
import argparse
import io
import json
import math
from pathlib import Path
import platform
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from paper_agent.docling_profile import DoclingProfile
from paper_agent.docling_layout import DoclingLayoutConfig, docling_layout_status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('models', type=Path)
    parser.add_argument('output_directory', type=Path)
    args = parser.parse_args()
    profile = DoclingProfile.select(sys.platform, platform.machine(), sys.version_info,
                                   platform.python_implementation(), platform.mac_ver()[0],
                                   getattr(sys, 'abiflags', ''))
    if profile.id != 'macos-arm64-cp312':
        parser.error('This probe requires a real native Apple Silicon macOS 14+ runtime')
    args.output_directory.mkdir(parents=True, exist_ok=True)
    receipt = dict(profile=profile.id, scientificAcceptance='not_assessed',
                   syntheticInput='PERO 124', status='failed')
    try:
        status = docling_layout_status(DoclingLayoutConfig(args.models, profile=profile.id))
        receipt['preflight'] = status
        if not status['available']:
            raise RuntimeError('; '.join(status['reasons']))
        from PIL import Image, ImageDraw, ImageFont
        import Vision
        import objc
        from ocrmac import ocrmac
        source = Image.new('RGB', (700, 150), 'white')
        ImageDraw.Draw(source).text((24, 35), receipt['syntheticInput'],
                                   font=ImageFont.load_default(size=64), fill='black')
        source.save(args.output_directory / 'synthetic-ocr.png')
        buffer = io.BytesIO()
        source.save(buffer, format='PNG')
        started = time.perf_counter()
        with objc.autorelease_pool():
            request = Vision.VNRecognizeTextRequest.alloc().init()
            request.setRecognitionLevel_(0)
            request.setRecognitionLanguages_(['en-US'])
            handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(buffer.getvalue(), None)
            outcome = handler.performRequests_error_([request], None)
            ok, error = outcome if isinstance(outcome, tuple) else (bool(outcome), None)
            receipt['visionPerform'] = dict(ok=bool(ok), error=None if error is None else str(error),
                                           requestRevision=int(request.revision()))
            if not ok or error is not None:
                raise RuntimeError('Apple Vision performRequests failed')
            texts = [str(candidate.string()) for observation in (request.results() or [])
                     for candidate in observation.topCandidates_(1)]
        receipt['nativeTexts'] = texts
        # Also exercise the actual wrapper Docling uses, rather than assuming
        # successful native calls prove this version's wrapper works.
        receipt['ocrmacObservations'] = ocrmac.OCR(source, framework='vision',
            recognition_level='accurate', language_preference=['en-US']).recognize()
        receipt['elapsedSeconds'] = time.perf_counter() - started
        wrapper_text = []
        for text, confidence, box in receipt['ocrmacObservations']:
            if (len(box) != 4 or not all(math.isfinite(value) for value in box)
                    or not 0 <= confidence <= 1):
                raise RuntimeError('ocrmac returned invalid recognition geometry or score')
            x, y, width, height = box
            if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
                raise RuntimeError('ocrmac returned a box outside the synthetic image')
            wrapper_text.append(text)
        if 'PERO 124' not in ' '.join(texts) or 'PERO 124' not in ' '.join(wrapper_text):
            raise RuntimeError('Native/wrapper OCR did not recognize the known synthetic input')
        receipt['status'] = 'passed'
    except Exception as error:
        receipt['error'] = f'{type(error).__name__}: {error}'
    path = args.output_directory / 'macos-native-ocr.json'
    path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
    print(json.dumps(dict(status=receipt['status'], receipt=str(path))))
    return 0 if receipt['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
