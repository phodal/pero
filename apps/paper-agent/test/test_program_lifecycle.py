"""Program intent and final reasons survive retries and execution projections."""
from datetime import datetime, timedelta
import tempfile
import unittest
import test_research_programs as acceptance
from test_research import NOW, reading
from paper_agent.model import Invalid, PaperSnapshot
from paper_agent.store import ResearchStore
from paper_agent.research_program_store import ResearchPrograms
from paper_agent.research_program_access import program_request
from paper_agent.research_jobs import ResearchJobs
from paper_agent.model import digest, ResearchRequest
from paper_agent.pdf import PdfDocument, PdfPage


class ProgramLifecycle(unittest.TestCase):
    def test_existing_store_capacity_stops_research_without_losing_exports(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            data = b'%PDF-1.4\nsynthetic stored fixture'
            store.save_pdf(PdfDocument.create(paper.id, digest(data), paper.url, (PdfPage(1, 600, 800, 'Observed method.'),), NOW), data)
            programs = ResearchPrograms(store)
            programs.jobs = ResearchJobs(programs)
            plan = programs.command(acceptance.ResearchProgramsAcceptance.plan(paper), NOW)
            for i in range(200):
                store.create_study(ResearchRequest.parse(dict(requestId=f'preexisting-{i}', question=f'Existing question {i}', paperIds=[paper.id], fullText=True)), NOW)
            program_request(programs, dict(operation='bind', programId=plan['id'], threadId='host-thread',
                protocolDigest=digest(plan['protocol'])), NOW, internal=True)
            result = program_request(programs, dict(operation='prepare-study', programId=plan['id'], threadId='host-thread',
                expectedCheckpoint=plan['checkpoint'], operationId='capacity', candidateIds=[plan['candidates'][0]['id']], question='Read the method'), NOW, internal=True)
            self.assertEqual(result['stopReason'], 'storage_capacity')
            self.assertEqual(store.pdf_bytes(store.paper_pdf(paper.id)), data)
            self.assertEqual(len(programs.command(dict(operation='export', programId=plan['id']), NOW)['documents']), 4)

    def test_expired_host_run_freezes_deadline_reason_and_final_artifacts(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            programs = ResearchPrograms(store)
            programs.jobs = ResearchJobs(programs)
            plan = programs.command(acceptance.ResearchProgramsAcceptance.plan(paper, minutes=1), NOW)
            program_request(programs, dict(operation='bind', programId=plan['id'], threadId='host-thread',
                protocolDigest=digest(plan['protocol'])), NOW, internal=True)
            later = (datetime.fromisoformat(NOW.replace('Z', '+00:00')) + timedelta(minutes=2)).isoformat().replace('+00:00', 'Z')
            result = program_request(programs, dict(operation='observe-run', programId=plan['id'], threadId='host-thread',
                status='failed', modelRequestsUsed=1, appCallsUsed=1), later, internal=True)
            self.assertEqual(result['stopReason'], 'deadline_reached')
            self.assertIn('deadline_reached', programs.command(dict(operation='export', programId=plan['id']), later)['documents'][0]['content'])
            with self.assertRaises(Invalid):
                program_request(programs, dict(operation='resume', programId=plan['id'], threadId='host-thread'), later, internal=True)

    def test_admission_preserves_hard_stops_and_admitted_recovery(self):
        from dataclasses import replace
        from paper_agent.research_program import ResearchProgram
        value = dict(requestId='admission', question='Question', scope='Scope',
            inclusion='Include', exclusion='Exclude', seedPaperIds=['a' * 64])
        program = ResearchProgram.create(value, NOW)
        for reason in ('user_stopped', 'no_progress', 'round_limit', 'ready_for_review'):
            stopped = replace(program, stopReason=reason)
            with self.subTest(reason=reason), self.assertRaises(Invalid):
                stopped.admit(stopped.checkpoint, NOW, finalizing=True)
            stopped.admit(stopped.checkpoint, NOW, finalizing=True, recovering=True)
        later = program.protocol.deadline
        program.admit(program.checkpoint, later, finalizing=True)
        deadline = replace(program, stopReason='deadline_reached')
        deadline.admit(deadline.checkpoint, later, finalizing=True)

    def test_create_retry_preserves_deadline_but_rejects_changed_allowance(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            programs = ResearchPrograms(store)
            request = acceptance.ResearchProgramsAcceptance.plan(paper, minutes=30)
            original = programs.command(request, NOW)
            later = (datetime.fromisoformat(NOW.replace('Z', '+00:00')) + timedelta(minutes=1)).isoformat().replace('+00:00', 'Z')
            retry = programs.command(request, later)
            self.assertEqual(original['checkpoint'], retry['checkpoint'])
            self.assertEqual(original['protocol']['deadline'], retry['protocol']['deadline'])
            with self.assertRaises(Invalid):
                programs.command({**request, 'minutes': 240}, later)
            stopped = programs.command(dict(operation='finish', programId=original['id'], expectedCheckpoint=original['checkpoint'],
                operationId='stop', reason='user_stopped'), NOW)
            with self.assertRaises(Invalid):
                programs.command(dict(operation='finish', programId=original['id'], expectedCheckpoint=stopped['checkpoint'],
                    operationId='reinterpret-stop', reason='ready_for_review'), NOW)
            self.assertEqual(programs.read(original['id']).stopReason, 'user_stopped')
