"""The persisted document boundary retains typed method bindings and their pins."""
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument
from store import EntryStore


def document():
    column = dict(id='volume', name='Volume', type='quantity', required=True, options=[], units=['mL'])
    table = dict(id='table', name='Amounts', schema=dict(id='schema', revision=2, columns=[column]), rows=[dict(id='sample', cells=dict(volume='2 mL'))])
    parameter = dict(id='amount', name='Amount', type='quantity', required=True, options=[], units=['mL'], version=1, stepId='prepare', source=dict(
        kind='table', blockId='amounts', tableId='table', rowId='sample', columnId='volume', schemaId='schema', schemaRevision=2, observedRevision=1, column=deepcopy(column), raw='2 mL'))
    computed = dict(id='total', name='Total', type='quantity', required=True, options=[], units=['mL'], version=1, stepId='dilute', source=dict(
        kind='formula', expression='=A1*2', unit='mL', bindings=[dict(procedureId='method', parameterId='amount', version=1, unit='mL')]))
    step = lambda identity: dict(id=identity, text='', level='step', critical=False, pause=False, completed=False, minutes=None)
    return dict(schemaVersion=1, title='Dilution', content=dict(type='doc', content=[dict(type='inputTable', attrs=dict(blockId='amounts', table=table, receipts=[]))]),
                procedures=[dict(id='method', title='Dilute', description='', materials=[], steps=[step('prepare'), step('dilute')], parameters=[parameter, computed])])


class ProcedureParameterContractTest(unittest.TestCase):
    def test_field_and_formula_snapshots_round_trip_reopen_and_preserve_revision_history(self):
        value = document()
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            entry = store.create(NotebookDocument.parse(value))
            changed = deepcopy(value)
            changed['procedures'][0]['parameters'][0]['source']['raw'] = '3 mL'
            changed['procedures'][0]['parameters'][0]['version'] = 2
            changed['procedures'][0]['steps'].reverse()
            store.commit(entry.identity, 1, lambda _: NotebookDocument.parse(changed))
            reopened = EntryStore(directory)
            self.assertEqual(reopened.read(entry.identity, 1).document.wire(), value)
            self.assertEqual(reopened.read(entry.identity).document.wire(), changed)

    def test_unresolved_inputs_are_saved_as_drafts_not_invented_results(self):
        value = document()
        value['procedures'][0]['steps'].pop(0)
        value['content']['content'][0]['attrs']['table']['rows'] = []
        source = value['procedures'][0]['parameters'][1]['source']
        source['expression'] = '=SUM('
        source['bindings'][0]['parameterId'] = 'deleted'
        self.assertEqual(NotebookDocument.parse(value).wire(), value)
        source['bindings'][0]['parameterId'] = 'total'
        self.assertEqual(NotebookDocument.parse(value).wire(), value, 'cycle can be edited and repaired without discarding the draft')

    def test_global_identity_source_and_version_boundaries(self):
        for patch in ({'version': 0}, {'version': True}, {'stepId': 'invalid id'}, {'source': None}, {'source': {'kind': 'remote'}}, {'extra': True}, {'id': 'amounts'}, {'id': 'prepare'}, {'id': 'method'}, {'id': 'total'}):
            value = document()
            value['procedures'][0]['parameters'][0].update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                NotebookDocument.parse(value)
        for field, bad in [('columnId', 'other'), ('schemaRevision', 0), ('observedRevision', True), ('rowId', 'bad id'), ('raw', 'x' * 4097), ('column', None), ('extra', True)]:
            value = document()
            value['procedures'][0]['parameters'][0]['source'][field] = bad
            with self.subTest(field=field), self.assertRaises(ValueError):
                NotebookDocument.parse(value)
        for patch in ({'version': 0}, {'unit': 3}, {'procedureId': 'bad id'}, {'parameterId': ''}, {'extra': True}):
            value = document()
            value['procedures'][0]['parameters'][1]['source']['bindings'][0].update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                NotebookDocument.parse(value)

    def test_bounded_lists_and_typed_literal_drafts(self):
        value = document()
        parameter = value['procedures'][0]['parameters'][0]
        parameter['source'] = dict(kind='literal', raw='unfinished quantity')
        self.assertEqual(NotebookDocument.parse(value).wire(), value)
        value['procedures'][0]['parameters'][1]['source']['bindings'] *= 26
        with self.assertRaises(ValueError):
            NotebookDocument.parse(value)
        value = document()
        value['procedures'][0]['parameters'] = [{**deepcopy(parameter), 'id': f'p{i}'} for i in range(101)]
        with self.assertRaises(ValueError):
            NotebookDocument.parse(value)
        value['procedures'][0]['parameters'].pop()
        self.assertEqual(len(NotebookDocument.parse(value).wire()['procedures'][0]['parameters']), 100)


if __name__ == '__main__':
    unittest.main()
