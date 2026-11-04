"""Optional Docling layout candidates, never numeric evidence or PDFium offsets.

The pure import boundary consumes Docling's JSON export. A caller must hash the
actual converted PDF and supply independently read, explicit page rotations.
No Docling dependency is required to inspect an already exported document.
"""
from dataclasses import dataclass
import math
import struct

from .model import ID, Invalid, mapping, sequence
from .pdf import PdfAnchor, PdfDocument, PdfRect


@dataclass(frozen=True)
class DoclingPage:
    number: int
    width: float
    height: float
    rotation: int | None
    source_width: float | None
    source_height: float | None
    dimension_match: str

    def to_dict(self):
        return dict(number=self.number, width=self.width, height=self.height,
                    rotation=self.rotation, sourceWidth=self.source_width,
                    sourceHeight=self.source_height, dimensionMatch=self.dimension_match)


@dataclass(frozen=True)
class DoclingBox:
    l: float
    t: float
    r: float
    b: float
    coord_origin: str

    def to_dict(self):
        return dict(l=self.l, t=self.t, r=self.r, b=self.b,
                    coord_origin=self.coord_origin)


@dataclass(frozen=True)
class DoclingProvenance:
    page: int
    box: DoclingBox
    rotation: int | None
    charspan: tuple[int, int] | None
    anchor: PdfAnchor | None
    unresolved_reason: str

    def to_dict(self):
        return dict(page=self.page, bbox=self.box.to_dict(), rotation=self.rotation,
                    doclingCharspan=list(self.charspan) if self.charspan is not None else None,
                    charspanSpace='docling-item-text-not-pdfium',
                    anchor=self.anchor.to_dict() if self.anchor else None,
                    unresolvedReason=self.unresolved_reason)


@dataclass(frozen=True)
class DoclingText:
    ref: str
    label: str
    text: str
    original_text: str | None
    parent_ref: str | None
    provenance: tuple[DoclingProvenance, ...]

    def to_dict(self):
        return dict(ref=self.ref, label=self.label, text=self.text,
                    originalText=self.original_text, parentRef=self.parent_ref,
                    provenance=[p.to_dict() for p in self.provenance])


@dataclass(frozen=True)
class DoclingTextRelationship:
    """Only an explicit Docling reference establishes a relationship."""
    role: str
    target_ref: str
    text: DoclingText | None

    def to_dict(self):
        return dict(role=self.role, targetRef=self.target_ref,
                    status='resolved-text' if self.text else 'unresolved-text-reference')


@dataclass(frozen=True)
class DoclingPicture:
    ref: str
    label: str
    provenance: tuple[DoclingProvenance, ...]
    relationships: tuple[DoclingTextRelationship, ...]

    def to_dict(self):
        return dict(ref=self.ref, label=self.label,
                    provenance=[p.to_dict() for p in self.provenance],
                    relationships=[r.to_dict() for r in self.relationships],
                    layoutStatus='anchored' if self.provenance and all(p.anchor for p in self.provenance) else 'unresolved')


@dataclass(frozen=True)
class ImportedDoclingLayout:
    document_id: str
    source_pdf_sha256: str
    export_version: str
    pages: tuple[DoclingPage, ...]
    texts: tuple[DoclingText, ...]
    pictures: tuple[DoclingPicture, ...]

    def to_dict(self):
        return dict(schema='pero.docling-layout.v1', documentId=self.document_id,
                    sourcePdfSha256=self.source_pdf_sha256, exportVersion=self.export_version,
                    textKind='docling-extracted-text', provenanceKind='derived_docling',
                    scientificAcceptance='unverified',
                    pages=[p.to_dict() for p in self.pages],
                    texts=[t.to_dict() for t in self.texts],
                    pictures=[p.to_dict() for p in self.pictures])


def _string(value, name):
    if not isinstance(value, str):
        raise Invalid(f'Invalid Docling {name}')
    return value


def _number(value, name):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise Invalid(f'Invalid Docling {name}')
    return float(value)


def _reference(value):
    ref = _string(mapping(value, 'Docling reference').get('$ref'), 'reference')
    if not ref.startswith('#/'):
        raise Invalid('Invalid Docling reference')
    return ref


