"""Exploration identity, relationship direction and explicit collection behavior."""
import tempfile
from dataclasses import replace
import unittest
from urllib.parse import urlsplit, parse_qs
from test_literature import Response, NOW
from test_research import reading, request
from paper_agent.discovery import DiscoveryQuery, DiscoveryBatch, SeedMatches
from paper_agent.literature import LiteratureClient
from paper_agent.model import PaperSnapshot, Invalid
from paper_agent.store import ResearchStore


def work(identity, **changes):
    return dict(id='https://openalex.org/' + identity, display_name='Synthetic ' + identity,
                doi='https://doi.org/10.1234/' + identity, authorships=[], cited_by_count=2,
                abstract_inverted_index={'Synthetic': [0], identity: [1]}, publication_date='2026-01-01', **changes)


class DiscoveryTest(unittest.TestCase):
    def test_seed_identity_and_relationship_queries(self):
        calls = []
        seed = PaperSnapshot.from_reading(reading(source='openalex', sourceId='W1'), NOW)
        graph = work('W1', referenced_works=['https://openalex.org/W' + str(i) for i in range(2, 16)],
                     related_works=['https://openalex.org/W3', 'https://openalex.org/W2'])
        def fetch(url, **_options):
            calls.append(url)
            parsed = urlsplit(url)
            query = parse_qs(parsed.query)
            if parsed.path != '/works':
                return Response(graph)
            if 'search' in query:
                return Response(dict(results=[graph]))
            relation = query['filter'][0]
            if relation == 'cites:W1':
                return Response(dict(results=[work('W9')], meta=dict(count=13)))
            ids = relation.removeprefix('openalex:').split('|')
            return Response(dict(results=[work(i) for i in reversed(ids)]))
        client = LiteratureClient(fetch, lambda: NOW)
        cases = [('related', 1, ['W3', 'W2'], False), ('references', 2, ['W14', 'W15'], False),
                 ('references', 1, ['W' + str(i) for i in range(2, 14)], True), ('citing', 1, ['W9'], True)]
        for relation, page, ids, more in cases:
            with self.subTest(relation=relation, page=page):
                result = client.discover(DiscoveryQuery(seed.id, relation, page), seed)
                self.assertEqual([p.id for p in result.items], ids)
                self.assertEqual(result.has_more, more)
                self.assertEqual(result.seed_id, seed.id)
                self.assertEqual(DiscoveryBatch.from_record(result.to_dict()), result)
        self.assertTrue(any('cites%3AW1' in url for url in calls))
        imported = PaperSnapshot.from_reading(reading(), NOW)
        result = client.discover(DiscoveryQuery(imported.id, 'related'), imported)
        self.assertIsInstance(result, SeedMatches)
        confirmed = client.discover(DiscoveryQuery(imported.id, 'references', work_id='W1'), imported)
        self.assertEqual(confirmed.matching, 'confirmed')
        self.assertEqual(confirmed.seed_id, imported.id)
        self.assertEqual(DiscoveryQuery(imported.id, 'related').selector(imported), None)
        doi = PaperSnapshot.from_reading(reading(url='https://doi.org/10.1234/example'), NOW)
        self.assertEqual(DiscoveryQuery(doi.id, 'related').selector(doi), 'https://doi.org/10.1234/example')
        missing = LiteratureClient(lambda url, **opts: Response(dict(results=[graph])) if urlsplit(url).path == '/works' else Response({}, 404), lambda: NOW)
        self.assertIsInstance(missing.discover(DiscoveryQuery(doi.id, 'related'), doi), SeedMatches)
        for change in [dict(seedId='../x'), dict(relation='refuting'), dict(page=True), dict(page=0), dict(workId='https://localhost')]:
            with self.subTest(change=change), self.assertRaises(Invalid):
                DiscoveryQuery.parse({**dict(seedId=seed.id, relation='related'), **change})

    def test_saved_candidates_preserve_discovery_without_changing_research(self):
        seed = PaperSnapshot.from_reading(reading(source='openalex', sourceId='W1'), NOW)
        graph = work('W1', referenced_works=[], related_works=['https://openalex.org/W2'])
        def fetch(url, **_options):
            return Response(dict(results=[work('W2')])) if urlsplit(url).path == '/works' else Response(graph)
        batch = LiteratureClient(fetch, lambda: NOW).discover(DiscoveryQuery(seed.id, 'related'), seed)
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            store.save_paper(seed)
            intent = store.prepare(request([seed]), NOW)
            store.save_discovery(batch)
            favorite = store.save_favorite(batch.id, 'W2')
            other = replace(batch, relation='references')
            store.save_discovery(other)
            self.assertEqual(store.save_favorite(other.id, 'W2'), favorite)
            reopened = ResearchStore(root)
            self.assertEqual(reopened.favorite(favorite.id), favorite)
            self.assertEqual(len(reopened.library()['papers']), 1)
            self.assertEqual(reopened.intent(intent.id), intent)
            self.assertEqual(reopened.library()['favorites'][0]['seedId'], seed.id)
            paper = reopened.save_paper(batch.paper('W2').reading(NOW))
            self.assertEqual(paper.content_kind, 'abstract')
            self.assertEqual(reopened.intent(intent.id), intent)
            with self.assertRaisesRegex(Invalid, 'outside'):
                reopened.save_favorite(batch.id, 'W99')
            changed = batch.to_dict()
            changed['seedTitle'] = 'Tampered'
            with self.assertRaises(Invalid):
                DiscoveryBatch.from_record(changed)
        unavailable = batch.paper('W2').to_dict()
        unavailable['abstract'] = ''
        from paper_agent.discovery import DiscoveryPaper
        candidate = DiscoveryPaper.parse(unavailable)
        with self.assertRaisesRegex(Invalid, 'no abstract'):
            candidate.reading(NOW)


if __name__ == '__main__':
    unittest.main()
