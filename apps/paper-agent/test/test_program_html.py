"""Program approval remains explicit when reusing the official HTML owner."""
from dataclasses import replace
import tempfile
import unittest
import test_research_programs as acceptance
from test_scientific_document import SOURCE, URL
from test_paper_documents import HtmlTransport
from test_research import NOW
from paper_agent.model import PaperSnapshot, Invalid
from paper_agent.store import ResearchStore
from paper_agent.research_program_store import ResearchPrograms
from paper_agent.research_jobs import ResearchJobs
from paper_agent.paper_documents import prepare_html, PaperDocuments


def official_html_fixture(output, directory, value):
    prepare_html(output, directory, value['url'], value['paperId'], HtmlTransport(SOURCE, directory + '/calls'))


class ProgramHTML(unittest.TestCase):
    def test_program_html_approval_observation_and_report(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(dict(source='alphaxiv', sourceId=URL.rsplit('/', 1)[-1],
                title='Synthetic structured paper', url=URL.replace('/html/', '/abs/'), contentKind='abstract', content='Synthetic original abstract.'), NOW))
            programs = ResearchPrograms(store)
            jobs = ResearchJobs(programs, worker=official_html_fixture)
            programs.jobs = jobs
            plan = programs.command(acceptance.ResearchProgramsAcceptance.plan(paper, acquisition='public_fulltext'), NOW)
            try:
                started = jobs.command(dict(operation='acquire', representation='html', programId=plan['id'],
                    candidateId=plan['candidates'][0]['id'], expectedCheckpoint=plan['checkpoint'], operationId='html'), NOW)
                jobs.running[started['job']['id']][1].join(10)
                saved = jobs.command(dict(operation='poll', programId=plan['id'], jobId=started['job']['id']), NOW)
                self.assertEqual(saved['job']['status'], 'completed')
                candidate = saved['candidates'][0]
                document, original = PaperDocuments(store).read(candidate['htmlDocumentId'])
                self.assertEqual(original, SOURCE)
                self.assertEqual(document.paper_id, paper.id)
                receipt = PaperDocuments(store)._receipt(document.id)
                bundle = store.imports.bundle(saved['job']['input']['bundleId'])
                self.assertEqual(bundle.to_dict()['programAuthorization']['programId'], plan['id'])
                self.assertEqual(bundle.htmlDownloadIds, ())
                self.assertEqual(receipt['sourceDigest'], document.source.digest)
                block = next(b for b in document.blocks if b.kind == 'paragraph' and b.text.strip())
                command = dict(operation='source-step', programId=plan['id'], candidateId=candidate['id'],
                    expectedCheckpoint=saved['checkpoint'], operationId='html-read',
                    document=dict(operation='read', documentId=document.id, blockId=block.id, limit=4800))
                observed = programs.command(command, NOW)
                self.assertTrue(observed['result']['observationId'])
                self.assertEqual(observed['result']['bundleId'], bundle.id)
                self.assertEqual(observed['usage']['reads'], 1)
                report = programs.command(dict(operation='source-report', programId=plan['id'], expectedCheckpoint=observed['checkpoint'],
                    operationId='source-report', bundleId=bundle.id, title='Observed HTML', observationIds=[observed['result']['observationId']]), NOW)
                self.assertEqual(report['sourceReport']['verification'], 'tool_observed_scopes_only')
                claim = dict(sourceKind='html', text='Synthetic observation', stance='support', reportId=report['sourceReport']['id'],
                    paperId=paper.id, observationId=observed['result']['observationId'], documentId=document.id, blockId=block.id,
                    quote=observed['result']['content'])
                commit = dict(operation='commit-round', programId=plan['id'], expectedCheckpoint=report['checkpoint'], operationId='html-round',
                    question='What does the source say?', reportIds=[claim['reportId']], claims=[claim], gaps=['Verify independently'], nextAction='Search counterevidence')
                with self.assertRaises(Invalid):
                    programs.command({**commit, 'claims': [{**claim, 'quote': 'This claim was never observed.'}]}, NOW)
                completed = programs.command(commit, NOW)
                self.assertEqual(completed['rounds'][0]['claims'][0]['observationId'], claim['observationId'])
                self.assertNotIn('passageId', completed['rounds'][0]['claims'][0])
                exported = programs.command(dict(operation='export', programId=plan['id']), NOW)
                self.assertIn(document.source.url, exported['documents'][0]['content'])
                self.assertEqual(programs.command(command, NOW)['checkpoint'], observed['checkpoint'])
            finally:
                jobs.close()
