"""Synthetic export contract tests, not evidence of real Docling conversion."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
import importlib.metadata
import os
import json
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.docling_layout import (import_docling_layout, docling_layout_status,
    convert_docling_pdf, configured_docling_layout, DoclingLayoutConfig, DOCLING_DEPENDENCIES, MODEL_REPOSITORY)
from paper_agent.model import Invalid, digest
from paper_agent.pdf_files import PdfFiles
from paper_agent.pdf import PdfDocument, PdfPage
from paper_agent.docling_profile import DoclingProfile


SHA = 'a' * 64
DOCUMENT = PdfDocument.create('paper', SHA, 'https://example.org/paper.pdf',
                              (PdfPage(1, 600, 800, 'PDFium text differs'),), '2026-11-04')


def synthetic_export():
    # Deliberately handwritten shape. This cannot establish runtime accuracy.
    return dict(schema_name='DoclingDocument', version='1.10.0', pages={'1': dict(page_no=1, size=dict(width=600, height=800))},
                texts=[dict(self_ref='#/texts/0', label='caption', text='Figure 1: A result.',
                            orig='Figure 1: A result.', parent={'$ref': '#/pictures/0'},
                            prov=[dict(page_no=1, charspan=[0, 19],
                                       bbox=dict(l=60, t=500, r=300, b=520, coord_origin='TOPLEFT'))]),
                       dict(self_ref='#/texts/1', label='text', text='Time (s)', prov=[])],
                pictures=[dict(self_ref='#/pictures/0', label='picture',
                               captions=[{'$ref': '#/texts/0'}],
                               children=[{'$ref': '#/texts/1'}, {'$ref': '#/groups/0'}],
                               prov=[dict(page_no=1, bbox=dict(l=60, t=640, r=300, b=400,
                                                              coord_origin='BOTTOMLEFT'))])])


class DoclingLayoutTest(unittest.TestCase):
    def test_explicit_text_relationships_and_original_pdf_binding(self):
        result = import_docling_layout(synthetic_export(), DOCUMENT, SHA, {1: 0})
        picture = result.pictures[0]
        caption, child, group = picture.relationships
        self.assertEqual((caption.role, caption.text.label, caption.text.text),
                         ('caption', 'caption', 'Figure 1: A result.'))
        self.assertEqual((child.role, child.text.text), ('child', 'Time (s)'))
        self.assertIsNone(group.text)
        self.assertEqual(group.target_ref, '#/groups/0')
        self.assertEqual(caption.text.parent_ref, picture.ref)
        anchor = picture.provenance[0].anchor
        self.assertEqual((anchor.document_id, anchor.file_digest, anchor.page), (DOCUMENT.id, SHA, 1))
        self.assertEqual(anchor.rects[0].to_dict(), dict(x=.1, y=.2, width=.4, height=.3))
        self.assertEqual(result.texts[0].provenance[0].charspan, (0, 19))
        self.assertEqual(result.texts[0].provenance[0].anchor.rects[0].y, .625)
        payload = result.to_dict()
        self.assertEqual(payload['provenanceKind'], 'derived_docling')
        self.assertEqual(payload['pictures'][0]['layoutStatus'], 'anchored')
        self.assertEqual(payload['texts'][0]['provenance'][0]['charspanSpace'],
                         'docling-item-text-not-pdfium')
        self.assertNotIn('numeric_ready', str(payload))

    def test_ambiguous_geometry_retains_provenance_without_anchor(self):
        cases = [
            ('unknown rotation', {}, {}, {}, 'rotation-unknown'),
            ('rotated 90', {1: 90}, {}, {}, 'rotation-unsupported'),
            ('rotated 180', {1: 180}, {}, {}, 'rotation-unsupported'),
            ('rotated 270', {1: 270}, {}, {}, 'rotation-unsupported'),
            ('size mismatch', {1: 0}, {'width': 600.001}, {}, 'page-size-mismatch'),
            ('unknown origin', {1: 0}, {}, {'coord_origin': 'CENTER'}, 'coordinate-origin-unsupported'),
            ('left outside', {1: 0}, {}, {'l': -1}, 'box-outside-page-or-degenerate'),
            ('right outside', {1: 0}, {}, {'r': 601}, 'box-outside-page-or-degenerate'),
            ('top outside', {1: 0}, {}, {'t': 801}, 'box-outside-page-or-degenerate'),
            ('bottom outside', {1: 0}, {}, {'b': -1}, 'box-outside-page-or-degenerate'),
            ('zero width', {1: 0}, {}, {'r': 60}, 'box-outside-page-or-degenerate'),
            ('reversed bottom-left', {1: 0}, {}, {'b': 700}, 'box-outside-page-or-degenerate'),
            ('reversed top-left', {1: 0}, {}, {'coord_origin': 'TOPLEFT'}, 'box-outside-page-or-degenerate'),
        ]
        for name, rotations, size, box, reason in cases:
            with self.subTest(name=name):
                export = synthetic_export()
                export['pages']['1']['size'].update(size)
                export['pictures'][0]['prov'][0]['bbox'].update(box)
                imported = import_docling_layout(export, DOCUMENT, SHA, rotations)
                provenance = imported.pictures[0].provenance[0]
                self.assertIsNone(provenance.anchor)
                self.assertEqual(provenance.unresolved_reason, reason)
                self.assertEqual(provenance.box.to_dict(), export['pictures'][0]['prov'][0]['bbox'])
                self.assertEqual(imported.to_dict()['pictures'][0]['layoutStatus'], 'unresolved')

    def test_pdfium_float32_dimensions_are_not_arbitrary_resize_tolerance(self):
        document = PdfDocument.create('paper', SHA, 'local',
            (PdfPage(1, 621.3590087890625, 798.9600219726562, ''),), 'now')
        for width, height, match, anchored in (
                (621.3590087890625, 798.9600219726562, 'exact', True),
                (621.359, 798.96, 'float32-equivalent', True),
                (621.36, 798.96, 'page-size-mismatch', False)):
            with self.subTest(width=width):
                export = synthetic_export()
                export['pages']['1']['size'] = dict(width=width, height=height)
                result = import_docling_layout(export, document, SHA, {1: 0})
                self.assertEqual(result.pages[0].dimension_match, match)
                self.assertEqual(result.pages[0].source_width, document.page(1).width)
                self.assertEqual(result.pages[0].width, width)
                self.assertEqual(result.pictures[0].provenance[0].anchor is not None, anchored)
                if anchored:
                    self.assertEqual(result.pictures[0].provenance[0].anchor.rects[0].x, 60 / width)

    def test_missing_pages_and_provenance_do_not_gain_anchors(self):
        for page in (None, 2):
            with self.subTest(page=page):
                export = synthetic_export()
                if page is None:
                    export['pages'] = {}
                else:
                    export['pictures'][0]['prov'][0]['page_no'] = page
                result = import_docling_layout(export, DOCUMENT, SHA, {1: 0, 2: 0})
                self.assertEqual(result.pictures[0].provenance[0].unresolved_reason, 'page-unavailable')
        export = synthetic_export()
        export['pictures'][0]['prov'] = []
        result = import_docling_layout(export, DOCUMENT, SHA, {1: 0})
        self.assertEqual(result.to_dict()['pictures'][0]['layoutStatus'], 'unresolved')

    def test_missing_text_target_is_not_inferred_from_nearby_text(self):
        export = synthetic_export()
        export['pictures'][0]['captions'] = [{'$ref': '#/texts/99'}]
        result = import_docling_layout(export, DOCUMENT, SHA, {1: 0})
        self.assertIsNone(result.pictures[0].relationships[0].text)
        self.assertEqual(result.to_dict()['pictures'][0]['relationships'][0]['status'],
                         'unresolved-text-reference')

    def test_input_boundary_rejects_malformed_or_ambiguous_exports(self):
        baseline = synthetic_export()
        variants = [dict(baseline, schema_name='OtherDocument'), {}]
        for key, bad in [('charspan', [3, 2]), ('charspan', [False, 2]), ('page_no', True)]:
            export = deepcopy(baseline)
            export['texts'][0]['prov'][0][key] = bad
            variants.append(export)
        for bad in (float('nan'), float('inf'), True, '60'):
            export = deepcopy(baseline)
            export['pictures'][0]['prov'][0]['bbox']['l'] = bad
            variants.append(export)
        export = deepcopy(baseline)
        export['texts'][1]['self_ref'] = '#/texts/0'
        variants.append(export)
        export = deepcopy(baseline)
        export['pages']['1']['page_no'] = 2
        variants.append(export)
        export = deepcopy(baseline)
        export['pages']['1']['size']['height'] = 0
        variants.append(export)
        for export in variants:
            with self.subTest(export=export), self.assertRaises(Invalid):
                import_docling_layout(export, DOCUMENT, SHA, {1: 0})
        for rotations in ({1: True}, {1: 45}, {'1': 0}):
            with self.subTest(rotations=rotations), self.assertRaises(Invalid):
                import_docling_layout(baseline, DOCUMENT, SHA, rotations)

    def test_source_digest_must_be_original_sha256(self):
        for source_digest in ('b' * 64, SHA.upper(), '12345', None):
            with self.subTest(source_digest=source_digest), self.assertRaises(Invalid):
                import_docling_layout(synthetic_export(), DOCUMENT, source_digest, {1: 0})



class DoclingPreflightTests(unittest.TestCase):
    def test_host_disable_tombstone_overrides_environment_fallback(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict('os.environ', {'PERO_DOCLING_ARTIFACTS_PATH': '/previously-approved/models'}):
            root = Path(tmp)
            (root / 'docling-runtime.json').write_text('{"disabled": true}')
            config = configured_docling_layout(root)
            self.assertFalse(config.enabled)
            status = docling_layout_status(config)
            self.assertFalse(status['available'])
            self.assertTrue(status['disabled'])
            self.assertEqual(status['downloadPolicy'], 'never')
            self.assertIn('Disabled by Host', status['reasons'][0])

    def test_trusted_file_selects_isolated_runtime_and_rejects_relative_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / 'docling-runtime.json'
            config_path.write_text(json.dumps(dict(python=sys.executable, artifactsPath=str(root / 'models'))))
            config = configured_docling_layout(root)
            self.assertEqual(config.python_path, Path(sys.executable))
            status = docling_layout_status(config)
            self.assertFalse(status['available'])
            self.assertEqual(status['runtime']['mode'], 'isolated-subprocess')
            config_path.write_text(json.dumps(dict(python='relative/python', artifactsPath=str(root))))
            with self.assertRaisesRegex(Invalid, 'absolute'):
                configured_docling_layout(root)

    def test_missing_isolated_interpreter_is_explicitly_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = DoclingLayoutConfig(Path(tmp), Path(tmp) / 'not-installed-python')
            status = docling_layout_status(config)
        self.assertFalse(status['available'])
        self.assertIn('could not run', status['reasons'][0])

    def test_unconfigured_runtime_never_reports_available(self):
        with patch.dict('os.environ', {'PERO_DOCLING_ARTIFACTS_PATH': ''}):
            status = docling_layout_status()
        self.assertFalse(status['available'])
        self.assertEqual(status['downloadPolicy'], 'never')
        self.assertTrue(any('PERO_DOCLING_ARTIFACTS_PATH' in r for r in status['reasons']))

    def test_missing_or_mismatched_distribution_refuses_before_conversion(self):
        for installed in (None, '0.0.0'):
            with self.subTest(installed=installed), tempfile.TemporaryDirectory() as tmp:
                def version(_):
                    if installed is None:
                        raise importlib.metadata.PackageNotFoundError()
                    return installed
                with patch('importlib.metadata.version', side_effect=version):
                    status = docling_layout_status(DoclingLayoutConfig(Path(tmp)))
                self.assertFalse(status['available'])
                self.assertTrue(any('docling-slim: requires 2.146.0' in r for r in status['reasons']))

    def test_missing_and_corrupt_offline_assets_are_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / MODEL_REPOSITORY.replace('/', '--')
            folder.mkdir()
            (folder / 'config.json').write_text('{}')
            linux_profile = DoclingProfile.select('linux', 'x86_64', (3, 12), 'CPython')
            with patch('importlib.metadata.version', side_effect=DOCLING_DEPENDENCIES.__getitem__), \
                    patch('paper_agent.docling_layout.DoclingProfile.select', return_value=linux_profile):
                status = docling_layout_status(DoclingLayoutConfig(Path(tmp)))
            self.assertFalse(status['available'])
            self.assertIn('Offline model asset SHA-256 mismatch: config.json', status['reasons'])
            self.assertIn('Missing offline model asset: model.safetensors', status['reasons'])

    def test_oversized_page_refused_before_optional_runtime_load(self):
        data = b'synthetic oversized PDF geometry'
        for width, height in ((2001, 1), (1500, 1000), (float('nan'), 100), (-1, 100)):
            document = PdfDocument.create('paper', digest(data), 'local',
                                          (PdfPage(1, width, height, ''),), 'now')
            with self.subTest(width=width, height=height), self.assertRaises(Invalid) as error:
                convert_docling_pdf(data, document, 1, None)
            self.assertIn(error.exception.status, (413, 422))

    def test_conversion_rejects_wrong_original_before_loading_optional_runtime(self):
        with self.assertRaisesRegex(Invalid, 'SHA-256'):
            convert_docling_pdf(b'not this original', DOCUMENT, 1, None)



@unittest.skipUnless(os.environ.get('PERO_DOCLING_REAL_CORPUS'), 'explicit real corpus opt-in')
class DoclingRealConversionTests(unittest.TestCase):
    def test_offline_selected_page_retains_native_text_and_derived_relationships(self):
        manifest = json.loads((Path(__file__).parent / 'fixtures/numeric-corpus.json').read_text())
        sample = manifest['samples'][0]
        data = (Path(os.environ['PERO_DOCLING_REAL_CORPUS']) / sample['fileName']).read_bytes()
        self.assertEqual(digest(data), sample['sha256'])
        document = PdfDocument.create('paper', digest(data), 'local', PdfFiles().pages(data), 'now')
        config = DoclingLayoutConfig(Path(os.environ['PERO_DOCLING_ARTIFACTS_PATH']))
        with patch('socket.socket.connect', side_effect=AssertionError('Unexpected network access')):
            result = convert_docling_pdf(data, document, sample['page'], config)
        self.assertEqual(result['nativePageText'], document.page(sample['page']).text)
        self.assertEqual(result['sourceSha256'], sample['sha256'])
        self.assertEqual(result['pageRange'], [sample['page'], sample['page']])
        self.assertEqual(result['layout']['textKind'], 'full_page_ocr_docling')
        self.assertEqual(result['scientificAcceptance'], 'unverified')
        self.assertTrue(result['layout']['pictures'])
        self.assertTrue(result['layout']['texts'])
        self.assertEqual(list(result['rawExport']['pages']), [str(sample['page'])])
        self.assertTrue(any(r['role'] == 'caption' for p in result['layout']['pictures']
                            for r in p['relationships']))


if __name__ == '__main__':
    unittest.main()
