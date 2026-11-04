"""Platform rules and native-framework seam tests, not macOS execution evidence."""
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.docling_profile import DoclingProfile
from paper_agent.docling_layout import DoclingLayoutConfig, docling_layout_status, DOCLING_DEPENDENCIES
from paper_agent.model import Invalid


class DoclingProfileTests(unittest.TestCase):
    def test_platform_abi_and_macos_minimum_are_explicit(self):
        for system, machine, python, implementation, macos, expected in (
            ('linux', 'x86_64', (3, 12), 'CPython', '', 'linux-x86_64-cp312'),
            ('darwin', 'arm64', (3, 12), 'CPython', '14.0', 'macos-arm64-cp312'),
            ('darwin', 'arm64', (3, 12), 'CPython', '26.1', 'macos-arm64-cp312'),
            ('darwin', 'arm64', (3, 12), 'CPython', '13.9', None),
            ('darwin', 'arm64', (3, 12), 'CPython', '', None),
            ('darwin', 'x86_64', (3, 12), 'CPython', '14.0', None),
            ('darwin', 'arm64', (3, 13), 'CPython', '14.0', None),
            ('darwin', 'arm64', (3, 12), 'PyPy', '14.0', None),
            ('linux', 'aarch64', (3, 12), 'CPython', '', None),
            ('win32', 'AMD64', (3, 12), 'CPython', '', None),
        ):
            with self.subTest(system=system, machine=machine, python=python, macos=macos):
                if expected is None:
                    with self.assertRaises(Invalid):
                        DoclingProfile.select(system, machine, python, implementation, macos)
                else:
                    profile = DoclingProfile.select(system, machine, python, implementation, macos)
                    self.assertEqual(profile.id, expected)
                    self.assertEqual('+cpu' in profile.torch_version, system == 'linux')
        with self.assertRaisesRegex(Invalid, 'release CPython'):
            DoclingProfile.select('darwin', 'arm64', (3, 12), 'CPython', '14.0', 'd')

    def test_trusted_profile_cannot_mask_a_different_interpreter(self):
        linux = DoclingProfile.select('linux', 'x86_64', (3, 12), 'CPython')
        with patch('paper_agent.docling_layout.DoclingProfile.select', return_value=linux):
            status = docling_layout_status(DoclingLayoutConfig(Path('/not-used'), profile='macos-arm64-cp312'))
        self.assertFalse(status['available'])
        self.assertIn('does not match', status['reasons'][0])

    def test_apple_vision_preflight_requires_actual_framework_language_support(self):
        profile = DoclingProfile.select('darwin', 'arm64', (3, 12), 'CPython', '14.0')
        versions = {**DOCLING_DEPENDENCIES, 'torch': '2.10.0', 'torchvision': '0.25.0',
                    'ocrmac': '1.0.1', **{name: '13.0' for name in ('pyobjc-core',
                        'pyobjc-framework-Cocoa', 'pyobjc-framework-Quartz',
                        'pyobjc-framework-CoreML', 'pyobjc-framework-Vision')}}
        for languages, error, available in ((['en-US'], None, True), (['fr-FR'], None, False),
                                             (['en-US'], 'native framework error', False)):
            request = SimpleNamespace(setRecognitionLevel_=lambda level: self.assertEqual(level, 0),
                revision=lambda: 3, supportedRecognitionLanguagesAndReturnError_=lambda _: (languages, error))
            vision = SimpleNamespace(VNRecognizeTextRequest=SimpleNamespace(
                alloc=lambda: SimpleNamespace(init=lambda: request)))
            with self.subTest(languages=languages, error=error), tempfile.TemporaryDirectory() as tmp, \
                    patch('paper_agent.docling_layout.DoclingProfile.select', return_value=profile), \
                    patch('paper_agent.docling_layout.MODEL_FILES', {}), \
                    patch('importlib.metadata.version', side_effect=versions.__getitem__), \
                    patch.dict(sys.modules, {'Vision': vision}), \
                    patch('platform.mac_ver', return_value=('14.0', (), 'arm64')), \
                    patch('platform.release', return_value='23.0.0'), \
                    patch('subprocess.run', return_value=SimpleNamespace(stdout='23A344\n')):
                status = docling_layout_status(DoclingLayoutConfig(Path(tmp), profile=profile.id))
            self.assertEqual(status['available'], available)
            self.assertEqual(status['ocr']['engine'], 'apple-vision')
            self.assertEqual(status['ocr']['macosBuild'], '23A344')
            self.assertEqual(status['ocr']['visionRequestRevision'], 3)
            self.assertEqual(status['installed']['pyobjc-core'], '13.0')
            self.assertNotIn('binarySha256', status['ocr'])


if __name__ == '__main__':
    unittest.main()
