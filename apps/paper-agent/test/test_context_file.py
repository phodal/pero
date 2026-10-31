"""Selected context stays in a real UTF-8 file, outside the question budget."""
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest

from test_research import NOW, reading, request
from test_studies import source
from paper_agent.context_file import ContextSelection
from paper_agent.model import Invalid, PaperSnapshot
from paper_agent.store import ResearchStore


class ContextFiles(unittest.TestCase):
    def test_file_backed_context_survives_reload_and_reads_without_becoming_evidence(self):
        paper, document = source()
        content = '原始选段 β\r\n' + 'Long selected context. ' * 2000
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            store.save_paper(paper)
            store.save_pdf(document, b'fixture PDF bytes')
            context = store.save_context(ContextSelection(content, paper.id, document.id, 1))
            self.assertEqual(Path(context.path).read_bytes(), content.encode('utf-8'))
            self.assertTrue(Path(context.path).is_absolute())
            req = replace(request([paper], fullText=True), question='Q' * 2000, context_id=context.id)
            study = store.create_study(req, NOW)
            self.assertIn(context.path, study.prompt())
            self.assertNotIn(content, study.prompt())
            reopened = ResearchStore(root)
            self.assertEqual(reopened.study(study.id).context_file, context)
            result = reopened.study_step(dict(studyId=study.id, action='context', start=0), NOW)
            self.assertEqual(result['observation']['content'], content[:4800])
            self.assertEqual(result['observation']['nextStart'], 4800)
            self.assertEqual(result['budget']['used'], 0)
            self.assertEqual(reopened.study(study.id).passages, ())
            line = reopened.study_step(dict(studyId=study.id, action='context', startLine=1, endLine=1), NOW)
            self.assertEqual(line['observation']['content'], '原始选段 β\r\n')
            for payload in (dict(start=-1), dict(start=True), dict(start=len(content) + 1),
                            dict(start=0, startLine=1, endLine=1)):
                with self.subTest(payload=payload), self.assertRaises(Invalid):
                    reopened.study_step(dict(studyId=study.id, action='context', **payload), NOW)
            Path(context.path).write_text('Modified context', encoding='utf-8')
            with self.assertRaisesRegex(Invalid, 'integrity'):
                reopened.study_step(dict(studyId=study.id, action='context'), NOW)

    def test_abstract_input_references_file_and_rejects_foreign_context(self):
        paper = PaperSnapshot.from_reading(reading(), NOW)
        other = PaperSnapshot.from_reading(reading(sourceId='other', content='Other source.'), NOW)
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            store.save_paper(paper); store.save_paper(other)
            context = store.save_context(ContextSelection('Selection\n' * 1000, paper.id))
            req = replace(request([paper]), context_id=context.id)
            intent = store.prepare(req, NOW)
            self.assertEqual(intent.question, req.question)
            self.assertIn(context.path, intent.prompt())
            self.assertEqual(ResearchStore(root).intent(intent.id).context_file, context)
            followup = replace(request([paper]), request_id='file-followup', parent_intent_id=intent.id)
            next_input = store.prepare(followup, NOW)
            self.assertIn(context.path, next_input.prompt())
            self.assertEqual(next_input.conversation[0].context_file, context)
            with self.assertRaisesRegex(Invalid, 'outside'):
                store.prepare(replace(request([other]), context_id=context.id), NOW)
