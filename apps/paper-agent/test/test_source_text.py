"""Original line boundaries preserve source identities and exact quotations."""
import unittest
from paper_agent.model import Invalid, PaperSnapshot
from paper_agent.source_text import SourceText
from test_research import NOW, reading


class SourceTextTest(unittest.TestCase):
    def test_line_ranges_keep_original_whitespace_and_offsets(self):
        for content, first, last, expected in (
                ('Title\r\n\r\n方法 β\r\nEnd', 2, 3, '\r\n方法 β\r\n'),
                ('one\ntwo\n', 2, 2, 'two\n'), ('one', 1, 1, 'one')):
            with self.subTest(content=content):
                source = SourceText(content)
                start, selected = source.range(first, last)
                self.assertEqual(selected, expected)
                self.assertEqual(content[start:start + len(selected)], expected)
                paper = PaperSnapshot.from_reading(reading(content=content), NOW)
                self.assertEqual(PaperSnapshot.from_record(paper.to_record()), paper)
                self.assertNotIn('content', paper.to_record())
        for first, last in ((0, 1), (True, 1), (2, 1), (1, 3)):
            with self.subTest(first=first, last=last), self.assertRaises(Invalid):
                SourceText('one\ntwo').range(first, last)
        with self.assertRaisesRegex(Invalid, 'character offset'):
            SourceText('x' * 4801).range(1, 1)