def _provenance(values, pages, document, rotations):
    result = []
    for value in sequence(values, 100_000, 'Docling provenance'):
        value = mapping(value, 'Docling provenance')
        page = value.get('page_no')
        if type(page) is not int or page < 1:
            raise Invalid('Invalid Docling provenance page')
        raw = mapping(value.get('bbox'), 'Docling box')
        box = DoclingBox(*(_number(raw.get(k), 'box coordinate') for k in ('l', 't', 'r', 'b')),
                         _string(raw.get('coord_origin'), 'coordinate origin'))
        span = value.get('charspan')
        if span is not None:
            if (not isinstance(span, (list, tuple)) or len(span) != 2
                    or any(type(n) is not int for n in span) or not 0 <= span[0] <= span[1]):
                raise Invalid('Invalid Docling character span')
            span = tuple(span)
        rotation = rotations.get(page)
        exported = pages.get(page)
        original = next((p for p in document.pages if p.number == page), None)
        reason, anchor = '', None
        if exported is None or original is None:
            reason = 'page-unavailable'
        elif rotation is None:
            reason = 'rotation-unknown'
        elif rotation != 0:
            reason = 'rotation-unsupported'
        elif exported.dimension_match not in ('exact', 'float32-equivalent'):
            reason = 'page-size-mismatch'
        elif box.coord_origin not in ('TOPLEFT', 'BOTTOMLEFT'):
            reason = 'coordinate-origin-unsupported'
        else:
            w, h = exported.width, exported.height
            top = box.t if box.coord_origin == 'TOPLEFT' else h - box.t
            bottom = box.b if box.coord_origin == 'TOPLEFT' else h - box.b
            if not (0 <= box.l < box.r <= w and 0 <= top < bottom <= h):
                reason = 'box-outside-page-or-degenerate'
            else:
                anchor = PdfAnchor(document.id, document.file_digest, page,
                                   (PdfRect(box.l / w, top / h, (box.r - box.l) / w, (bottom - top) / h),))
        result.append(DoclingProvenance(page, box, rotation, span, anchor, reason))
    return tuple(result)


def import_docling_layout(export: dict, document: PdfDocument,
                          source_pdf_sha256: str,
                          page_rotations: dict[int, int]) -> ImportedDoclingLayout:
    """Validate an export once and bind only unambiguous regions to the original.

    `source_pdf_sha256` is the hash of the bytes actually passed to Docling,
    not Docling's origin.binary_hash (which need not be a SHA-256 digest).
    PDFium page dimensions are IEEE float32 (FPDF_GetPageWidthF/HeightF).
    Decimal exports may match that same float32 value without exact float64
    equality. This is quantization equality, not a geometric tolerance.
    Missing/rotated/mismatched geometry is retained without inventing anchors.
    """
    if (not isinstance(source_pdf_sha256, str) or not ID.fullmatch(source_pdf_sha256)
            or source_pdf_sha256 != document.file_digest):
        raise Invalid('Docling source PDF digest does not match the saved original', 409)
    export = mapping(export, 'Docling export')
    if export.get('schema_name') != 'DoclingDocument':
        raise Invalid('Expected a DoclingDocument export')
    rotations = mapping(page_rotations, 'PDF page rotations')
    if any(type(page) is not int or page < 1 or type(rotation) is not int
           or rotation not in (0, 90, 180, 270) for page, rotation in rotations.items()):
        raise Invalid('Invalid PDF page rotation')
    version = _string(export.get('version', ''), 'export version')
    pages = {}
    for key, value in mapping(export.get('pages', {}), 'Docling pages').items():
        value = mapping(value, 'Docling page')
        number = value.get('page_no')
        if type(number) is not int or number < 1 or str(key) != str(number) or number in pages:
            raise Invalid('Invalid or duplicate Docling page number')
        size = mapping(value.get('size'), 'Docling page size')
        width, height = (_number(size.get(k), 'page size') for k in ('width', 'height'))
        if width <= 0 or height <= 0:
            raise Invalid('Invalid Docling page size')
        original = next((p for p in document.pages if p.number == number), None)
        dimension_match = 'page-size-mismatch'
        if original is not None:
            if (width, height) == (original.width, original.height):
                dimension_match = 'exact'
            else:
                try:
                    quantized = tuple(struct.unpack('f', struct.pack('f', n))[0] for n in (width, height))
                except OverflowError:
                    quantized = ()
                if quantized == (original.width, original.height):
                    dimension_match = 'float32-equivalent'
        pages[number] = DoclingPage(number, width, height, rotations.get(number),
                                   original.width if original else None,
                                   original.height if original else None, dimension_match)
    texts = []
    for index, value in enumerate(sequence(export.get('texts', []), 100_000, 'Docling texts')):
        value = mapping(value, 'Docling text')
        ref = _string(value.get('self_ref'), 'text self reference')
        if ref != f'#/texts/{index}':
            raise Invalid('Ambiguous Docling text reference')
        original = value.get('orig')
        if original is not None:
            original = _string(original, 'original text')
        texts.append(DoclingText(ref, _string(value.get('label'), 'text label'),
                                _string(value.get('text'), 'text'), original,
                                _reference(value['parent']) if value.get('parent') is not None else None,
                                _provenance(value.get('prov', []), pages, document, rotations)))
    by_ref = {t.ref: t for t in texts}
    pictures = []
    for index, value in enumerate(sequence(export.get('pictures', []), 100_000, 'Docling pictures')):
        value = mapping(value, 'Docling picture')
        ref = _string(value.get('self_ref'), 'picture self reference')
        if ref != f'#/pictures/{index}':
            raise Invalid('Ambiguous Docling picture reference')
        relationships = []
        for key, role in (('captions', 'caption'), ('children', 'child')):
            for target in sequence(value.get(key, []), 100_000, 'Docling picture references'):
                target_ref = _reference(target)
                relationships.append(DoclingTextRelationship(role, target_ref, by_ref.get(target_ref)))
        pictures.append(DoclingPicture(ref, _string(value.get('label'), 'picture label'),
                                       _provenance(value.get('prov', []), pages, document, rotations),
                                       tuple(relationships)))
    return ImportedDoclingLayout(document.id, source_pdf_sha256, version,
                                 tuple(pages.values()), tuple(texts), tuple(pictures))

