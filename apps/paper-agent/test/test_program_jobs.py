"""A bounded worker result becomes saved candidates, never evidence by itself."""
import tempfile
import unittest
from test_research import NOW, reading
import test_research_programs as acceptance
from paper_agent.model import Invalid, PaperSnapshot
from paper_agent.store import ResearchStore
from paper_agent.research_program_store import ResearchPrograms
from paper_agent.research_jobs import ResearchJobs


def literature_fixture(output, directory, value):
    output.send(('complete', dict(items=[dict(id='W9', source='openalex', title='Mismatch study',
        url='https://openalex.org/W9', abstract='Observed under model mismatch.', authors=[])], warnings=[])))


class ProgramJobs(unittest.TestCase):
    def test_invalid_ready_result_is_terminal_and_does_not_block_new_work(self):
        from dataclasses import replace
        from paper_agent.model import digest
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            programs = ResearchPrograms(store)
            jobs = ResearchJobs(programs, worker=literature_fixture)
            self.addCleanup(jobs.close)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            plan = programs.command(acceptance.ResearchProgramsAcceptance.plan(paper), NOW)
            identity = digest(b'invalid-result')
            program = programs.read(plan['id'])
            programs.save(replace(program, jobIds=(identity,)))
            programs._write(programs.directory(program.id) / 'jobs' / identity / 'job.json',
                dict(id=identity, status='ready', input=dict(operation='search'),
                     result=dict(items=[dict(id='W9', source='openalex', title='', url='https://openalex.org/W9')]), error=''))
            request = dict(operation='poll', programId=program.id, jobId=identity)
            failed = jobs.command(request, NOW)
            self.assertEqual(failed['job']['status'], 'failed')
            self.assertTrue(failed['job']['error'])
            self.assertEqual(jobs.command(request, NOW), failed)
            pending = jobs.command(dict(operation='search', programId=program.id, operationId='recovery-search',
                expectedCheckpoint=failed['checkpoint'], query={'query': 'valid research', 'sources': ['openalex']}), NOW)
            self.assertEqual(pending['job']['status'], 'running')

    def test_lookup_is_counted_before_dispatch_and_poll_preserves_provenance(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            programs = ResearchPrograms(store)
            jobs = ResearchJobs(programs, worker=literature_fixture)
            programs.jobs = jobs
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            plan = programs.command(acceptance.ResearchProgramsAcceptance.plan(paper, limits={'searches': 1}), NOW)
            command = dict(operation='search', programId=plan['id'], expectedCheckpoint=plan['checkpoint'],
                           operationId='gap-search', query={'query': 'model mismatch counterevidence', 'sources': ['openalex']})
            try:
                pending = jobs.command(command, NOW)
                self.assertEqual(programs.read(plan['id']).usage.searches, 1)
                self.assertEqual(jobs.command(command, NOW)['job']['id'], pending['job']['id'])
                jobs.running[pending['job']['id']][1].join(timeout=10)
                self.assertFalse(jobs.running[pending['job']['id']][1].is_alive())
                complete = jobs.command(dict(operation='poll', programId=plan['id'], jobId=pending['job']['id']), NOW)
                self.assertEqual(complete['job']['status'], 'completed')
                self.assertEqual(complete['usage']['searches'], 1)
                found = next(c for c in complete['candidates'] if c['sourceId'] == 'W9')
                self.assertEqual(found['discoveries'][0]['batchId'], pending['job']['id'])
                self.assertEqual(found['decision'], 'pending')
                self.assertEqual(complete['rounds'], [])
                with self.assertRaises(Invalid):
                    jobs.command({**command, 'operationId': 'another', 'expectedCheckpoint': complete['checkpoint']}, NOW)
                self.assertEqual(programs.read(plan['id']).usage.searches, 1)
            finally:
                jobs.close()
