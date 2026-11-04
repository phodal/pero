"""Source navigation uses official SyncTeX positions bound to a preview."""
import unittest

from paper_agent.model import Invalid
from paper_agent.pdf import PdfDocument, PdfPage
from paper_agent.tex_navigation import SynctexResult, TexNavigation


class TexNavigationTest(unittest.TestCase):
    def test_navigation_requests(self):
        for request, accepted in (
            (dict(memberId='a' * 64, line=3), True), (dict(page=1, x=.5, y=.5), True),
            (dict(memberId='a' * 64, line=True), False), (dict(memberId='bad', line=3), False),
            (dict(page=1, x=-.1, y=.5), False), (dict(page=True, x=0, y=0), False),
            (dict(page=1, x=float('nan'), y=0), False),
            (dict(memberId='a' * 64, line=3, page=1), False),
        ):
            with self.subTest(request=request):
                if accepted:
                    TexNavigation.parse(request)
                else:
                    with self.assertRaises(Invalid):
                        TexNavigation.parse(request)

    def test_official_result_coordinates(self):
        # h/v/W/H are the official utility's visible box: left, bottom, width,
        # total height, in PDF points. They are not TeX source line estimates.
        document = PdfDocument('d' * 64, 'p' * 64, 'f' * 64, '', (PdfPage(1, 400, 600, ''),), '')
        output = 'SyncTeX result begin\nOutput:preview.pdf\nPage:1\nh:40\nv:120\nW:200\nH:30\nSyncTeX result end\n'
        result, = SynctexResult.parse(output)
        anchor = result.anchor(document)
        for field, expected in dict(x=.1, y=.15, width=.5, height=.05).items():
            self.assertAlmostEqual(anchor['rects'][0][field], expected)
        self.assertEqual(anchor['documentId'], document.id)
        self.assertEqual(SynctexResult.parse('No result'), ())