# Optional imperative shell. No Docling/ML import occurs at module import time.
from contextlib import closing
import importlib.metadata
import io
import json
import os
import platform
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from .model import digest
from .pdf_files import PDFIUM_LOCK, PdfFiles
from .docling_profile import DoclingProfile

DOCLING_VERSION = '2.146.0'
MODEL_REPOSITORY = 'docling-project/docling-layout-heron'
MODEL_REVISION = '8f39ad3c0b4c58e9c2d2c84a38465abf757272d8'
MODEL_FILES = {
    'config.json': 'fdea30805ce2f5666b147fca941dcdd27ad468e27d6ed21902207d3da056a97d',
    'preprocessor_config.json': 'cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1',
    'model.safetensors': '00333a43451945aaf89db8ca9c0a17e75d1537c17db60fdb91aa95f4c7929e0c',
}
# This is the tested CPU profile, not a claim that other versions cannot work.
DOCLING_DEPENDENCIES = {
    'docling-slim': DOCLING_VERSION, 'docling-core': '2.105.0',
    'docling-ibm-models': '4.0.4', 'docling-parse': '7.24.2',
    'torch': '2.10.0+cpu', 'torchvision': '0.25.0+cpu',
    'transformers': '5.22.1', 'pypdfium2': '5.14.0',
}


@dataclass(frozen=True)
class DoclingLayoutConfig:
    """Trusted local configuration, never constructed from HTTP request paths."""
    artifacts_path: Path | None
    python_path: Path | None = None
    enabled: bool = True
    profile: str | None = None


def configured_docling_layout(store_root=None):
    if store_root is not None:
        path = Path(store_root) / 'docling-runtime.json'
        if path.is_file():
            try:
                value = json.loads(path.read_text())
                if isinstance(value, dict) and value.get('disabled') is True:
                    return DoclingLayoutConfig(None, enabled=False)
                python, artifacts = Path(value['python']), Path(value['artifactsPath'])
                if not python.is_absolute() or not artifacts.is_absolute():
                    raise ValueError('runtime paths must be absolute')
                profile = value.get('profile')
                if profile not in (None, 'linux-x86_64-cp312', 'macos-arm64-cp312'):
                    raise ValueError('unknown runtime profile')
                return DoclingLayoutConfig(artifacts, python, profile=profile)
            except (OSError, ValueError, TypeError, KeyError) as error:
                raise Invalid(f'Invalid trusted local Docling runtime configuration: {error}', 503) from error
    path = os.environ.get('PERO_DOCLING_ARTIFACTS_PATH', '')
    return DoclingLayoutConfig(Path(path)) if path else None


