"""Autonomous research acceptance: durable intent and observed-source progress."""
import hashlib
import tempfile
import unittest

from test_research import NOW, reading
from test_studies import final_report
from paper_agent.discovery import DiscoveryBatch, DiscoveryPaper
from paper_agent.model import Invalid, PaperSnapshot, PdfPassage, digest
from paper_agent.pdf import PdfDocument, PdfPage
from paper_agent.store import ResearchStore
from paper_agent.research_program_store import ResearchPrograms


class ResearchProgramsAcceptance(unittest.TestCase):
    @staticmethod
    def plan(paper, **changes):
        return {**dict(
            operation='create', requestId='autonomous-fixture',
            question='Does the method hold under model mismatch?',
            scope='Original studies of model mismatch',
            inclusion='Methods and original observations',
            exclusion='Unattributed summaries', seedPaperIds=[paper.id],
            acquisition='saved_only',
            limits=dict(rounds=3, searches=8, candidates=24, reads=18),
            noProgressLimit=2,
        ), **changes}

    def test_saved_plan_reopens_without_reading_or_granting_execution(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            command = self.plan(paper)
            saved = ResearchPrograms(store).command(command, NOW)
            reopened_store = ResearchStore(root)
            reopened = ResearchPrograms(reopened_store).command(
                dict(operation='read', programId=saved['id']), NOW)

            self.assertEqual(reopened['checkpoint'], saved['checkpoint'])
            for field in ('question', 'scope', 'inclusion', 'exclusion',
                          'seedPaperIds', 'acquisition', 'noProgressLimit'):
                self.assertEqual(reopened['protocol'][field], command[field])
            for resource, limit in command['limits'].items():
                self.assertEqual(reopened['protocol']['limits'][resource], limit)
            for resource in ('rounds', 'searches', 'reads'):
                self.assertEqual(reopened['usage'][resource], 0)
            self.assertEqual(reopened['acceptance'], 'needs_review')
            self.assertEqual(reopened['rounds'], [])
            self.assertEqual(reopened_store.library()['reports'], [])
            self.assertEqual(reopened_store.library()['studies'], [])

    def test_candidate_keeps_discovery_paths_and_operation_replay(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            seed = store.save_paper(PaperSnapshot.from_reading(
                reading(source='openalex', sourceId='W1'), NOW))
            programs = ResearchPrograms(store)
            created = programs.command(self.plan(seed), NOW)
            original_ids = {candidate['id'] for candidate in created['candidates']}
            seed_work = DiscoveryPaper('W1', 'Seed method', 'https://openalex.org/W1',
                                       (), 'Seed abstract', '2026-01-01', 0)
            work = DiscoveryPaper('W2', 'Model mismatch', 'https://doi.org/10.1234/mismatch',
                                  (), 'A model mismatch counterexample.', '2026-01-02', 0,
                                  doi='https://doi.org/10.1234/mismatch')
            state = created
            batches = []
            first_command = None
            first_result = None
            for index, relation in enumerate(('related', 'references')):
                batch = store.save_discovery(DiscoveryBatch(seed.id, seed.title, relation,
                    seed_work, (work,), 1, False, NOW, 'identifier'))
                batches.append(batch.id)
                command = dict(operation='adopt-discovery', programId=created['id'],
                    expectedCheckpoint=state['checkpoint'], operationId=f'discovery-{index}', batchId=batch.id)
                state = programs.command(command, NOW)
                if first_command is None:
                    first_command, first_result = command, state

            discovered = [candidate for candidate in state['candidates'] if candidate['id'] not in original_ids]
            self.assertEqual(len(discovered), 1)
            candidate = discovered[0]
            self.assertEqual(candidate['decision'], 'pending')
            self.assertEqual({entry['batchId'] for entry in candidate['discoveries']}, set(batches))
            self.assertEqual({entry['relation'] for entry in candidate['discoveries']}, {'related', 'references'})
            self.assertEqual(state['usage']['searches'], 2)
            self.assertEqual(programs.command(first_command, NOW), first_result)
            with self.assertRaises(Invalid):
                programs.command({**first_command, 'batchId': batches[1]}, NOW)
            current = ResearchPrograms(ResearchStore(root)).command(dict(operation='read', programId=created['id']), NOW)
            self.assertEqual(current['checkpoint'], state['checkpoint'])
            self.assertEqual(current['usage']['searches'], 2)

            screened = programs.command(dict(operation='screen', programId=created['id'],
                expectedCheckpoint=state['checkpoint'], operationId='screen-mismatch',
                candidateId=candidate['id'], decision='include', reason='Tests the named model-mismatch gap'), NOW)
            selected = next(item for item in screened['candidates'] if item['id'] == candidate['id'])
            self.assertEqual(selected['decision'], 'include')
            self.assertEqual(selected['reason'], 'Tests the named model-mismatch gap')
            self.assertEqual(screened['acceptance'], 'needs_review')
            with self.assertRaises(Invalid):
                programs.command(dict(operation='screen', programId=created['id'],
                    expectedCheckpoint=state['checkpoint'], operationId='stale-screen',
                    candidateId=candidate['id'], decision='exclude', reason='Stale decision'), NOW)

    def test_round_requires_observed_report_evidence_and_keeps_review_pending(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            pdf_bytes = b'synthetic original PDF fixture'
            document = PdfDocument.create(paper.id, digest(pdf_bytes), paper.url,
                (PdfPage(1, 600, 800, 'Formal method.\r\nExact original evidence.\r\n'),), NOW)
            store.save_pdf(document, pdf_bytes)
            programs = ResearchPrograms(store)
            state = programs.command(self.plan(paper), NOW)

            def perform(operation, identity, **fields):
                return programs.command(dict(operation=operation, operationId=identity,
                    programId=state['id'], expectedCheckpoint=state['checkpoint'], **fields), NOW)

            state = perform('prepare-study', 'prepare-seed',
                candidateIds=[state['candidates'][0]['id']], question='What does the method assume?')
            study_id = state['study']['id']
            state = perform('study-step', 'read-seed',
                document=dict(studyId=study_id, action='read', paperId=paper.id, page=1, start=0))
            observation = state['result']['observation']['passages'][0]
            passage = PdfPassage.from_record(observation)
            report = final_report(store.study(study_id), passage)
            report['sections'][0]['evidence'] = [dict(paperId=paper.id, passageId=passage.id,
                                                    startLine=1, endLine=2)]
            state = perform('study-step', 'finalize-seed', document=dict(studyId=study_id,
                action='finalize', report=report))
            report_id = state['result']['reportId']
            retained = ResearchPrograms(ResearchStore(root)).command(dict(operation='read', programId=state['id']), NOW)
            self.assertEqual(retained['rounds'], [])
            self.assertEqual(retained['studies'][0]['reportId'], report_id)
            self.assertEqual(retained['studies'][0]['id'], study_id)
            claim = dict(text='The source describes a formal method.', stance='support',
                         reportId=report_id, paperId=paper.id, passageId=passage.id)
            before = state['checkpoint']
            for field, fabricated in (('reportId', 'f' * 64), ('paperId', 'e' * 64),
                                      ('passageId', 'd' * 64), ('quote', 'Invented evidence')):
                with self.subTest(field=field), self.assertRaises(Invalid):
                    perform('commit-round', 'invalid-' + field, question='What does the method assume?',
                        reportIds=[report_id], claims=[{**claim, field: fabricated}],
                        gaps=['Model mismatch remains untested'], nextAction='Find model mismatch counterexamples')
                current = programs.command(dict(operation='read', programId=state['id']), NOW)
                self.assertEqual(current['checkpoint'], before)
                self.assertEqual(current['usage']['rounds'], 0)

            state = perform('commit-round', 'round-one', question='What does the method assume?',
                reportIds=[report_id], claims=[claim], gaps=['Model mismatch remains untested'],
                nextAction='Find model mismatch counterexamples')
            self.assertEqual(state['usage']['rounds'], 1)
            self.assertGreater(state['usage']['reads'], 0)
            self.assertEqual(state['acceptance'], 'needs_review')
            self.assertEqual(len(state['rounds']), 1)
            self.assertEqual(state['rounds'][0]['claims'][0]['quote'], passage.content)
            restored = ResearchPrograms(ResearchStore(root)).command(dict(operation='read', programId=state['id']), NOW)
            self.assertEqual(restored['rounds'], state['rounds'])
            self.assertEqual(restored['usage'], state['usage'])

    def test_read_budget_survives_a_new_study_and_store_restart(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            pdf_bytes = b'budget original PDF fixture'
            document = PdfDocument.create(paper.id, digest(pdf_bytes), paper.url,
                (PdfPage(1, 600, 800, 'Formal method. Exact original evidence.'),), NOW)
            store.save_pdf(document, pdf_bytes)
            programs = ResearchPrograms(store)
            state = programs.command(self.plan(paper,
                limits=dict(rounds=3, searches=8, candidates=24, reads=1)), NOW)
            candidate_id = state['candidates'][0]['id']
            state = programs.command(dict(operation='prepare-study', operationId='budget-study-one',
                programId=state['id'], expectedCheckpoint=state['checkpoint'],
                candidateIds=[candidate_id], question='Read the original method'), NOW)
            first_study = state['study']['id']
            state = programs.command(dict(operation='study-step', operationId='only-read',
                programId=state['id'], expectedCheckpoint=state['checkpoint'],
                document=dict(studyId=first_study, action='read', paperId=paper.id, page=1)), NOW)
            self.assertEqual(state['usage']['reads'], 1)
            state = programs.command(dict(operation='prepare-study', operationId='budget-study-two',
                programId=state['id'], expectedCheckpoint=state['checkpoint'],
                candidateIds=[candidate_id], question='Read model mismatch conditions'), NOW)
            second_study = state['study']['id']
            self.assertNotEqual(first_study, second_study)

            for restart in (False, True):
                with self.subTest(restart=restart):
                    current_store = ResearchStore(root) if restart else store
                    programs = ResearchPrograms(current_store)
                    current = programs.command(dict(operation='read', programId=state['id']), NOW)
                    with self.assertRaises(Invalid):
                        programs.command(dict(operation='study-step', operationId=f'exhausted-read-{restart}',
                            programId=state['id'], expectedCheckpoint=current['checkpoint'],
                            document=dict(studyId=second_study, action='read', paperId=paper.id, page=1)), NOW)
                    after = programs.command(dict(operation='read', programId=state['id']), NOW)
                    self.assertEqual(after['usage']['reads'], 1)
                    self.assertEqual(current_store.study(second_study).passages, ())

    def test_export_keeps_exact_checkpoint_bytes_and_rejects_foreign_checkpoint(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            programs = ResearchPrograms(store)
            created = programs.command(self.plan(paper), NOW)
            export_command = dict(operation='export', programId=created['id'], checkpoint=created['checkpoint'])
            first = programs.command(export_command, NOW)
            self.assertEqual(len(first['documents']), 4)
            self.assertEqual(len({doc['slot'] for doc in first['documents']}), 4)
            for document in first['documents']:
                self.assertEqual(hashlib.sha256(document['content'].encode('utf-8')).hexdigest(),
                                 document['sha256'].removeprefix('sha256:'))

            reason = 'Retain this work as the original model-mismatch seed'
            screened = programs.command(dict(operation='screen', programId=created['id'],
                expectedCheckpoint=created['checkpoint'], operationId='export-screen',
                candidateId=created['candidates'][0]['id'], decision='include', reason=reason), NOW)
            reopened = ResearchPrograms(ResearchStore(root))
            self.assertEqual(reopened.command(export_command, NOW), first)
            latest = reopened.command(dict(operation='export', programId=created['id'], checkpoint=screened['checkpoint']), NOW)
            self.assertIn(reason, '\n'.join(doc['content'] for doc in latest['documents']))
            self.assertNotIn(reason, '\n'.join(doc['content'] for doc in first['documents']))
            self.assertIn('needs_review', '\n'.join(doc['content'] for doc in latest['documents']))

            foreign = reopened.command(self.plan(paper, requestId='another-program', question='A separate research question'), NOW)
            for checkpoint in ('f' * 64, foreign['checkpoint']):
                with self.subTest(checkpoint=checkpoint), self.assertRaises(Invalid):
                    reopened.command(dict(operation='export', programId=created['id'], checkpoint=checkpoint), NOW)

    def test_three_rounds_follow_saved_gaps_and_stop_at_the_program_limit(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            pages = (
                'The synthetic method assumes a fixed model.',
                'Model mismatch causes the synthetic method to fail.',
                'An adaptive correction restores the synthetic result under bounded mismatch.',
            )
            pdf_bytes = b'three-round original PDF fixture'
            document = PdfDocument.create(paper.id, digest(pdf_bytes), paper.url,
                tuple(PdfPage(index, 600, 800, content) for index, content in enumerate(pages, 1)), NOW)
            store.save_pdf(document, pdf_bytes)
            programs = ResearchPrograms(store)
            state = programs.command(self.plan(paper), NOW)
            candidate_id = state['candidates'][0]['id']
            next_gaps = ('Does the method tolerate model mismatch?',
                         'Which bounded correction restores the result?',
                         'Independent replication beyond this fixture remains missing.')
            source_passages = []
            study_questions = []

            def perform(operation, identity, **fields):
                return programs.command(dict(operation=operation, operationId=identity,
                    programId=state['id'], expectedCheckpoint=state['checkpoint'], **fields), NOW)

            for index, content in enumerate(pages, 1):
                question = ('What does the source assume?' if index == 1
                            else state['rounds'][-1]['gaps'][0])
                state = perform('prepare-study', f'journey-prepare-{index}',
                    candidateIds=[candidate_id], question=question)
                study_id = state['study']['id']
                study_questions.append(store.study(study_id).request.question)
                state = perform('study-step', f'journey-read-{index}',
                    document=dict(studyId=study_id, action='read', paperId=paper.id, page=index))
                passage = PdfPassage.from_record(state['result']['observation']['passages'][0])
                source_passages.append(passage.id)
                report = final_report(store.study(study_id), passage)
                report['sections'][0]['content'] = content
                state = perform('study-step', f'journey-finalize-{index}',
                    document=dict(studyId=study_id, action='finalize', report=report))
                report_id = state['result']['reportId']
                state = perform('commit-round', f'journey-round-{index}', question=question,
                    reportIds=[report_id], claims=[dict(text=content,
                        stance='counterevidence' if index == 2 else 'support',
                        reportId=report_id, paperId=paper.id, passageId=passage.id)],
                    gaps=[next_gaps[index - 1]], nextAction=next_gaps[index - 1])

            self.assertEqual(study_questions, ['What does the source assume?', *next_gaps[:2]])
            self.assertEqual(len(set(source_passages)), 3)
            self.assertEqual(state['usage']['rounds'], 3)
            self.assertEqual(state['stopReason'], 'round_limit')
            self.assertEqual(state['acceptance'], 'needs_review')
            reopened = ResearchPrograms(ResearchStore(root))
            restored = reopened.command(dict(operation='read', programId=state['id']), NOW)
            self.assertEqual(restored['usage'], state['usage'])
            self.assertEqual(restored['stopReason'], 'round_limit')
            exported = reopened.command(dict(operation='export', programId=state['id'],
                                             checkpoint=state['checkpoint']), NOW)
            delivered = '\n'.join(item['content'] for item in exported['documents'])
            for passage_id in source_passages:
                self.assertIn(passage_id, delivered)
            for question in study_questions:
                self.assertIn(question, delivered)
            self.assertIn('round_limit', delivered)
            self.assertIn('needs_review', delivered)

    def test_repeated_evidence_cannot_reset_the_no_progress_limit(self):
        for reread, requote, reword in ((False, False, False), (True, False, False), (True, True, False), (False, False, True)):
            with self.subTest(new_report_same_observation=reread, different_quote=requote, reworded_screening=reword), tempfile.TemporaryDirectory() as root:
                store = ResearchStore(root)
                paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
                pdf_bytes = b'no-progress original PDF fixture'
                document = PdfDocument.create(paper.id, digest(pdf_bytes), paper.url,
                    (PdfPage(1, 600, 800, 'Formal method. Exact original evidence.'),), NOW)
                store.save_pdf(document, pdf_bytes)
                programs = ResearchPrograms(store)
                state = programs.command(self.plan(paper,
                    limits=dict(rounds=6, searches=8, candidates=24, reads=18), noProgressLimit=2), NOW)
                candidate_id = state['candidates'][0]['id']
                report_ids = []
                passage_ids = []

                def perform(operation, identity, **fields):
                    return programs.command(dict(operation=operation, operationId=identity,
                        programId=state['id'], expectedCheckpoint=state['checkpoint'], **fields), NOW)

                for index in range(1, 4):
                    if reword:
                        state = perform('screen', f'reword-{index}', candidateId=candidate_id,
                            decision='include', reason=f'Same included source, explanation {index}')
                    if index == 1 or reread:
                        state = perform('prepare-study', f'repeat-prepare-{index}',
                            candidateIds=[candidate_id], question='What assumptions are documented?')
                        study_id = state['study']['id']
                        state = perform('study-step', f'repeat-read-{index}',
                            document=dict(studyId=study_id, action='read', paperId=paper.id, page=1))
                        passage = PdfPassage.from_record(state['result']['observation']['passages'][0])
                        report = final_report(store.study(study_id), passage)
                        if requote:
                            report['sections'][0]['evidence'][0]['quote'] = passage.content[:40 - index]
                        state = perform('study-step', f'repeat-finalize-{index}',
                            document=dict(studyId=study_id, action='finalize', report=report))
                        report_id = state['result']['reportId']
                    report_ids.append(report_id)
                    passage_ids.append(passage.id)
                    state = perform('commit-round', f'repeat-round-{index}',
                        question='What assumptions are documented?', reportIds=[report_id],
                        claims=[dict(text='The source describes a formal method.', stance='support',
                            reportId=report_id, paperId=paper.id, passageId=passage.id)],
                        gaps=['Independent replication is still missing'],
                        nextAction='Locate independent replication')
                    if index < 3:
                        self.assertFalse(state['stopReason'])

                self.assertEqual(len(set(passage_ids)), 1)
                self.assertEqual(len(set(report_ids)), 3 if reread else 1)
                self.assertEqual(state['usage']['rounds'], 3)
                self.assertEqual(state['stopReason'], 'no_progress')
                with self.assertRaises(Invalid):
                    perform('prepare-study', 'after-no-progress', candidateIds=[candidate_id],
                            question='Read the same source again')
                restored = ResearchPrograms(ResearchStore(root)).command(
                    dict(operation='read', programId=state['id']), NOW)
                self.assertEqual(restored['stopReason'], 'no_progress')
                self.assertEqual(restored['usage'], state['usage'])


if __name__ == '__main__':
    unittest.main()
