"""Rich introduction and nested material trees share the actual storage boundary."""
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument
from store import EntryStore
from test_procedure_steps import protocol


def rich(identity, text='Recorded rich text'):
    return {'type': 'doc', 'content': [{'type': 'paragraph', 'attrs': {'blockId': identity},
            'content': [{'type': 'text', 'text': text, 'marks': [{'type': 'italic'}]}]}]}


def workspace():
    value = protocol()
    procedure = value['procedures'][0]
    procedure['description'] = 'obsolete introduction'
    procedure['introduction'] = rich('introduction', 'Cold handling')
    procedure['materials'] = [{'id': 'mixture', 'name': 'Mixture', 'quantity': '2 mL', 'content': rich('mixture-notes'), 'children': [
        {'id': 'buffer', 'name': 'Buffer', 'quantity': '1 mL', 'content': rich('buffer-notes', 'Keep on ice'), 'source': {
            'source': 'notebook-local-catalog', 'catalogId': 'catalog', 'recordId': 'registered', 'version': 3, 'schemaId': 'schema', 'schemaRevision': 2}}]}]
    return value


class RichWorkspaceTest(unittest.TestCase):
    def test_complete_workspace_reopens_and_old_revisions_remain_immutable(self):
        value = workspace()
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            entry = store.create(NotebookDocument.parse(value))
            changed = deepcopy(value)
            changed['procedures'][0]['materials'][0]['children'][0]['quantity'] = '3 mL'
            store.commit(entry.identity, 1, lambda _: NotebookDocument.parse(changed))
            reopened = EntryStore(directory)
            self.assertEqual(reopened.read(entry.identity, 1).document.wire(), value)
            self.assertEqual(reopened.read(entry.identity).document.wire(), changed)

    def test_material_bounds_and_pinned_source_boundary(self):
        for patch in ({'source': None}, {'source': {'source': 'external'}}, {'content': None}, {'content': {'type': 'script'}}, {'children': {}}, {'extra': True}):
            value = workspace()
            value['procedures'][0]['materials'][0].update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                NotebookDocument.parse(value)
        for field, bad in [('version', 0), ('version', True), ('recordId', 'bad id'), ('schemaRevision', 1.5), ('source', 'inventory')]:
            value = workspace()
            value['procedures'][0]['materials'][0]['children'][0]['source'][field] = bad
            with self.subTest(field=field, bad=bad), self.assertRaises(ValueError):
                NotebookDocument.parse(value)
        value = workspace()
        parent = value['procedures'][0]['materials'][0]
        for depth in range(2, 5):
            parent['children'] = [{'id': f'level{depth}', 'name': '', 'quantity': ''}]
            parent = parent['children'][0]
        NotebookDocument.parse(value)
        parent['children'] = [{'id': 'level5', 'name': '', 'quantity': ''}]
        with self.assertRaises(ValueError):
            NotebookDocument.parse(value)
        value = workspace()
        value['procedures'][0]['materials'][0]['children'] = [{'id': f'row{i}', 'name': '', 'quantity': ''} for i in range(100)]
        with self.assertRaises(ValueError):
            NotebookDocument.parse(value)

    def test_ids_and_rich_node_boundary_are_shared_across_all_trees(self):
        for identity in ['notes', 'procedure', 'header-body', 'timer', 'introduction', 'mixture', 'mixture-notes', 'buffer']:
            value = workspace()
            value['procedures'][0]['materials'][0]['children'][0]['content']['content'][0]['attrs']['blockId'] = identity
            with self.subTest(identity=identity), self.assertRaises(ValueError):
                NotebookDocument.parse(value)
        value = workspace()
        value['procedures'][0]['introduction']['content'][0]['content'][0]['marks'] = [{'type': 'link', 'attrs': {'href': 'javascript:alert(1)'}}]
        with self.assertRaises(ValueError):
            NotebookDocument.parse(value)

    def test_agent_reads_edits_and_saved_search_include_rich_materials_and_introduction(self):
        from agent_read import AgentRead
        from operations import apply_operations, parse_operations
        from saved_search import entry_search_text
        document = NotebookDocument.parse(workspace())
        for identity in ['introduction', 'mixture-notes', 'buffer-notes']:
            self.assertEqual(AgentRead(block_identity=identity).read(document)['block']['attrs']['blockId'], identity)
        changed = apply_operations(document, parse_operations([
            {'op': 'replace_text', 'blockId': 'buffer-notes', 'match': 'ice', 'replacement': 'cooling rack'},
            {'op': 'replace_text', 'blockId': 'introduction', 'match': 'Cold', 'replacement': 'Gentle'},
        ], lambda: 'fresh'))
        text = entry_search_text(changed)
        for expected in ['Gentle handling', 'cooling rack', 'registered', '1 mL']:
            self.assertIn(expected, text)
        self.assertNotIn('obsolete introduction', text)
        self.assertIn('Keep on ice', entry_search_text(document))

    def test_material_and_introduction_template_origins_cannot_be_changed_in_place(self):
        from templates import preserve_template_origins
        for path in [('introduction',), ('materials', 0, 'content'), ('materials', 0, 'children', 0, 'content')]:
            value = workspace()
            root = value['procedures'][0]
            for key in path:
                root = root[key]
            root['content'][0]['attrs']['templateOrigin'] = {'templateId': 'template', 'revision': 1, 'instanceId': 'instance', 'parameterValues': {}, 'idMap': {}}
            before = NotebookDocument.parse(value).wire()
            changed = deepcopy(before)
            target = changed['procedures'][0]
            for key in path:
                target = target[key]
            del target['content'][0]['attrs']['templateOrigin']
            with self.subTest(path=path), self.assertRaises(ValueError):
                preserve_template_origins(before, changed)
