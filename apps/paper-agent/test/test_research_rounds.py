"""Saved report quotation selection is exact and unambiguous."""
import unittest

from paper_agent.model import Invalid
from paper_agent.reports import EvidenceMatrix, EvidenceReference, MatrixCell, MatrixColumn, ResearchReport, ReportSection
from paper_agent.research_rounds import ResearchClaim
from paper_agent.store import SavedReport


class ResearchClaims(unittest.TestCase):
    def test_saved_quotation_selection(self):
        original = 'First line.\r\nExact evidence.\r\n'
        other = 'Exact evidence.'
        for name, quotes, fields, expected, error in (
            ('saved lines', (original,), {}, original, None),
            ('explicit exact', (original,), {'quote': original}, original, None),
            ('duplicate reference', (original, original), {}, original, None),
            ('matrix ambiguity', (original, other), {}, None, 'multiple quotations'),
            ('indexed selection', (original, other), {'evidenceIndex': 1}, other, None),
            ('wrong index', (original,), {'evidenceIndex': 1}, None, 'saved evidenceIndex'),
            ('boolean index', (original,), {'evidenceIndex': True}, None, 'saved evidenceIndex'),
            ('index quote conflict', (original, other), {'evidenceIndex': 0, 'quote': other}, None, 'Omit quote'),
            ('explicit selection', (original, other), {'quote': other}, other, None),
            ('rewritten newline', (original,), {'quote': original.replace('\r\n', '\n')}, None, 'Omit quote'),
            ('shorter observed text', (original,), {'quote': other}, None, 'Omit quote'),
            ('foreign passage', (original,), {'passageId': 'd' * 64}, None, 'finalized report'),
            ('foreign report', (original,), {'reportId': 'e' * 64}, None, 'outside this round'),
        ):
            with self.subTest(name=name):
                refs = tuple(EvidenceReference('a' * 64, quote, 'b' * 64) for quote in quotes)
                report = SavedReport('c' * 64, ResearchReport('f' * 64, 'Reading',
                    (ReportSection('Method', 'Claim', ('a' * 64,), refs[:1]),), (), 'Not verified',
                    EvidenceMatrix(tuple(MatrixColumn(str(i), 'Condition') for i in range(len(refs) - 1)),
                                   tuple(MatrixCell('a' * 64, str(i), 'Claim', 'supported', (ref,))
                                             for i, ref in enumerate(refs[1:])))), 'f' * 64, '2026-11-11T00:00:00Z')
                claim = dict(text='A bounded claim.', stance='limitation', reportId=report.id,
                             paperId='a' * 64, passageId='b' * 64)
                claim.update(fields)
                if error:
                    with self.assertRaisesRegex(Invalid, error):
                        ResearchClaim.parse(claim, (report,))
                else:
                    selected = ResearchClaim.parse(claim, (report,))
                    self.assertEqual(selected.quote, expected)
                    self.assertEqual(selected.evidenceIndex, quotes.index(expected))
