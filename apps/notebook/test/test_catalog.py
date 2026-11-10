"""Typed draft contracts and real SQLite catalog submission/query semantics."""
from contextlib import closing
import copy
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from catalog import CatalogStore, SchemaConflict, StructuredColumn, StructuredTableDraft, SubmissionConflict, validate_attribute
from store import EntryStore


FIXTURES = Path(__file__).resolve().parents[3] / 'packages/notebook/test/fixtures/structured-table-contract.json'


def column(**patch):
    return {'id': 'name', 'name': 'Name', 'type': 'text', 'required': True, 'options': [], 'units': [], **patch}


def draft():
    return {'id': 'table-1', 'name': '样品 😀', 'schema': {'id': 'schema-1', 'revision': 1, 'columns': [column()]},
            'rows': [{'id': 'row-1', 'cells': {'name': 'A'}}]}


def query(**patch):
    return {'schemaId': '', 'text': '', 'limit': 100, **patch}


class CatalogDomainTest(unittest.TestCase):
    def test_portable_typed_cells_preserve_missingness_units_and_exact_decimals(self):
        for example in json.loads(FIXTURES.read_text()):
            with self.subTest(type=example['type'], raw=example['raw']):
                definition = StructuredColumn.parse(column(type=example['type'], required=example.get('required', False),
                    options=example.get('options', []), units=example.get('units', [])))
                if 'error' in example:
                    with self.assertRaises(ValueError):
                        definition.parse_cell(example['raw'])
                else:
                    self.assertEqual(definition.parse_cell(example['raw']).wire(), example['value'])

    def test_invalid_values_are_saved_as_drafts_but_structural_identity_errors_are_rejected(self):
        table = draft()
        table['name'] = ''
        table['rows'][0]['cells']['name'] = ''
        validate_attribute('registrationTable', {'table': table, 'receipts': [], 'blockId': 'block-1'})
        with self.assertRaises(ValueError):
            StructuredTableDraft.parse(table).typed_rows()
        invalid = []
        for key, value in [('rows', [draft()['rows'][0]] * 2), ('name', 'x' * 201)]:
            invalid.append({**draft(), key: value})
        invalid.append({**draft(), 'rows': [{'id': 'r1', 'cells': {'unknown': 'lost'}}]})
        invalid.append({**draft(), 'schema': {**draft()['schema'], 'columns': [column()] * 2}})
        invalid.append({**draft(), 'future': True})
        for item in invalid:
            with self.subTest(item=item), self.assertRaises(ValueError):
                StructuredTableDraft.parse(item)

    def test_column_rules_are_owned_by_typed_schema(self):
        for patch in [{'type': 'quantity'}, {'type': 'decimal', 'options': ['1']}, {'type': 'text', 'units': ['mg']},
                      {'type': 'missing'}, {'name': ''}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                StructuredColumn.parse(column(**patch)).validate()
        table = draft()
        table['schema']['columns'].append(column(id='name-2', name=' name '))
        with self.assertRaisesRegex(ValueError, 'distinct'):
            StructuredTableDraft.parse(table).typed_rows()


class CatalogStoreTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.entries = EntryStore(self.directory.name)
        self.catalog = CatalogStore(self.entries.path)

    def test_explicit_submit_is_atomic_idempotent_and_persistent(self):
        self.assertEqual(self.catalog.lookup(query())['records'], [])
        table = draft()
        validate_attribute('inputTable', {'table': table, 'receipts': []})
        self.assertEqual(self.catalog.lookup(query())['total'], 0, 'validating a saved draft must not register it')
        receipt = self.catalog.register({'submissionId': 'submit-1', 'table': table})
        self.assertEqual(receipt['inputHash'], '038e18e259c0eadf86d60146c71cd28ecde2fd94500126d2fe641f1eb9d77005')
        validate_attribute('registrationTable', {'table': table, 'receipts': [receipt]})
        reopened = CatalogStore(self.entries.path)
        self.assertEqual(reopened.identity, receipt['catalogId'])
        self.assertEqual(reopened.register({'submissionId': 'submit-1', 'table': table}), receipt)
        self.assertEqual(reopened.lookup(query())['total'], 1)
        self.assertEqual(reopened.lookup(query())['records'][0]['values']['name'], {'type': 'text', 'value': 'A'})
        self.assertEqual(reopened.lookup(query())['records'][0]['name'], 'A')

        changed = copy.deepcopy(table)
        changed['rows'][0]['cells']['name'] = 'B'
        with self.assertRaises(SubmissionConflict):
            reopened.register({'submissionId': 'submit-1', 'table': changed})
        with closing(sqlite3.connect(self.entries.path)) as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM catalog_versions').fetchone()[0], 1)
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM catalog_submissions').fetchone()[0], 1)
        self.assertEqual(reopened.lookup(query())['records'][0]['version'], 1)

    def test_new_submission_versions_records_without_mutating_old_receipts_or_removed_rows(self):
        table = draft()
        first = self.catalog.register({'submissionId': 'submit-1', 'table': table})
        original = copy.deepcopy(first)
        table['rows'][0]['cells']['name'] = 'B'
        table['rows'].append({'id': 'row-2', 'cells': {'name': 'C'}})
        second = self.catalog.register({'submissionId': 'submit-2', 'table': table})
        self.assertEqual(second['records'][0]['recordId'], first['records'][0]['recordId'])
        self.assertEqual([item['version'] for item in second['records']], [2, 1])
        self.assertEqual(first, original)
        self.assertEqual(self.catalog.register({'submissionId': 'submit-1', 'table': draft()}), first)
        table['rows'].pop()
        self.catalog.register({'submissionId': 'submit-3', 'table': table})
        self.assertEqual(self.catalog.lookup(query())['total'], 2, 'removing a draft row is not a catalog deletion')
        with closing(sqlite3.connect(self.entries.path)) as connection:
            old = json.loads(connection.execute('SELECT data FROM catalog_versions WHERE record_id = ? AND version = 1', (first['records'][0]['recordId'],)).fetchone()[0])
            self.assertEqual(old['values']['name']['value'], 'A')

    def test_schema_conflicts_and_invalid_rows_leave_no_partial_catalog_writes(self):
        table = draft()
        table['rows'].append({'id': 'row-2', 'cells': {'name': ''}})
        with self.assertRaises(ValueError):
            self.catalog.register({'submissionId': 'invalid', 'table': table})
        self.assertEqual(self.catalog.lookup(query())['total'], 0)
        self.catalog.register({'submissionId': 'first', 'table': draft()})
        table = draft()
        table['schema']['columns'][0]['type'] = 'decimal'
        table['rows'][0]['cells']['name'] = '1.25'
        with self.assertRaises(SchemaConflict):
            self.catalog.register({'submissionId': 'conflict', 'table': table})
        self.assertEqual(self.catalog.lookup(query())['records'][0]['version'], 1)
        table['schema']['revision'] = 2
        receipt = self.catalog.register({'submissionId': 'revised-schema', 'table': table})
        self.assertEqual(receipt['schemaRevision'], 2)
        self.assertEqual(self.catalog.lookup(query())['records'][0]['values']['name'], {'type': 'decimal', 'value': '1.25'})
        with closing(sqlite3.connect(self.entries.path)) as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM catalog_submissions').fetchone()[0], 2)

    def test_lookup_queries_real_records_and_reports_frozen_provenance_and_versions(self):
        table = draft()
        table['rows'] = [{'id': 'row-1', 'cells': {'name': 'Alpha'}}, {'id': 'row-2', 'cells': {'name': 'Beta'}}]
        self.catalog.register({'submissionId': 'first', 'table': table})
        result = self.catalog.lookup(query(text='ALPHA'))
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['source'], 'notebook-local-catalog')
        validate_attribute('lookupTable', {'query': result['query'], 'snapshot': result})
        snapshot = copy.deepcopy(result)
        self.assertEqual(self.catalog.lookup(query(text='样品'))['total'], 2)
        self.assertEqual(self.catalog.lookup(query(text='missing'))['records'], [])
        self.assertEqual(self.catalog.lookup(query(schemaId='schema-other'))['records'], [])
        self.assertEqual(len(self.catalog.lookup(query(limit=1))['records']), 1)
        self.assertEqual(self.catalog.lookup(query(limit=1))['total'], 2)
        table['rows'][0]['cells']['name'] = 'Gamma'
        self.catalog.register({'submissionId': 'next', 'table': table})
        self.assertEqual(result, snapshot)
        self.assertEqual(result['records'][0]['version'], 1)
        self.assertEqual(self.catalog.lookup(query(text='Alpha'))['total'], 0)
        self.assertEqual(self.catalog.lookup(query(text='Gamma'))['records'][0]['version'], 2)
        malformed = copy.deepcopy(snapshot)
        malformed['records'][0]['values']['name'] = {'type': 'boolean', 'value': False}
        with self.assertRaises(ValueError):
            validate_attribute('lookupTable', {'query': query(), 'snapshot': malformed})
        for invalid in [query(limit=0), query(limit=201), query(schemaId='bad id'), {**query(), 'future': True}]:
            with self.assertRaises(ValueError):
                self.catalog.lookup(invalid)


if __name__ == '__main__':
    unittest.main()
