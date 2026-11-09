"""Missing-required waiver policy and immutable SQLite audit."""
import copy
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest
from test_catalog import draft, query
from catalog import CatalogStore, SubmissionConflict, StructuredTableDraft, RegistrationWaiver, _serialized, validate_attribute


class RegistrationWaiverTest(unittest.TestCase):
    def test_policy_and_immutable_replay(self):
        table = draft()
        table['rows'][0]['cells']['name'] = ''
        def waiver(value):
            return dict(policy='required-missing-v1', inputHash=sha256(_serialized(value).encode()).hexdigest(), reason='Pending measurement', attribution='Local researcher', issues=[dict(code='required', rowId='row-1', columnId='name')])
        approval = waiver(table)
        with tempfile.TemporaryDirectory() as directory:
            store = CatalogStore(Path(directory) / 'catalog.db')
            with self.assertRaises(ValueError):
                store.register(dict(submissionId='normal', table=table))
            payload = dict(submissionId='waived', table=table, waiver=approval)
            receipt = store.register(payload)
            self.assertEqual(store.register(payload), receipt)
            snapshot = store.lookup(query())
            self.assertEqual(snapshot['records'][0]['values']['name'], {'type': 'missing'})
            self.assertEqual(snapshot['records'][0]['waiver'], approval)
            validate_attribute('registrationTable', dict(table=table, receipts=[receipt]))
            validate_attribute('lookupTable', dict(query=query(), snapshot=snapshot))
            for key, value in [('reason', 'Different reason'), ('attribution', 'Different person')]:
                changed = copy.deepcopy(payload)
                changed['waiver'][key] = value
                with self.assertRaises(SubmissionConflict):
                    store.register(changed)
            invalid = []
            for patch in [dict(reason=''), dict(attribution=''), dict(policy='skip-all'), dict(inputHash='0'*64), dict(issues=[]), dict(issues=[dict(code='unit', rowId='row-1', columnId='name')])]:
                invalid.append(dict(payload, submissionId='bad', waiver={**approval, **patch}))
            supplied = copy.deepcopy(table)
            supplied['rows'][0]['cells']['name'] = 'Now supplied'
            invalid.append(dict(payload, table=supplied))
            malformed = copy.deepcopy(table)
            malformed['schema']['columns'].append(dict(id='mass', name='Mass', type='quantity', required=False, options=[], units=['mg']))
            malformed['rows'][0]['cells']['mass'] = '2 kg'
            invalid.append(dict(submissionId='bad', table=malformed, waiver=waiver(malformed)))
            for column_patch, raw in [
                (dict(type='decimal'), 'bad-number'),
                (dict(type='boolean'), 'yes'),
                (dict(type='date'), '2026-02-30'),
                (dict(type='object'), '[]'),
                (dict(type='text', options=['A']), 'B'),
            ]:
                bad = copy.deepcopy(table)
                bad['schema']['columns'].append({**dict(id='other', name='Other', type='text', required=False, options=[], units=[]), **column_patch})
                bad['rows'][0]['cells']['other'] = raw
                invalid.append(dict(submissionId='bad', table=bad, waiver=waiver(bad)))
            for change in ('schema', 'identity'):
                bad = copy.deepcopy(table)
                if change == 'schema':
                    bad['schema']['columns'][0]['units'] = ['mg']
                else:
                    bad['rows'][0]['id'] = 'invalid row!'
                invalid.append(dict(submissionId='bad', table=bad, waiver=waiver(bad)))
            for item in invalid:
                with self.subTest(item=item), self.assertRaises(ValueError):
                    store.register(item)
            self.assertEqual(store.lookup(query())['records'], snapshot['records'])
            tampered = copy.deepcopy(snapshot)
            tampered['records'][0]['waiver']['issues'][0]['columnId'] = 'unknown'
            with self.assertRaises(ValueError):
                validate_attribute('lookupTable', dict(query=query(), snapshot=tampered))
            restored = CatalogStore(Path(directory) / 'catalog.db')
            self.assertEqual(restored.register(payload), receipt)
