"""Value-based checks for the selected-definition admission concept."""
from dataclasses import replace
import json
from pathlib import Path
import unittest

from semantics import Definition, QueryIntent, ReadGrant, SemanticSnapshot


class SelectedDefinitionTests(unittest.TestCase):
    def test_admission(self):
        definitions = json.loads((Path(__file__).parent / 'definitions.v1.json').read_text())['definitions']
        snapshot = SemanticSnapshot('v1', tuple(Definition.admit(row) for row in definitions))
        grant = ReadGrant('reader', 'project', (('sample', ('sample_id', 'sepal_length_cm')),))
        base = QueryIntent('manual', 'project', 'v1', 'select', 'length_above', (('threshold', 6),))
        cases = (
            ('typed integer threshold', base, 'answered'),
            ('typed decimal threshold', replace(base, parameters=(('threshold', 6.1),)), 'answered'),
            ('missing parameter', replace(base, parameters=()), 'clarify'),
            ('extra parameter', replace(base, parameters=base.parameters + (('seed', 1),)), 'clarify'),
            ('text is not a numeric threshold', replace(base, parameters=(('threshold', '6'),)), 'clarify'),
            ('boolean is not a numeric threshold', replace(base, parameters=(('threshold', True),)), 'clarify'),
            ('definition not selected', replace(base, definition=''), 'clarify'),
            ('unknown definition', replace(base, definition='unknown'), 'clarify'),
            ('version not selected', replace(base, snapshot=''), 'clarify'),
            ('version outside query context', replace(base, snapshot='v2'), 'refused'),
            ('project outside grant', replace(base, project='other'), 'refused'),
            ('mutation request', replace(base, operation='update'), 'refused'),
            ('source requests upload', replace(base, operation='upload'), 'refused'),
            ('bound text has no authority', replace(base, definition='sepal_mean', parameters=(('species', "'; DROP TABLE sample; --"),)), 'answered'),
        )
        for label, intent, status in cases:
            with self.subTest(label=label):
                self.assertEqual(snapshot.decide(intent, grant).status, status)

    def test_table_and_column_scope(self):
        grant = ReadGrant('reader', 'project', (('sample', ('sample_id',)),))
        cases = (
            (('sample', 'sample_id', 'main'), True),
            (('sample', '', None), True),  # SQLite COUNT(*) authorization callback.
            (('sample', 'sepal_length_cm', 'main'), False),
            (('metric', '', None), False),
            (('sample', 'sample_id', 'external'), False),
            (('sample', 'sample_id', None), False),
        )
        for request, expected in cases:
            with self.subTest(request=request):
                self.assertEqual(grant.permits_read(*request), expected)

    def test_unreviewed_definition(self):
        raw = json.loads((Path(__file__).parent / 'definitions.v1.json').read_text())['definitions'][0]
        raw['review']['status'] = 'draft'
        with self.assertRaisesRegex(ValueError, 'reviewed'):
            Definition.admit(raw)


if __name__ == '__main__':
    unittest.main()
