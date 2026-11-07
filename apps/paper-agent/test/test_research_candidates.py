"""Observed arXiv identity grants canonical sources, never an invented revision."""
import unittest
from paper_agent.research_candidates import ResearchCandidate, DiscoveryPath
from paper_agent.research_program import ResearchProgram
from test_research import NOW


class CandidateIdentity(unittest.TestCase):
    def test_canonical_sources_and_distinct_explicit_versions(self):
        candidates = []
        for identity, expected_html in [('2401.12345v1', 'https://arxiv.org/html/2401.12345v1'),
                                        ('2401.12345v2', 'https://arxiv.org/html/2401.12345v2'), ('2401.12345', None)]:
            with self.subTest(identity=identity):
                candidate = ResearchCandidate.observed(dict(source='alphaxiv', id=identity, title='Original method',
                    url='https://www.alphaxiv.org/abs/' + identity, doi='10.48550/arxiv.2401.12345'), DiscoveryPath('b' * 64, '', 'search'))
                self.assertEqual(candidate.pdfUrl, 'https://arxiv.org/pdf/' + identity)
                self.assertEqual(candidate.officialHtmlUrl, expected_html)
                candidates.append(candidate)
        program = ResearchProgram.create(dict(requestId='versions', question='How did the method change?', scope='Original sources',
            inclusion='Methods', exclusion='Summaries', seedPaperIds=['a' * 64]), NOW)
        program = program.discover(tuple(candidates[:2]))
        self.assertEqual(len(program.candidates), 2)
        self.assertEqual(len({c.id for c in program.candidates}), 2)
        duplicate = ResearchCandidate.observed(dict(source='alphaxiv', id='2401.12345v2', title='Original method',
            url='https://www.alphaxiv.org/abs/2401.12345v2', doi='10.48550/arxiv.2401.12345'), DiscoveryPath('c' * 64, '', 'citing'))
        merged = program.discover((duplicate,))
        self.assertEqual(len(merged.candidates), 2)
        self.assertEqual(len(merged.candidates[1].discoveries), 2)
