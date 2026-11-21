"""Synthetic identity contracts, not evidence of a real Fisher execution."""
from dataclasses import asdict, replace
import unittest

from paper_agent.model import Invalid, PaperSnapshot, digest
from paper_agent.research_records import ResearchRecord, ResearchAttempt, FisherResearchAttempt
from test_research import NOW, reading
from test_research_records import draft


class RecipeReferences(unittest.TestCase):
    def test_recipe_identity_ownership_reopen_and_private_export(self):
        paper = PaperSnapshot.from_reading(reading(), NOW)
        fisher = FisherResearchAttempt(paper.id, 'a'*64, 'b'*64, 4, 'c'*64,
            'c'*64, 'd'*32, 'e'*64, 'completed', NOW)
        request = draft([paper], attempts=[dict(itemId=fisher.itemId, attemptId=fisher.attemptId)])
        record = ResearchRecord.create(request, [paper], NOW, available_attempts=[fisher])
        self.assertEqual(ResearchRecord.from_record(record.to_dict(), record.id), record)
        index = record.export_index()
        self.assertEqual(index['attempts'], [asdict(fisher)])
        self.assertEqual(index['verification'], 'not_run')
        self.assertNotIn('question', index)
        self.assertTrue({'seed', 'policy', 'profile'}.isdisjoint(index['attempts'][0]))
        for attempt in [replace(fisher, paperId='f'*64), replace(fisher, attemptId='0'*32), replace(fisher, itemId='0'*64)]:
            with self.subTest(attempt=attempt), self.assertRaises(Invalid):
                ResearchRecord.create(request, [paper], NOW, available_attempts=[attempt])
        altered = record.to_dict()
        altered['attempts'][0]['methodDigest'] = '0'*64
        with self.assertRaises(Invalid):
            ResearchRecord.from_record(altered, record.id)
        impact = record.impact([paper], record.sourceVersions, {}, {'pcgym': '0'*64, fisher.recipe: fisher.methodDigest})
        self.assertEqual(impact['methodStatus'], 'unchanged')
        self.assertEqual(impact['affectedAttempts'], [])

    def test_legacy_pcgym_body_and_revision_identity_are_unchanged(self):
        paper = PaperSnapshot.from_reading(reading(), NOW)
        attempt = ResearchAttempt(paper.id, 'a'*64, 'b'*64, 6, 'c'*64, 'd'*64,
            'e'*32, 'base', 'smoke', 1, 'f'*64, 'completed', NOW)
        value = draft([paper], attempts=[dict(itemId=attempt.itemId, attemptId=attempt.attemptId)])
        record = ResearchRecord.create(value, [paper], NOW, available_attempts=[attempt])
        body = record.body()
        self.assertEqual(body['attempts'], [asdict(attempt)])
        self.assertNotIn('recipe', body['attempts'][0])
        self.assertEqual(record.id, digest(body))
        # Captured from the unchanged origin/master implementation and fixture.
        self.assertEqual(record.id, 'cbcf5fc16e671182b4be7c7c56203d5fc64bd8c459b89f725b5f8697da4b3e9e')
        self.assertEqual(ResearchRecord.from_record(record.to_dict(), record.id).to_dict(), record.to_dict())
        impact = record.impact([paper], record.sourceVersions, {}, attempt.methodDigest)
        self.assertEqual(impact['methodStatus'], 'unchanged')