def docling_layout_status(config=None):
    """Read-only preflight; never imports Docling or provisions dependencies/models."""
    config = config or configured_docling_layout()
    if config and not config.enabled:
        return dict(available=False, reasons=['Disabled by Host; approve optional setup to enable again'],
                    provider='docling', version=DOCLING_VERSION, downloadPolicy='never', disabled=True)
    if config and config.python_path:
        try:
            return _isolated_docling_call(config, 'status')
        except Invalid as error:
            return dict(available=False, reasons=[error.detail], provider='docling',
                        version=DOCLING_VERSION, downloadPolicy='never', runtime='isolated-subprocess')
    reasons, installed = [], {}
    try:
        profile = DoclingProfile.select(sys.platform, platform.machine(), sys.version_info,
                                        platform.python_implementation(), platform.mac_ver()[0],
                                        getattr(sys, 'abiflags', ''))
        if config and config.profile and config.profile != profile.id:
            raise Invalid('Configured Docling profile does not match the running interpreter', 503)
    except Invalid as error:
        return dict(available=False, reasons=[error.detail], provider='docling',
                    version=DOCLING_VERSION, downloadPolicy='never')
    dependencies = {**DOCLING_DEPENDENCIES, 'torch': profile.torch_version,
                    'torchvision': profile.torchvision_version}
    if profile.ocr_engine == 'apple-vision':
        dependencies['ocrmac'] = '1.0.1'
        dependencies.update({package: '13.0' for package in (
            'pyobjc-core', 'pyobjc-framework-Cocoa', 'pyobjc-framework-Quartz',
            'pyobjc-framework-CoreML', 'pyobjc-framework-Vision')})
    for package, expected in dependencies.items():
        try:
            installed[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            installed[package] = None
        if installed[package] != expected:
            reasons.append(f'{package}: requires {expected}; found {installed[package] or "not installed"}')
    if config is None:
        reasons.append('Set trusted local PERO_DOCLING_ARTIFACTS_PATH to provisioned model assets')
    elif not reasons:
        folder = Path(config.artifacts_path) / MODEL_REPOSITORY.replace('/', '--')
        for filename, expected in MODEL_FILES.items():
            path = folder / filename
            try:
                if not path.is_file():
                    reasons.append(f'Missing offline model asset: {filename}')
                elif digest(path.read_bytes()) != expected:
                    reasons.append(f'Offline model asset SHA-256 mismatch: {filename}')
            except OSError as error:
                reasons.append(f'Cannot read offline model asset {filename}: {type(error).__name__}')
    ocr = dict(engine=profile.ocr_engine, version=None,
               languages=['en-US'] if profile.ocr_engine == 'apple-vision' else ['eng'],
               mode='full_page', scale=3.0)
    executable = shutil.which('tesseract') if profile.ocr_engine == 'tesseract-cli' else None
    if profile.ocr_engine == 'apple-vision':
        ocr.update(version=installed.get('ocrmac'), framework='vision', recognition='accurate',
                   macosVersion=platform.mac_ver()[0], darwinVersion=platform.release(),
                   modelVersion='managed-by-macos', supportedLanguages=None,
                   macosBuild=None, visionRequestRevision=None)
        if not reasons:
            try:
                # Vision is native to this OS. This does not load Torch, perform
                # OCR, install a system package, or download an OCR model.
                import Vision
                request = Vision.VNRecognizeTextRequest.alloc().init()
                request.setRecognitionLevel_(0)
                ocr['visionRequestRevision'] = int(request.revision())
                build = subprocess.run(['/usr/sbin/sysctl', '-n', 'kern.osversion'],
                                       capture_output=True, text=True, timeout=5, check=True)
                ocr['macosBuild'] = build.stdout.strip()
                languages, error = request.supportedRecognitionLanguagesAndReturnError_(None)
                ocr['supportedLanguages'] = [str(language) for language in (languages or [])]
                if error is not None or 'en-US' not in ocr['supportedLanguages']:
                    reasons.append('Apple Vision English recognition is unavailable on this macOS')
            except Exception as error:  # PyObjC can surface native Objective-C exceptions.
                reasons.append(f'Apple Vision preflight failed: {type(error).__name__}')
    elif executable is None:
        reasons.append('Tesseract CLI is not installed')
    else:
        try:
            version = subprocess.run([executable, '--version'], capture_output=True, text=True,
                                     timeout=10, check=True)
            languages = subprocess.run([executable, '--list-langs'], capture_output=True,
                                       text=True, timeout=10, check=True)
            ocr['version'] = version.stdout.splitlines()[0]
            ocr['binarySha256'] = digest(Path(executable).read_bytes())
            data_path = re.search(r'in "([^"]+)"', languages.stdout + languages.stderr)
            traineddata = Path(data_path.group(1)) / 'eng.traineddata' if data_path else None
            ocr['languageDataSha256'] = (digest(traineddata.read_bytes())
                                            if traineddata and traineddata.is_file() else None)
            if 'eng' not in languages.stdout.splitlines():
                reasons.append('Tesseract English language data is missing')
        except (OSError, subprocess.SubprocessError, IndexError) as error:
            reasons.append(f'Tesseract CLI preflight failed: {type(error).__name__}')
    return dict(available=not reasons, reasons=reasons, provider='docling', version=DOCLING_VERSION,
                installed=installed, profile=profile.id, modelRepository=MODEL_REPOSITORY, modelRevision=MODEL_REVISION,
                modelSha256=dict(MODEL_FILES), downloadPolicy='never', ocr=ocr,
                limits=dict(pagesPerCall=1, cpuThreads=2, documentTimeoutSeconds=120,
                            timeoutKind='cooperative', hardMemoryLimit=False,
                            renderScale=3.0, maxRenderDimension=6000, maxRenderPixels=12_000_000),
                features=dict(layout=True, tableCellStructure=False, pictureEnrichment=False),
                backend=dict(name='ThreadedDoclingParseDocumentBackend', version='7.24.2'),
                setup=dict(requiresSeparateUserApproval=True, installerSupported=False,
                    software=dict(source='https://pypi.org/project/docling-slim/2.146.0/',
                                  observedDiskGiB=1.5 if profile.ocr_engine == 'tesseract-cli' else None,
                                  license='MIT', profile=profile.label),
                    model=dict(source=f'https://huggingface.co/{MODEL_REPOSITORY}/tree/{MODEL_REVISION}',
                               bytes=171662708, license='Apache-2.0'),
                    instructions='Manually provision the isolated profile and pinned assets; this endpoint never installs or downloads.'))


def convert_docling_pdf(data, document, page, config):
    """Convert one original page explicitly, offline, into unverified derived layout.

    Native PDFium text remains separate. The pinned model assets are complete:
    local config disables pretrained/timm backbone loading. Docling's explicit
    artifacts_path resolver raises on absent assets; it never falls back to Hub.
    """
    if digest(data) != document.file_digest:
        raise Invalid('Docling source PDF SHA-256 does not match saved original', 409)
    original = document.page(page)
    if (not math.isfinite(original.width) or not math.isfinite(original.height)
            or original.width <= 0 or original.height <= 0):
        raise Invalid('Docling requires finite positive PDF page dimensions', 422)
    pixel_width, pixel_height = math.ceil(original.width * 3), math.ceil(original.height * 3)
    if max(pixel_width, pixel_height) > 6000 or pixel_width * pixel_height > 12_000_000:
        raise Invalid('Docling selected page exceeds 6000-edge / 12-megapixel OCR render budget', 413)
    config = config or configured_docling_layout()
    if config and config.python_path:
        return _isolated_docling_call(config, 'convert', data, document, page)
    status = docling_layout_status(config)
    if not status['available']:
        raise Invalid('Docling unavailable: ' + '; '.join(status['reasons']), 503)
    config = config or configured_docling_layout()
    try:
        return _convert_docling_page(data, document, page, config, original, status)
    except Invalid:
        raise
    except ImportError as error:
        raise Invalid(f'Docling dependency import failed: {error}', 503) from error
    except (RuntimeError, OSError, ValueError) as error:
        raise Invalid(f'Docling selected-page conversion failed: {error}', 422) from error


def _convert_docling_page(data, document, page, config, original, status):
    # Also disable HF network fallback before any optional library is imported.
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    os.environ['OMP_NUM_THREADS'] = '2'
    from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
    from docling.datamodel.base_models import DocumentStream, InputFormat
    from docling.datamodel.pipeline_options import (
        LayoutObjectDetectionOptions, OcrMacOptions, OcrMode, PdfPipelineOptions, TesseractCliOcrOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pdfium = PdfFiles._engine()
    with PDFIUM_LOCK, closing(pdfium.PdfDocument(data)) as pdf, closing(pdf[page - 1]) as source_page:
        rotation = source_page.get_rotation()
    ocr_options = (OcrMacOptions(lang=['en-US'], framework='vision', recognition='accurate',
                                mode=OcrMode.FULL_PAGE, scale=3.0)
                   if status['ocr']['engine'] == 'apple-vision'
                   else TesseractCliOcrOptions(lang=['eng'], mode=OcrMode.FULL_PAGE, scale=3.0))
    options = PdfPipelineOptions(
        artifacts_path=Path(config.artifacts_path), do_ocr=True, do_table_structure=False,
        ocr_options=ocr_options,
        accelerator_options=AcceleratorOptions(device=AcceleratorDevice.CPU, num_threads=2),
        document_timeout=120, enable_remote_services=False, allow_external_plugins=False,
        do_picture_classification=False, do_picture_description=False, do_chart_extraction=False,
        do_code_enrichment=False, do_formula_enrichment=False,
    )
    options.layout_options = LayoutObjectDetectionOptions.from_preset('layout_heron_default')
    options.layout_options.model_spec.revision = MODEL_REVISION
    start = time.perf_counter()
    converter = DocumentConverter(allowed_formats=[InputFormat.PDF], format_options={
        InputFormat.PDF: PdfFormatOption(pipeline_options=options),
    })
    result = converter.convert(DocumentStream(name='source.pdf', stream=io.BytesIO(data)),
                               page_range=(page, page))
    if result.status.value != 'success':
        raise Invalid('Docling did not complete the selected page: ' + result.status.value, 422)
    exported = result.document.export_to_dict()
    layout = import_docling_layout(exported, document, document.file_digest, {page: rotation}).to_dict()
    layout['textKind'] = 'full_page_ocr_docling'
    ocr = {**status['ocr'], 'resultStatus': 'text_observed' if any(
        item.get('text', '').strip() for item in exported.get('texts', [])) else 'no_text_observed'}
    if ocr['engine'] == 'apple-vision':
        # ocrmac may return no annotations for a Vision error. Neither an empty
        # export nor nonempty partial output proves complete OCR success.
        ocr['completeRecognitionVerified'] = False
        ocr['errorVisibility'] = 'ocrmac-may-return-empty-on-native-error'
    return dict(provider='docling', version=DOCLING_VERSION, sourceSha256=document.file_digest,
                pageRange=[page, page], nativePageText=original.text,
                nativeTextProvenance='pdfium_saved_original', ocr=ocr,
                modelRepository=MODEL_REPOSITORY, modelRevision=MODEL_REVISION,
                modelSha256=dict(MODEL_FILES), dependencies=status['installed'], profile=status['profile'],
                backend=status['backend'], layout=layout, rawExport=exported,
                elapsedSeconds=time.perf_counter() - start,
                scientificAcceptance='unverified', limits=status['limits'], features=status['features'])


def _isolated_docling_call(config, operation, data=None, document=None, page=None):
    """Internal local transport; neither paths nor operations come from HTTP input."""
    timeout = 30 if operation == 'status' else 180
    with tempfile.TemporaryDirectory(prefix='pero-docling-') as directory:
        root = Path(directory)
        request = dict(operation=operation, artifactsPath=str(config.artifacts_path), profile=config.profile)
        if operation == 'convert':
            pdf_path = root / 'original.pdf'
            pdf_path.write_bytes(data)
            request.update(pdfPath=str(pdf_path), document=document.to_record(), page=page)
        request_path, output_path = root / 'request.json', root / 'output.json'
        request_path.write_text(json.dumps(request))
        environment = {**os.environ, 'PYTHONPATH': str(Path(__file__).resolve().parents[1]),
                       'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
                       'OMP_NUM_THREADS': '2'}
        try:
            process = subprocess.run([str(config.python_path), '-m', 'paper_agent.docling_runner',
                                      str(request_path), str(output_path)],
                                     shell=False, env=environment, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.PIPE, text=True, timeout=timeout)
            if process.returncode:
                raise Invalid('Isolated Docling runtime failed: ' + process.stderr[-2000:], 503)
            output = json.loads(output_path.read_text())
        except subprocess.TimeoutExpired as error:
            raise Invalid(f'Isolated Docling runtime exceeded {timeout}-second wait deadline', 504) from error
        except (OSError, ValueError) as error:
            if isinstance(error, Invalid):
                raise
            raise Invalid(f'Isolated Docling runtime could not run: {error}', 503) from error
        if not output.get('ok'):
            raise Invalid(output.get('detail', 'Isolated Docling conversion failed'), output.get('status', 422))
        result = output['result']
        result['runtime'] = dict(mode='isolated-subprocess', waitTimeoutSeconds=timeout,
                                 hardMemoryLimit=False, processTreeDeadline=False)
        return result
