"""Research ledger rules: source scope, recoverable reading and explicit completion."""
from dataclasses import replace
import copy
import tempfile
import unittest

from test_research import NOW, reading, request
from paper_agent.model import Invalid, PaperSnapshot, PdfPassage
from paper_agent.pdf import PdfDocument, PdfPage
from paper_agent.studies import ResearchStudy, ResearchStep, StudyCommand, StudyAction, STEP_LIMIT
from paper_agent.store import ResearchStore


def source(content='Formal method. Exact original evidence.', source_id='study-fixture'):
    paper = PaperSnapshot.from_reading(reading(content=content, sourceId=source_id), NOW)
    document = PdfDocument.create(paper.id, ('1' if source_id == 'study-fixture' else '2') * 64,
                                  paper.url, (PdfPage(1, 600, 800, content),), NOW)
    return paper, document


def new_study(paper, document):
    return ResearchStudy.create(request([paper], fullText=True), (paper,), (document,), (), NOW)


def final_report(study, passage):
    return dict(schema='pero.paper-agent-report.v1', intentId=study.id, title='Evidence-based finding',
        sections=[dict(heading='Method', content='The source describes a formal method.', paperIds=[passage.paper_id],
            evidence=[dict(paperId=passage.paper_id, passageId=passage.id, quote=passage.content[:40])])],
        experiments=[], limitations='Reading only; exact location is not scientific verification.')


