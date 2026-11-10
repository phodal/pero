"""The server verifies retained text, not claimed external provenance."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import json
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from source_excerpt import SourceExcerpt, parse_source_excerpt_attributes


def excerpt(text='\ufeffA🧪e\u0301\r\n终\rLast'):
    digest = sha256(text.encode('utf-8')).hexdigest()
    return dict(source=dict(blockId='source-1', filename='notes.txt', mime='text/plain', sha256=digest), version=digest,
                text=text, start=2, end=8, quote=text[2:8])


class SourceExcerptTest(unittest.TestCase):
    def test_exact_unicode_bytes_and_quote_remain_available_without_original(self):
        value = excerpt()
        result = SourceExcerpt.parse(json.loads(json.dumps(value))).wire()
        self.assertEqual(result, value)
        self.assertEqual(result['quote'], '🧪e\u0301\r\n终')
        self.assertEqual(result['version'], sha256(result['text'].encode('utf-8')).hexdigest())
        self.assertEqual(parse_source_excerpt_attributes(dict(label='Pinned source', excerpt=value))['excerpt'], value)
        self.assertEqual(parse_source_excerpt_attributes(dict(label='', excerpt=None)), dict(label='', excerpt=None))

    def test_reject_invalid_integrity_bounds_quotes_utf8_and_metadata(self):
        changes = [dict(text='changed'), dict(version='bad'), dict(quote='different'), dict(start=-1), dict(start=True),
                   dict(start=2.5), dict(end=2), dict(end=999), dict(text='a' * (128 * 1024 + 1)), dict(text='中' * 45000),
                   dict(text='a\x00b'), dict(text='a\ud800b'), dict(extra='unknown')]
        for change in changes:
            value = excerpt(); value.update(change)
            with self.subTest(change=list(change)), self.assertRaises(ValueError):
                SourceExcerpt.parse(value)
        for key, change in [('blockId', 'bad\n'), ('filename', '../file'), ('mime', 'application/pdf'), ('sha256', 'A' * 64), ('extra', 'bad')]:
            value = excerpt(); value['source'][key] = change
            with self.subTest(field=key), self.assertRaises(ValueError):
                SourceExcerpt.parse(value)
        forged = excerpt(); forged['source']['sha256'] = 'a' * 64; forged['version'] = 'a' * 64
        with self.assertRaisesRegex(ValueError, 'digest'):
            SourceExcerpt.parse(forged)
        no_bom = excerpt(); no_bom['text'] = no_bom['text'].lstrip('\ufeff')
        with self.assertRaisesRegex(ValueError, 'digest'):
            SourceExcerpt.parse(no_bom)
        for attrs in [dict(label='x' * 201, excerpt=None), dict(label='', excerpt=None, extra=True)]:
            with self.assertRaises(ValueError):
                parse_source_excerpt_attributes(attrs)

    def test_snapshot_is_independent_of_mutable_input_and_source_replacement(self):
        value = excerpt()
        parsed = SourceExcerpt.parse(value)
        original = deepcopy(value)
        value['source']['filename'] = 'changed.txt'; value['text'] = 'changed'
        self.assertEqual(parsed.wire(), original)
        bounded = excerpt('a' * (128 * 1024))
        self.assertEqual(SourceExcerpt.parse(bounded).text, bounded['text'])


if __name__ == '__main__':
    unittest.main()
