"""Offline admission checks for the explicitly opted-in runner's corpus input."""
from dataclasses import replace
import hashlib
import json
import os
import sys
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent / 'manual'))
from docling_ci import CORPUS, CorpusSample, NoRedirect, run_stage


class CorpusDownloadTests(unittest.TestCase):
    def test_only_bounded_canonical_nasa_originals_are_admitted(self):
        sources = json.loads(CORPUS.read_text())['samples']
        self.assertEqual(len(sources), 3)
        for source in sources:
            sample = CorpusSample.parse(source)
            self.assertEqual(sample.sha256, source['sha256'])
        invalid = [dict(ntrsId='../untrusted'), dict(ntrsId=123),
            dict(fileName='../escape.pdf'), dict(downloadUrl='https://example.com/input.pdf'),
            dict(downloadUrl=sources[0]['downloadUrl'] + '?redirect=elsewhere'),
            dict(byteLength=True), dict(byteLength=0), dict(byteLength=21 * 1024 * 1024),
            dict(sha256='not-a-hash')]
        for change in invalid:
            with self.subTest(change=change), self.assertRaises(ValueError):
                CorpusSample.parse({**sources[0], **change})

    def test_downloaded_bytes_must_match_length_signature_and_digest(self):
        data = b'%PDF-synthetic verification bytes, not a real original'
        sample = CorpusSample('synthetic', 'fixture.pdf', 'unused', hashlib.sha256(data).hexdigest(), len(data))
        sample.verify(data)
        for changed, payload in [(sample, data + b'!'), (sample, b'x' + data[1:]),
                                 (replace(sample, sha256='0' * 64), data)]:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                changed.verify(payload)

    def test_redirects_require_review_instead_of_fetching_a_new_source(self):
        with self.assertRaisesRegex(ValueError, 'redirected'):
            NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.com/input.pdf')


class StageEvidenceTests(unittest.TestCase):
    @unittest.skipUnless(os.name == 'posix', 'The Mac runner uses POSIX process groups')
    def test_pass_failure_and_timeout_are_retained_with_logs(self):
        cases = [('passed', "print('synthetic stage result')", 10),
                 ('failed', "raise SystemExit('synthetic stage failure')", 10),
                 ('timed_out', 'import signal; signal.pause()', .2)]
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            receipt = dict(stages=[])
            for status, code, timeout in cases:
                with self.subTest(status=status):
                    passed = run_stage(status, [sys.executable, '-c', code], output,
                                       dict(os.environ), timeout, output, receipt)
                    saved = json.loads((output / 'run.json').read_text())['stages'][-1]
                    self.assertEqual(saved['status'], status)
                    self.assertEqual(passed, status == 'passed')
                    self.assertGreater(saved['wallSeconds'], 0)
                    self.assertTrue((output / saved['log']).is_file())
            self.assertIn('synthetic stage failure', (output / 'failed.log').read_text())


if __name__ == '__main__':
    unittest.main()