class ResearchStudies(unittest.TestCase):
    def test_reading_pagination_and_action_boundaries(self):
        content = ('Method and assumptions. ' * 400) + 'Final page condition.'
        paper, document = source(content)
        study = new_study(paper, document)
        invalid = [dict(action='read', paperId=paper.id, page=True),
                   dict(action='read', paperId=paper.id, page=2),
                   dict(action='read', paperId='0' * 64, page=1),
                   dict(action='read', paperId=paper.id, page=1, start=-1),
                   dict(action='read', paperId=paper.id, page=1, start=len(content) + 1),
                   dict(action='search', query='???'), dict(action='unknown'),
                   dict(action='note'), dict(action='note', text='one', unexpected=True)]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(Invalid):
                StudyCommand.parse(dict(studyId=study.id, **value), study)
        start, pieces = 0, []
        while start is not None:
            command = StudyCommand.parse(dict(studyId=study.id, action='read', paperId=paper.id, page=1, start=start), study)
            step = ResearchStep.read(study, command, document, NOW)
            self.assertEqual(step.page_length, len(content))
            pieces.extend(p.content for p in step.passages)
            for passage in step.passages:
                self.assertEqual(content[passage.start:passage.start + len(passage.content)], passage.content)
            start = step.next_start
            study = study.append(step)
        self.assertEqual(''.join(pieces), content)
        self.assertEqual(study.budget['used'], 3)
        self.assertIn('ResearchStudy', study.prompt())
        self.assertIn('formal methods', study.prompt())

    def test_line_reads_survive_restart_and_keep_pdf_citation_offsets(self):
        content = 'Title\r\n\r\nFormal method. Exact original evidence.\r\nLimitations.\n'
        paper, document = source(content)
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            store.save_paper(paper)
            store.save_pdf(document, b'fixture PDF bytes')
            study = store.create_study(request([paper], fullText=True), NOW)
            self.assertEqual(study.sources[0].pages[0].line_count, 4)
            result = store.study_step(dict(studyId=study.id, action='read', paperId=paper.id,
                                          page=1, startLine=3, endLine=3), NOW)
            self.assertEqual(result['observation']['nextLine'], 4)
            reopened = ResearchStore(root).study(study.id)
            step = reopened.steps[0]
            self.assertEqual((step.start_line, step.end_line), (3, 3))
            passage = step.passages[0]
            self.assertEqual(content[passage.start:passage.start + len(passage.content)], passage.content)
            with self.assertRaises(Invalid) as mismatch:
                StudyCommand.parse(dict(action='note', text='A source finding', evidence=[dict(
                    paperId=paper.id, passageId=passage.id, quote=passage.content.replace('\r\n', '\n'))]), reopened)
            self.assertIn(passage.id, str(mismatch.exception))
            self.assertIn('page 1', str(mismatch.exception))
            self.assertIn('recall', str(mismatch.exception))
            command = StudyCommand.parse(dict(studyId=study.id, action='finalize',
                                             report=final_report(reopened, passage)), reopened)
            self.assertEqual(command.report.sections[0].evidence[0].quote, passage.content[:40])
            for fields in (dict(startLine=1, endLine=2, start=0), dict(startLine=3),
                           dict(startLine=0, endLine=2)):
                with self.subTest(fields=fields), self.assertRaises(Invalid):
                    StudyCommand.parse(dict(studyId=study.id, action='read', paperId=paper.id,
                                            page=1, **fields), reopened)
            command = StudyCommand.parse(dict(studyId=study.id, action='read', paperId=paper.id,
                                             page=1, startLine=5, endLine=5), reopened)
            with self.assertRaises(Invalid):
                ResearchStep.read(reopened, command, document, NOW)

    def test_only_observed_exact_evidence_can_be_finalized(self):
        paper, document = source()
        study = new_study(paper, document)
        unread = PdfPassage.create(paper.id, document.id, document.file_digest, 1, 0, document.pages[0].text)
        with self.assertRaisesRegex(Invalid, 'Read or search'):
            StudyCommand.parse(dict(studyId=study.id, action='finalize', report=final_report(study, unread)), study)
        command = StudyCommand.parse(dict(studyId=study.id, action='read', paperId=paper.id, page=1), study)
        study = study.append(ResearchStep.read(study, command, document, NOW))
        valid = final_report(study, study.passages[0])
        forged = copy.deepcopy(valid)
        forged['sections'][0]['evidence'][0]['passageId'] = '0' * 64
        for value in (forged, {**valid, 'intentId': '0' * 64}):
            with self.subTest(value=value), self.assertRaises(Invalid):
                StudyCommand.parse(dict(studyId=study.id, action='finalize', report=value), study)
        finalized = StudyCommand.parse(dict(studyId=study.id, action='finalize', report=valid), study)
        self.assertEqual(finalized.intent.passages, study.passages)
        ref = valid['sections'][0]['evidence'][0]
        note = StudyCommand.parse(dict(studyId=study.id, action='note', text='Bounded finding',
                                       gaps=['No benchmark'], evidence=[ref]), study)
        self.assertEqual(note.evidence[0].locate(study.papers, study.passages)['quote'], ref['quote'])
        for count, action, allowed in [(22, StudyAction.NOTE, True), (23, StudyAction.READ, False),
                                       (23, StudyAction.FINALIZE, True), (24, StudyAction.FINALIZE, False)]:
            state = replace(study, steps=tuple(ResearchStep(study.id, i + 1, StudyAction.NOTE, NOW) for i in range(count)))
            with self.subTest(count=count, action=action):
                if allowed:
                    state.check_action(action)
                else:
                    with self.assertRaisesRegex(Invalid, 'budget'):
                        state.check_action(action)

    def test_frozen_sources_and_ledger_reopen_without_replay(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper, document = source()
            store.save_paper(paper)
            store.save_pdf(document, b'original PDF bytes')
            study = store.create_study(request([paper], fullText=True), NOW)
            self.assertEqual(store.create_study(study.request, 'later').id, study.id)
            with self.assertRaises(Invalid):
                store.create_study(replace(study.request, question='Changed input'), NOW)
            newer = PdfDocument.create(paper.id, '3' * 64, paper.url,
                                       (PdfPage(1, 600, 800, 'Changed replacement PDF content.'),), 'later')
            store.save_pdf(newer, b'new PDF bytes')
            searched = store.study_step(dict(studyId=study.id, action='search', query='Formal method'), NOW)
            passage = searched['observation']['passages'][0]
            self.assertEqual(passage['documentId'], document.id)
            self.assertNotIn('prompt', searched)
            self.assertEqual(store.study_view(study.id)['prompt'], study.prompt())
            continued = store.continue_study(study.id, 'continued-session', NOW)
            self.assertEqual(continued['sessionId'], 'app:paper-agent:continued-session')
            self.assertEqual(continued['budget']['used'], 1)
            self.assertNotEqual(continued['prompt'], study.prompt())
            reopened = ResearchStore(root)
            self.assertEqual(reopened.study_view(study.id), continued)
            reopened.study_step(dict(studyId=study.id, action='note', gaps=['Need the method']), NOW)
            self.assertEqual(reopened.study(study.id).gaps, ('Need the method',))
            reopened.study_step(dict(studyId=study.id, action='note', text='Method checked'), NOW)
            self.assertEqual(reopened.study(study.id).gaps, ('Need the method',))
            reopened.study_step(dict(studyId=study.id, action='note', gaps=[]), NOW)
            self.assertEqual(reopened.study(study.id).gaps, ())
            self.assertEqual(reopened.study_view(study.id)['prompt'], continued['prompt'])
            command = dict(studyId=study.id, action='finalize', report=final_report(study, PdfPassage.from_record(passage)))
            finalized = reopened.study_step(command, NOW)
            saved = reopened.report(finalized['reportId'])
            self.assertEqual(saved.session_id, 'app:paper-agent:continued-session')
            self.assertEqual(reopened.study_view(study.id)['report']['id'], saved.id)
            self.assertEqual(len(reopened.library()['studies']), 1)
            self.assertEqual(reopened.intent(study.id).passages[0].document_id, document.id)
            self.assertEqual(reopened.intent(study.id).frozen_prompt, continued['prompt'])
            for value in (dict(studyId=study.id, action='search', query='method'),
                          dict(studyId=study.id, action='recall', passageId=passage['id']), command):
                with self.assertRaisesRegex(Invalid, 'already has'):
                    reopened.study_step(value, NOW)
            near_limit = reopened.create_study(replace(study.request, request_id='near-limit-research'), NOW)
            for _ in range(STEP_LIMIT - 1):
                observed = reopened.study_step(dict(studyId=near_limit.id, action='read', paperId=paper.id, page=1), NOW)
            remaining = reopened.continue_study(near_limit.id, 'near-limit-resumed', NOW)
            self.assertEqual(remaining['findings'], [])
            self.assertEqual(remaining['budget']['remaining'], 1)
            known = observed['observation']['passages'][0]
            self.assertIn(known['id'], remaining['prompt'])
            self.assertIn('recall', remaining['prompt'])
            for command in (dict(action='read', paperId=paper.id, page=1),
                            dict(action='recall', passageId='0' * 64)):
                with self.subTest(command=command), self.assertRaises(Invalid):
                    reopened.study_step(dict(studyId=near_limit.id, **command), NOW)
            recalled = reopened.study_step(dict(studyId=near_limit.id, action='recall', passageId=known['id']), NOW)
            self.assertEqual(recalled['observation']['passages'], [known])
            self.assertEqual(recalled['observation']['locator']['documentId'], newer.id)
            self.assertEqual(recalled['budget']['used'], STEP_LIMIT - 1)
            completed = reopened.study_step(dict(studyId=near_limit.id, action='finalize',
                report=final_report(near_limit, PdfPassage.from_record(known))), NOW)
            self.assertEqual(completed['budget']['used'], STEP_LIMIT)
            self.assertIsNotNone(completed['reportId'])


if __name__ == '__main__':
    unittest.main()
