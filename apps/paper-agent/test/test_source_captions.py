"""Caption correspondence keeps ambiguity and exact original text offsets."""
import unittest

from paper_agent.pdf import PdfDocument, PdfPage
from paper_agent.source_captions import SourceCaption


class SourceCaptionsTest(unittest.TestCase):
    def test_literal_caption_locations(self):
        caption = 'DeepSeek task outcomes; labels rounded.'
        for texts, source, count, page in (
            ((caption, 'Other results'), caption, 1, 1),
            (('Other results', caption), caption, 1, 2),
            ((caption, caption), caption, 2, None),
            ((caption + '\n' + caption, caption), caption, 3, None),
            ((caption + '\n' + caption,), caption, 2, None),
            (('No corresponding caption',), caption, 0, None),
            ((caption.replace(' ', '\r\n'),), caption, 1, 1),
            (('Results of Model: original evidence supports this sufficiently long literal caption.',),
             r'Results of \method{}: original evidence supports this sufficiently long literal caption.', 1, 1),
            (('Tiny.',), 'Tiny.', 0, None),
        ):
            with self.subTest(texts=texts, source=source):
                document = PdfDocument('doc', 'paper', 'hash', '', tuple(PdfPage(i + 1, 100, 100, t) for i, t in enumerate(texts)), '')
                value = SourceCaption(source)
                matches = value.matches(document)
                self.assertEqual(len(matches), count)
                unique = SourceCaption.unique(document, (value,))
                self.assertEqual(unique.page if unique else None, page)
                for match in matches:
                    quote = document.page(match.page).text[match.start:match.end]
                    self.assertTrue(quote)
                    self.assertIn(''.join(quote.split()), ''.join(source.split()))
