import json
from pathlib import Path
import unittest
from ipynb_document import IpynbDocumentSource

SOURCE = (Path(__file__).resolve().parents[3] / 'packages/notebook/test/fixtures/ipynb-contract.json').read_text()

class IpynbContractTest(unittest.TestCase):
    def test_exact_source_and_portable_boundary(self):
        self.assertEqual(IpynbDocumentSource(SOURCE).source, SOURCE)
        for invalid in [SOURCE.replace('"nbformat":4', '"nbformat":4,"nbformat":4'), SOURCE.replace('"unknown":42', '"unknown":9007199254740992'), SOURCE.replace('"unknown":42', '"unknown":1e999'), SOURCE.replace('"unknown":42', '"unknown":"\\ud800"'), SOURCE.replace('"id":"raw"', '"id":"code"'), SOURCE.replace('"nbformat":4', '"nbformat":5'), SOURCE.replace('"unknown":42', '"unknown":' + '[' * 66 + '0' + ']' * 66), ' ' * (1024 * 1024) + SOURCE]:
            with self.subTest(invalid=invalid[:80]), self.assertRaises((ValueError, UnicodeError)):
                IpynbDocumentSource(invalid)

if __name__ == '__main__':
    unittest.main()
