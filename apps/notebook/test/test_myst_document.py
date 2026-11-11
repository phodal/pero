"""MyST is stored byte-for-byte as source without interpreting executable content."""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import scientific_block
from document import NotebookDocument
from myst_document import MystDocumentSource, MAX_MYST_SOURCE_BYTES
from store import EntryStore, RevisionConflict

SOURCE = '''---
title: 测量记录
plugins: ["https://example.invalid/plugin.js"]
---
(eq-energy)=
$$E=mc^2$$
See {eq}`eq-energy`.

```{code-cell} python
raise RuntimeError("This must never execute")
```

```{unknown-directive}
Keep all of this verbatim.
```
'''


def document(source=SOURCE):
    return {'schemaVersion': 1, 'title': 'MyST experiment', 'content': {'type': 'doc', 'content': [
        {'type': 'mystDocument', 'attrs': {'blockId': 'myst-1', 'schemaVersion': 1, 'source': source}},
    ]}}


class MystDocumentTests(unittest.TestCase):
    def test_source_survives_revision_replay_and_stale_save_without_execution(self):
        parsed = NotebookDocument.parse(document())
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            created = store.create(parsed)
            changed = document(SOURCE + '\nA later observation.\n')
            saved = store.commit(created.identity, 1, lambda _: NotebookDocument.parse(changed))
            self.assertEqual(saved.revision, 2)
            reopened = EntryStore(directory)
            self.assertEqual(reopened.read(created.identity, 1).document.wire(), document())
            self.assertEqual(reopened.read(created.identity).document.wire(), changed)
            with self.assertRaises(RevisionConflict):
                reopened.commit(created.identity, 1, lambda _: parsed)
            self.assertEqual(len(reopened.history(created.identity)), 2)

    def test_block_schema_size_and_execution_fields_are_rejected_before_storage(self):
        valid = document()['content']['content'][0]['attrs']
        MystDocumentSource.parse({**valid, 'source': 'a' * MAX_MYST_SOURCE_BYTES})
        invalid = [
            {**valid, 'schemaVersion': True}, {**valid, 'schemaVersion': 2},
            {**valid, 'source': None}, {**valid, 'source': '测' * (MAX_MYST_SOURCE_BYTES // 3 + 1)},
            {**valid, 'execute': True}, {**valid, 'plugins': ['external.js']},
            {**valid, 'permission': 'allow'}, {**valid, 'blockId': '../other'},
        ]
        for attrs in invalid:
            with self.subTest(attrs={key: value for key, value in attrs.items() if key != 'source'}):
                with self.assertRaises(ValueError):
                    NotebookDocument.parse({'schemaVersion': 1, 'title': 'Invalid', 'content': {
                        'type': 'doc', 'content': [{'type': 'mystDocument', 'attrs': attrs}]}})

    def test_unrelated_edit_preserves_malformed_and_nested_source_in_every_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            included = Path(directory) / 'included.md'
            included.write_text('PRIVATE INCLUDE CONTENT MUST NOT BE EXPANDED', encoding='utf-8')
            executed = Path(directory) / 'executed.txt'
            source = '\n'.join([
                '---', 'title: 原样保留', '---', '',
                '```{image}', ':width: invalid-width', '',
                'Unique malformed-image body.',
                '- Unique nested list item.',
                '  - Unique deeper list item.', '```', '',
                '::::{unknown-directive}', 'Unique unknown-directive prose.', '',
                ':::{note}', 'Unique nested note prose.', '',
                f'```{{include}} {included}', '```', ':::', '::::', '',
                '```{code-cell} python', 'from pathlib import Path',
                f'Path({str(executed)!r}).write_text("executed")', '```', '',
            ]).replace('\n', '\r\n')
            original = document(source)
            original['content']['content'].append({
                'type': 'paragraph', 'attrs': {'blockId': 'separate-prose'},
                'content': [{'type': 'text', 'text': 'Before unrelated edit.'}],
            })
            store = EntryStore(directory)
            created = store.create(NotebookDocument.parse(original))

            def edit_paragraph(current):
                changed = current.wire()
                changed['content']['content'][1]['content'][0]['text'] = 'After unrelated edit.'
                return NotebookDocument.parse(changed)

            saved = store.commit(created.identity, 1, edit_paragraph)
            self.assertEqual(saved.revision, 2)
            reopened = EntryStore(directory)
            for revision, paragraph in ((1, 'Before unrelated edit.'), (2, 'After unrelated edit.'),
                                        (None, 'After unrelated edit.')):
                with self.subTest(revision=revision):
                    persisted = reopened.read(created.identity, revision).document.wire()
                    blocks = persisted['content']['content']
                    self.assertEqual(blocks[0], original['content']['content'][0])
                    self.assertEqual(blocks[0]['attrs']['source'].encode('utf-8'), source.encode('utf-8'))
                    self.assertEqual(blocks[1]['content'][0]['text'], paragraph)
                    self.assertNotIn('PRIVATE INCLUDE CONTENT', blocks[0]['attrs']['source'])
            self.assertEqual(len(reopened.history(created.identity)), 2)
            self.assertFalse(executed.exists())
            self.assertEqual(included.read_text(encoding='utf-8'), 'PRIVATE INCLUDE CONTENT MUST NOT BE EXPANDED')

    def test_myst_document_has_no_reference_or_execution_capability(self):
        from scientific_block import BlockProposalStore, ProposeReference
        source = {'app': 'paper-agent', 'kind': 'report', 'id': 'report', 'version': 'v1', 'locator': ''}
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            proposals = BlockProposalStore(store)
            created = store.create(NotebookDocument.parse(document()))
            with self.assertRaisesRegex(ValueError, 'does not accept reference proposals'):
                proposals.propose(created.identity, 1, ProposeReference('proposal-1', 'myst-1', 'No execution', source))
            self.assertEqual(store.read(created.identity).revision, 1)


if __name__ == '__main__':
    unittest.main()
