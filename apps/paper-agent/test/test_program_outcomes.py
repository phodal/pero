"""Public lookup outcomes keep ambiguity, partial failure and pagination visible."""
import json
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

from test_discovery import work
from test_literature import Response
from test_research import NOW, reading
import test_research_programs as acceptance
from paper_agent.discovery import DiscoveryBatch, DiscoveryQuery
from paper_agent.literature import LiteratureClient
from paper_agent.model import PaperSnapshot
from paper_agent.research_jobs import ResearchJobs
from paper_agent.research_program_store import ResearchPrograms
from paper_agent.store import ResearchStore


def literature_outcome_worker(output, directory, value):
    def fetch(url, **_options):
        parsed = urlsplit(url)
        query = parse_qs(parsed.query)
        if parsed.hostname != 'api.openalex.org' or query.get('search') == ['all sources fail']:
            return Response(status=503)
        if parsed.path.endswith('/W1'):
            return Response(work('W1', referenced_works=['https://openalex.org/W9']))
        if 'filter' in query:
            page = int(query.get('page', ['1'])[0])
            return Response(dict(results=[work('W9' if page == 1 else 'W10')], meta=dict(count=13)))
        if query.get('search') == ['Synthetic paper']:
            return Response(dict(results=[work('W1'), work('W2')]))
        return Response(dict(results=[work('W9')]))

    client = LiteratureClient(fetch, lambda: NOW)
    if value['operation'] == 'search':
        result = client.search(value['query'])
    else:
        found = client.discover(DiscoveryQuery.parse(value['query']), PaperSnapshot.from_record(value['seed']))
        result = dict(status='complete', **found.to_dict()) if isinstance(found, DiscoveryBatch) else found.to_dict()
    output.send(('complete', result))


class ProgramLookupOutcomes(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = ResearchStore(self.directory.name)
        self.paper = self.store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
        self.programs = ResearchPrograms(self.store)
        self.jobs = ResearchJobs(self.programs, worker=literature_outcome_worker)
        self.addCleanup(self.jobs.close)
        self.programs.jobs = self.jobs
        self.state = self.programs.command(acceptance.ResearchProgramsAcceptance.plan(self.paper), NOW)

    def lookup(self, operation, identity, query):
        pending = self.jobs.command(dict(operation=operation, programId=self.state['id'],
            expectedCheckpoint=self.state['checkpoint'], operationId=identity, query=query), NOW)
        process = self.jobs.running[pending['job']['id']][1]
        process.join(timeout=10)
        self.assertFalse(process.is_alive(), 'Fixture lookup did not finish')
        self.state = self.jobs.command(dict(operation='poll', programId=self.state['id'],
                                            jobId=pending['job']['id']), NOW)
        self.assertNotIn('result', self.state['job'])
        self.assertLess(len(json.dumps(self.state, ensure_ascii=False).encode('utf-8')), 2 * 1024 * 1024)
        return self.state['job']

    def test_partial_source_failure_reaches_the_agent_with_saved_candidates(self):
        job = self.lookup('search', 'partial-lookup',
                          dict(query='model mismatch', sources=['openalex', 'pubmed']))
        self.assertEqual(job['status'], 'completed')
        self.assertEqual(job['outcome']['status'], 'partial')
        self.assertEqual(job['outcome']['errors'][0]['source'], 'pubmed')
        self.assertTrue(job['outcome']['errors'][0]['error'])
        self.assertEqual(job['outcome']['warnings'][0]['source'], 'pubmed')
        self.assertTrue(job['outcome']['warnings'][0]['message'])
        self.assertTrue(any(candidate['sourceId'] == 'W9' for candidate in self.state['candidates']))
        self.assertEqual(self.state['usage']['searches'], 1)
        view = self.programs.command(dict(operation='read', programId=self.state['id']), NOW)
        saved = next(item for item in view['jobs'] if item['id'] == job['id'])
        self.assertNotIn('result', saved)
        self.assertEqual(saved['outcome'], job['outcome'])

    def test_all_failed_sources_stay_failed_and_do_not_block_a_new_lookup(self):
        job = self.lookup('search', 'failed-lookup',
                          dict(query='all sources fail', sources=['openalex', 'pubmed']))
        self.assertEqual(job['status'], 'failed')
        self.assertEqual(job['outcome']['status'], 'failed')
        self.assertEqual({error['source'] for error in job['outcome']['errors']}, {'openalex', 'pubmed'})
        self.assertEqual({warning['source'] for warning in job['outcome']['warnings']}, {'openalex', 'pubmed'})
        self.assertEqual(len(self.state['candidates']), 1)
        self.assertEqual(self.state['usage']['searches'], 1)
        recovered = self.lookup('search', 'recovered-lookup',
                                dict(query='model mismatch', sources=['openalex']))
        self.assertEqual(recovered['status'], 'completed')
        self.assertEqual(recovered['outcome']['status'], 'complete')
        self.assertEqual(self.state['usage']['searches'], 2)

    def test_seed_choice_and_following_discovery_pages_remain_actionable(self):
        unresolved = self.lookup('discover', 'ambiguous-seed',
            dict(seedId=self.paper.id, relation='citing', page=1))
        self.assertEqual(unresolved['status'], 'needs_input')
        self.assertEqual(unresolved['outcome']['status'], 'choose-seed')
        choices = unresolved['outcome']['candidates']
        self.assertEqual({choice['id'] for choice in choices}, {'W1', 'W2'})
        for choice in choices:
            self.assertTrue(choice['title'])
            self.assertTrue(choice['url'].startswith('https://'))
        self.assertEqual(len(self.state['candidates']), 1)

        selected = next(choice['id'] for choice in choices if choice['id'] == 'W1')
        first = self.lookup('discover', 'confirmed-seed-page-one',
            dict(seedId=self.paper.id, relation='citing', page=1, workId=selected))
        self.assertEqual(first['status'], 'completed')
        self.assertEqual(first['outcome']['status'], 'complete')
        self.assertEqual(first['outcome']['page'], 1)
        self.assertIs(first['outcome']['hasMore'], True)
        self.assertNotIn('items', first['outcome'])
        second = self.lookup('discover', 'confirmed-seed-page-two',
            dict(seedId=self.paper.id, relation='citing', page=2, workId=selected))
        self.assertEqual(second['status'], 'completed')
        self.assertEqual(second['outcome']['page'], 2)
        self.assertIs(second['outcome']['hasMore'], False)
        self.assertNotIn('items', second['outcome'])
        self.assertTrue({'W9', 'W10'}.issubset({candidate['sourceId'] for candidate in self.state['candidates']}))
        self.assertEqual(self.state['usage']['searches'], 3)


if __name__ == '__main__':
    unittest.main()
