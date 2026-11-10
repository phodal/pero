"""Exact local persistence/JSON exchange, bounded lineage and hash integrity (not raster replay)."""
import base64
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument
from store import EntryStore


def file(raw, name='image.png'):
    return dict(filename=name, mime='image/png', data=base64.b64encode(raw).decode(), sha256=sha256(raw).hexdigest())


def fixture():
    original, intermediate, output = file(b'original'), file(b'first edit'), file(b'second edit')
    edit = dict(x=2, y=0, width=2, height=2, outputWidth=4, outputHeight=2, rotation=90)
    steps = [dict(source=original, sourceWidth=4, sourceHeight=2, edit=edit, outputSha256=intermediate['sha256']),
             dict(source=intermediate, sourceWidth=2, sourceHeight=4, edit=dict(x=0, y=0, width=2, height=4, outputWidth=2, outputHeight=2, rotation=0), outputSha256=output['sha256'])]
    return dict(schemaVersion=1, title='Retained image', content=dict(type='doc', content=[dict(type='attachment', attrs={
        **output, 'blockId': 'image', 'caption': 'Observed', 'derivation': dict(version=1, steps=steps)})]))


class ImageDerivationTests(unittest.TestCase):
    def test_save_reopen_export_import_and_revision_restore_keep_exact_bytes_and_parameters(self):
        value = fixture()
        document = NotebookDocument.parse(value)
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(Path(directory) / 'original')
            saved = store.create(document)
            reloaded = EntryStore(Path(directory) / 'original').read(saved.identity)
            self.assertEqual(reloaded.document.wire(), value)
            exported = Path(directory) / 'notebook.json'
            exported.write_text(reloaded.document.serialized(), encoding='utf-8')
            imported = EntryStore(Path(directory) / 'imported').create(NotebookDocument.parse(json.loads(exported.read_text(encoding='utf-8'))))
            self.assertEqual(imported.document.wire(), value)
            self.assertEqual(imported.document.block('image')['attrs']['derivation']['steps'][0]['source']['data'], base64.b64encode(b'original').decode())
            removed = dict(schemaVersion=1, title='Removed image', content=dict(type='doc', content=[dict(type='paragraph')]))
            store.commit(saved.identity, 1, lambda _old: NotebookDocument.parse(removed))
            old = store.read(saved.identity, 1)
            restored = store.commit(saved.identity, 2, lambda _current: old.document)
            self.assertEqual(restored.document.wire(), value)
            self.assertEqual(store.read(saved.identity, 1).document.wire(), value)

    def test_bad_hashes_chains_dimensions_and_metadata_are_rejected(self):
        def at(value, path, item):
            target = value['content']['content'][0]['attrs']
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = item
        cases = [
            (['data'], base64.b64encode(b'tampered current').decode()),
            (['derivation', 'steps', 0, 'source', 'data'], base64.b64encode(b'tampered original').decode()),
            (['derivation', 'steps', 1, 'source', 'data'], base64.b64encode(b'tampered intermediate').decode()),
            (['derivation', 'steps', 0, 'outputSha256'], '0' * 64),
            (['derivation', 'steps', 1, 'outputSha256'], '0' * 64),
            (['derivation', 'steps', 1, 'sourceWidth'], 4),
            (['derivation', 'steps', 0, 'sourceWidth'], True),
            (['derivation', 'steps', 0, 'sourceHeight'], 8193),
            (['derivation', 'steps', 0, 'source', 'filename'], '../image.png'),
            (['derivation', 'steps', 0, 'source', 'mime'], 'image/svg+xml'),
            (['derivation', 'steps', 0, 'source', 'url'], 'https://example.com/image'),
            (['derivation', 'steps', 0, 'edit', 'x'], 3),
            (['derivation', 'steps', 0, 'edit', 'rotation'], 45),
            (['derivation', 'steps', 0, 'edit', 'width'], 0),
            (['derivation', 'steps', 0, 'edit', 'filter'], 'remote'),
            (['derivation', 'steps'], []),
            (['derivation', 'version'], True),
            (['derivation', 'version'], 2),
            (['derivation', 'attested'], True),
            (['mime'], 'text/plain'),
        ]
        for path, item in cases:
            with self.subTest(path=path):
                value = fixture()
                at(value, path, item)
                with self.assertRaises(ValueError):
                    NotebookDocument.parse(value)

    def test_source_history_byte_and_step_limits_are_not_silent_truncation(self):
        value = fixture()
        attrs = value['content']['content'][0]['attrs']
        source = file(b'a' * (512 * 1024))
        source['caption'] = attrs['caption']
        attrs.update(source)
        identity = dict(x=0, y=0, width=1, height=1, outputWidth=1, outputHeight=1, rotation=0)
        step = dict(source={key: source[key] for key in ('filename', 'mime', 'data', 'sha256')}, sourceWidth=1, sourceHeight=1, edit=identity, outputSha256=source['sha256'])
        attrs['derivation']['steps'] = [step]
        self.assertEqual(NotebookDocument.parse(value).wire(), value)
        attrs['derivation']['steps'] = [step, step]
        with self.assertRaisesRegex(ValueError, '512 KiB'):
            NotebookDocument.parse(value)
        small = file(b'small')
        attrs.update(small)
        step.update(source=small, outputSha256=small['sha256'])
        attrs['derivation']['steps'] = [deepcopy(step) for _ in range(8)]
        NotebookDocument.parse(value)
        attrs['derivation']['steps'].append(deepcopy(step))
        with self.assertRaisesRegex(ValueError, 'length'):
            NotebookDocument.parse(value)

    def test_legacy_attachments_and_null_history_still_import_without_invented_history(self):
        value = fixture()
        attrs = value['content']['content'][0]['attrs']
        del attrs['derivation']
        self.assertEqual(NotebookDocument.parse(value).wire(), value)
        attrs['derivation'] = None
        self.assertEqual(NotebookDocument.parse(value).wire(), value)
        # Record integrity is intentionally not a claim that a renderer replayed the edit.
        changed_edit = fixture()
        changed_edit['content']['content'][0]['attrs']['derivation']['steps'][0]['edit']['x'] = 0
        self.assertEqual(NotebookDocument.parse(changed_edit).wire(), changed_edit)


if __name__ == '__main__':
    unittest.main()
