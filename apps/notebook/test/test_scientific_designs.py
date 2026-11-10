"""Real local design/reaction persistence and bounded graph validation."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument
from scientific_designs import MolecularGraph, PlateDesign, ReactionDefinition, ScientificDesignStore, MissingScientificRecord, parse_scientific_attributes
from scientific_routes import scientific_route
from store import EntryStore, RevisionConflict


def graph():
    return dict(atoms=[dict(id='c', element='C', x=120, y=160, charge=0), dict(id='o', element='O', x=200, y=160, charge=-1)],
                bonds=[dict(id='bond', **{'from': 'c', 'to': 'o', 'order': 1})])


def reaction():
    return dict(name='Graph reaction', notes='Explicit graph only', molecules=[dict(id='left', name='Starting graph', role='reactant', graph=graph()), dict(id='right', name='Final graph', role='product', graph=graph())])


def plate():
    return dict(name='Screen design', description='Controls', metadata=dict(barcode='P-42', plateType='User-provided', wellVolumeMicroliters=20, fields=[dict(key='Lot', value='2026')]),
                layout=dict(size=dict(rows=32, columns=48), groups={'A1': ['Control'], 'AF48': ['Sample', 'Control']}), origin=None)


class ScientificDesignTest(unittest.TestCase):
    def test_plate_persistence_revision_derivation_conflict_and_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ScientificDesignStore(EntryStore(directory))
            first = store.save(PlateDesign.parse(plate()))
            changed = plate(); changed['metadata']['barcode'] = 'P-43'
            changed['origin'] = dict(id=first['id'], revision=1)
            second = store.save(PlateDesign.parse(changed), first['id'], 1)
            with self.assertRaises(RevisionConflict):
                store.save(PlateDesign.parse(changed), first['id'], 1)
            reused = store.save(PlateDesign.parse(changed))
            self.assertNotEqual(first['id'], reused['id'])
            reopened = ScientificDesignStore(EntryStore(directory))
            self.assertEqual(reopened.read('plates', first['id'], 1), first)
            self.assertEqual(reopened.read('plates', first['id']), second)
            self.assertEqual({item['id'] for item in reopened.list('plates')}, {first['id'], reused['id']})
            self.assertEqual(PlateDesign.parse(json.loads(json.dumps(second['definition']))).wire(), second['definition'])
            changed['origin']['revision'] = 99
            with self.assertRaises(MissingScientificRecord):
                store.save(PlateDesign.parse(changed))

    def test_reaction_records_remain_distinct_from_drafts_and_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ScientificDesignStore(EntryStore(directory))
            first = store.save(ReactionDefinition.parse(reaction(), submitted=True))
            attrs = dict(reaction=reaction(), record=first)
            parse_scientific_attributes('reactionScheme', json.loads(json.dumps(attrs)))
            attrs['reaction']['molecules'][0]['graph']['atoms'][0]['element'] = 'N'
            parse_scientific_attributes('reactionScheme', attrs)
            second = store.save(ReactionDefinition.parse(attrs['reaction'], submitted=True), first['id'], 1)
            self.assertEqual(ScientificDesignStore(EntryStore(directory)).read('reactions', first['id'], 1), first)
            self.assertEqual(second['definition']['molecules'][0]['graph']['atoms'][0]['element'], 'N')
            with self.assertRaises(RevisionConflict):
                store.save(ReactionDefinition.parse(reaction(), submitted=True), first['id'], 1)
            chemical = dict(name='Extracted', graph=graph(), source=dict(id=first['id'], revision=1, moleculeId='left', original=graph()))
            parse_scientific_attributes('chemical', dict(chemical=json.loads(json.dumps(chemical))))
            chemical['graph']['atoms'][0]['charge'] = 1
            self.assertEqual(chemical['source']['original']['atoms'][0]['charge'], 0)

    def test_invalid_plate_and_graph_inputs_are_rejected(self):
        for change in [lambda p: p['layout']['groups'].update(A01=['x']), lambda p: p['layout']['groups'].update(AG1=['x']),
                       lambda p: p['metadata'].update(wellVolumeMicroliters=True), lambda p: p['metadata']['fields'].append(dict(key=' LOT ', value='x')),
                       lambda p: p['layout']['groups'].update(A1=[]), lambda p: p.update(name='')]:
            raw = plate(); change(raw)
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                PlateDesign.parse(raw)
        for change in [lambda g: g['atoms'].append(g['atoms'][0]), lambda g: g['atoms'][0].update(x=float('nan')),
                       lambda g: g['atoms'][0].update(element='Fe'), lambda g: g['atoms'][0].update(charge=True),
                       lambda g: g['bonds'][0].update(to='missing'), lambda g: g['bonds'][0].update(order=4),
                       lambda g: g['bonds'].append(dict(id='duplicate', **{'from': 'o', 'to': 'c', 'order': 1})),
                       lambda g: g['atoms'][0].update(stereo='R')]:
            raw = graph(); change(raw)
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                MolecularGraph.parse(raw)
        for change in [lambda r: r['molecules'].pop(), lambda r: r.update(name=''), lambda r: r['molecules'][0].update(graph=dict(atoms=[], bonds=[]))]:
            raw = reaction(); change(raw)
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                ReactionDefinition.parse(raw, submitted=True)
        self.assertEqual(ReactionDefinition.parse(dict(name='', notes='', molecules=[])).molecules, ())

    def test_scientific_blocks_roundtrip_through_real_notebook_revisions(self):
        with tempfile.TemporaryDirectory() as directory:
            entries = EntryStore(directory)
            record = ScientificDesignStore(entries).save(ReactionDefinition.parse(reaction(), submitted=True))
            chemical = dict(name='Pinned graph', graph=graph(), source=dict(id=record['id'], revision=1, moleculeId='left', original=graph()))
            content = dict(schemaVersion=1, title='Scientific blocks', content=dict(type='doc', content=[
                dict(type='reactionScheme', attrs=dict(blockId='reaction-block', reaction=reaction(), record=record)),
                dict(type='chemical', attrs=dict(blockId='chemical-block', chemical=chemical)),
            ]))
            saved = entries.create(NotebookDocument.parse(content))
            exported = json.loads(json.dumps(saved.document.wire()))
            imported = entries.create(NotebookDocument.parse(exported))
            self.assertEqual(EntryStore(directory).read(imported.identity).document.wire(), exported)
            for change in [lambda source: source.update(revision=999), lambda source: source.update(moleculeId='missing'),
                           lambda source: source['original']['atoms'][0].update(element='N')]:
                contradicted = deepcopy(content)
                change(contradicted['content']['content'][1]['attrs']['chemical']['source'])
                document = NotebookDocument.parse(contradicted)
                with self.subTest(chemical=contradicted['content']['content'][1]), self.assertRaisesRegex(ValueError, 'Chemical source'):
                    entries.create(document)
                with self.assertRaisesRegex(ValueError, 'Chemical source'):
                    entries.commit(saved.identity, 1, lambda _: document)
                self.assertEqual(len(entries.history(saved.identity)), 1)
                self.assertEqual(entries.read(saved.identity).document.wire(), content)
            portable = deepcopy(content)
            portable['content']['content'][1]['attrs']['chemical']['source'].update(id='portable-other-install', revision=999, moleculeId='unknown')
            retained = entries.create(NotebookDocument.parse(portable))
            self.assertEqual(entries.read(retained.identity).document.wire(), portable, 'Unresolved portable references remain supplied, not locally verified')
            modified = deepcopy(content)
            modified['content']['content'][1]['attrs']['chemical']['graph']['atoms'][0]['element'] = 'N'
            published = entries.commit(saved.identity, 1, lambda _: NotebookDocument.parse(modified))
            self.assertEqual(published.revision, 2, 'Changing a derived graph must not rewrite or invalidate its intact original')
            tampered = deepcopy(content)
            tampered['content']['content'][1]['attrs']['chemical']['source']['revision'] = 0
            with self.assertRaises(ValueError):
                NotebookDocument.parse(tampered)
            tampered = deepcopy(content)
            tampered['content']['content'][0]['attrs']['reaction']['molecules'][0]['graph']['atoms'][0]['element'] = 'invalid'
            with self.assertRaises(ValueError):
                NotebookDocument.parse(tampered)

    def test_routes_publish_read_pin_and_return_real_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ScientificDesignStore(EntryStore(directory))
            def route(method, path, body=None):
                return scientific_route(store, method, path, lambda: body)
            status, record = route('POST', '/api/scientific/reactions', dict(definition=reaction()))
            self.assertEqual(status, 201)
            path = '/api/scientific/reactions/' + record['id']
            self.assertEqual(route('GET', path + '?revision=1'), (200, record))
            self.assertEqual(route('POST', path + '/revisions', dict(definition=reaction(), expectedRevision=1))[0], 201)
            conflict = route('POST', path + '/revisions', dict(definition=reaction(), expectedRevision=1))
            self.assertEqual(conflict[0], 409); self.assertEqual(conflict[1]['currentRevision'], 2)
            self.assertEqual(route('GET', '/api/scientific/plates')[1], dict(records=[]))
            self.assertEqual(route('GET', path + '?revision=99')[0], 404)
            with self.assertRaises(ValueError):
                route('GET', path + '?revision=1&revision=2')
            with self.assertRaises(ValueError):
                route('POST', '/api/scientific/reactions', dict(definition=reaction(), verified=True))
            self.assertIsNone(route('POST', '/other'))


if __name__ == '__main__':
    unittest.main()
