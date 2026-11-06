"""Large research histories stay complete behind bounded public views."""
import json
import tempfile
import unittest

from test_research import NOW, reading
from paper_agent.discovery import DiscoveryBatch, DiscoveryPaper
from paper_agent.model import PaperSnapshot
from paper_agent.research_program_store import ResearchPrograms
from paper_agent.store import ResearchStore


class ProgramPagingAcceptance(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = ResearchStore(self.directory.name)
        self.seed = self.store.save_paper(PaperSnapshot.from_reading(
            reading(source='openalex', sourceId='W1'), NOW))
        self.programs = ResearchPrograms(self.store)

    def create(self, request_id):
        return self.programs.command(dict(operation='create', requestId=request_id,
            question='Which original studies test model mismatch?',
            scope='Original model mismatch studies', inclusion='Observed methods',
            exclusion='Unattributed summaries', seedPaperIds=[self.seed.id],
            acquisition='saved_only', noProgressLimit=2,
            limits=dict(rounds=3, searches=30, candidates=240, reads=18)), NOW)

    def test_all_205_candidates_are_pageable_and_exports_keep_exact_history(self):
        created = self.create('large-candidate-history')
        initial_export = dict(operation='export', programId=created['id'], checkpoint=created['checkpoint'])
        original = self.programs.command(initial_export, NOW)
        seed_work = DiscoveryPaper('W1', 'Seed method', 'https://openalex.org/W1',
                                   (), 'Seed abstract', '2026-01-01', 0)
        state = created
        expected_titles = []
        for page in range(17):
            works = tuple(DiscoveryPaper(f'W{number}', f'Mismatch study W{number}',
                f'https://doi.org/10.1234/paging-{number}', (),
                ('原' * 120000 if page < 4 and number < 4 + page * 12
                 else 'Synthetic original study of model mismatch.'), '2026-01-02', 0,
                doi=f'https://doi.org/10.1234/paging-{number}')
                for number in range(2 + page * 12, 14 + page * 12))
            expected_titles.extend(work.title for work in works)
            batch = self.store.save_discovery(DiscoveryBatch(self.seed.id, self.seed.title,
                'references', seed_work, works, page + 1, page < 16, NOW, 'identifier'))
            state = self.programs.command(dict(operation='adopt-discovery', programId=created['id'],
                expectedCheckpoint=state['checkpoint'], operationId=f'page-discovery-{page}',
                batchId=batch.id), NOW)

        view = self.programs.command(dict(operation='read', programId=created['id']), NOW)
        self.assertEqual(view['candidatePage'], dict(offset=0, total=205, nextOffset=10))
        self.assertEqual(len(view['candidates']), 10)
        self.assertEqual(view['roundPage'], dict(offset=0, total=0, nextOffset=None))
        self.assertLess(len(json.dumps(view, ensure_ascii=False).encode('utf-8')), 2 * 1024 * 1024)

        found = []
        offset = 0
        while offset is not None:
            page = self.programs.command(dict(operation='read', programId=created['id'], offset=offset, limit=50), NOW)
            self.assertEqual(page['candidatePage']['offset'], offset)
            self.assertEqual(page['candidatePage']['total'], 205)
            self.assertLessEqual(len(page['candidates']), 50)
            self.assertLess(len(json.dumps(page, ensure_ascii=False).encode('utf-8')), 2 * 1024 * 1024)
            found.extend(candidate['id'] for candidate in page['candidates'])
            next_offset = page['candidatePage']['nextOffset']
            if next_offset is not None:
                self.assertGreater(next_offset, offset)
            offset = next_offset
        self.assertEqual(len(found), 205)
        self.assertEqual(len(set(found)), 205)

        reopened = ResearchPrograms(ResearchStore(self.directory.name))
        self.assertEqual(reopened.command(initial_export, NOW), original)
        latest = reopened.command(dict(operation='export', programId=created['id'], checkpoint=state['checkpoint']), NOW)
        delivered = '\n'.join(document['content'] for document in latest['documents'])
        for title in expected_titles:
            with self.subTest(title=title):
                self.assertIn(title, delivered)
        self.assertNotIn(expected_titles[-1], '\n'.join(document['content'] for document in original['documents']))

    def test_program_list_pages_summaries_without_embedding_research_history(self):
        expected_ids = {self.create(f'listed-program-{index}')['id'] for index in range(23)}
        first = self.programs.command(dict(operation='list'), NOW)
        self.assertEqual(first['page'], dict(offset=0, total=23, nextOffset=20))
        self.assertEqual(len(first['programs']), 20)
        tail = self.programs.command(dict(operation='list', offset=20), NOW)
        self.assertEqual(tail['page'], dict(offset=20, total=23, nextOffset=None))
        self.assertEqual(len(tail['programs']), 3)
        self.assertEqual({program['id'] for program in [*first['programs'], *tail['programs']]}, expected_ids)

        offset = 0
        seen = []
        while offset is not None:
            page = self.programs.command(dict(operation='list', offset=offset, limit=5), NOW)
            self.assertEqual(page['page']['offset'], offset)
            self.assertEqual(page['page']['total'], 23)
            self.assertLessEqual(len(page['programs']), 5)
            self.assertLess(len(json.dumps(page, ensure_ascii=False).encode('utf-8')), 2 * 1024 * 1024)
            for summary in page['programs']:
                for unbounded_history in ('candidates', 'rounds', 'jobs'):
                    self.assertNotIn(unbounded_history, summary)
                seen.append(summary['id'])
            next_offset = page['page']['nextOffset']
            if next_offset is not None:
                self.assertGreater(next_offset, offset)
            offset = next_offset
        self.assertEqual(set(seen), expected_ids)
        self.assertEqual(len(seen), len(expected_ids))
        reopened = ResearchPrograms(ResearchStore(self.directory.name))
        self.assertEqual(reopened.command(dict(operation='list'), NOW), first)


if __name__ == '__main__':
    unittest.main()
