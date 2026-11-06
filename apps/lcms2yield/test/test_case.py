"""The vendored table is the paper figure; synthetic rows only exercise refusals."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from lcms2yield.catalog import load_rows
from lcms2yield.domain import DATA_TABLES, POPULATION, REPORTED_MAE_PP, Invalid, ReactionRow, cf_agreement, type_counts, unique_products, yield_table_verdict
from lcms2yield.identity import model_canonical, overlap
from lcms2yield.service import build_state


class TableTests(unittest.TestCase):
    def test_pinned_table_matches_published_mae_without_running_the_model(self):
        rows = load_rows()
        verdict, mae = yield_table_verdict(rows)
        self.assertEqual(len(rows), POPULATION)
        self.assertEqual(verdict, 'PASS')
        self.assertEqual(mae.quantize(REPORTED_MAE_PP), REPORTED_MAE_PP)
        self.assertEqual(unique_products(rows), 71)
        self.assertEqual(type_counts(rows), {'Buchwald': 104, 'SN2': 30, 'amide_coupling': 29, 'Suzuki': 15})
        state = build_state()
        self.assertEqual(state['verdicts'], {'yieldTable': 'PASS', 'prediction': 'UNRUN', 'paper': 'INCONCLUSIVE'})
        self.assertIsNone(state['reactions'][0]['cfRerun'])
        self.assertFalse(state['compute']['connected'])
        self.assertIsNone(state['compute']['jobs'])
        self.assertEqual(state['links']['method'], 'lcms2yield.inference')
        self.assertEqual(state['identity']['status'], 'UNRUN')

    def test_short_or_non_finite_rows_do_not_pass_the_paper_figure(self):
        raw = {'RXN Smiles': 'CC>>CO', 'Reaction_Type': 'SN2', 'Exp_Name': 'a',
               'Yield (Exp)': '0.50', 'Yield (Pred)': '0.25', 'CF (Exp)': '1', 'CF (Pred)': '1'}
        one = ReactionRow.parse(0, raw)
        verdict, mae = yield_table_verdict((one,))
        self.assertEqual(verdict, 'FAIL')
        self.assertEqual(mae, REPORTED_MAE_PP.__class__('25'))
        raw['Yield (Exp)'] = 'NaN'
        with self.assertRaises(Invalid):
            ReactionRow.parse(0, raw)

    def test_prediction_tolerance_is_fixed_and_population_complete(self):
        published = ['1.0000'] * POPULATION
        self.assertEqual(cf_agreement(published, ['1.00005'] * POPULATION), 'PASS')
        self.assertEqual(cf_agreement(published, ['1.0002'] + ['1'] * (POPULATION - 1)), 'FAIL')
        self.assertEqual(cf_agreement(published, published[:-1]), 'FAIL')

    def test_environment_probe_declares_python_312_for_this_trial(self):
        from lcms2yield.environment import inspect_environment
        report = inspect_environment()
        self.assertEqual(report['schema'], 'pero.environment.observation.v1')
        self.assertEqual(report['method'], 'lcms2yield.inference')
        self.assertEqual(report['evidence'], 'metadata_only')
        self.assertEqual(report['profile']['name'], 'lcms2yield')
        python = next(item for item in report['required'] if item['kind'] == 'python')
        self.assertEqual((python['major'], python['minor'], python['patch']), (3, 12, None))
        self.assertIn('torch', report['profile']['packages'])
        manifest = json.loads((Path(__file__).resolve().parents[1] / 'app.json').read_text(encoding='utf-8'))
        names = [item['name'] for item in report['required'] if item['kind'] == 'package']
        self.assertEqual(names, [item.split('==', 1)[0] for item in manifest['backend']['dependencies']] + ['torch_scatter'])
        self.assertIsNone(next(item['version'] for item in report['required'] if item.get('name') == 'torch_scatter'))
        encoded = json.dumps(report)
        self.assertNotIn('PASS', encoded)
        self.assertNotIn(os.path.expanduser('~'), encoded)

    def test_identity_overlap_keeps_parse_failures_out_of_the_sets(self):
        report = overlap({'fine_tuning': ['C', None], 'reaction_products': ['C', 'O']})
        self.assertEqual(report['populations']['fine_tuning'], {'parsed': 1, 'failed': 1})
        self.assertEqual(report['shared'][0]['shared'], 1)

    def test_model_parse_adds_hydrogens_and_drops_unparsable_smiles(self):
        class Chem:
            def MolFromSmiles(self, smiles):
                return None if smiles == 'bad' else smiles

            def AddHs(self, molecule):
                return ('H', molecule)

            def MolToSmiles(self, molecule):
                return repr(molecule)

        self.assertIsNone(model_canonical(Chem(), 'bad'))
        self.assertEqual(model_canonical(Chem(), 'C'), repr(('H', 'C')))

    def test_release_archive_rejects_members_outside_the_commit(self):
        import io
        import tarfile
        from lcms2yield.assets import extract_archive
        from lcms2yield.domain import COMMIT
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
            payload = b'nope'
            info = tarfile.TarInfo('elsewhere.txt')
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(Invalid):
                extract_archive(buffer.getvalue(), Path(directory))
        inside = io.BytesIO()
        with tarfile.open(fileobj=inside, mode='w:gz') as archive:
            payload = b'weight'
            info = tarfile.TarInfo(f'lcms2yield-{COMMIT}/model/predict.py')
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
        with tempfile.TemporaryDirectory() as directory:
            extract_archive(inside.getvalue(), Path(directory))
            self.assertEqual((Path(directory) / 'model/predict.py').read_bytes(), b'weight')

    def test_changed_training_table_bytes_do_not_record_identity(self):
        from lcms2yield.service import identity_status
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, relative, _digest, _kind in DATA_TABLES:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(name, encoding='utf-8')
            report = identity_status(str(root))
        self.assertEqual(report['status'], 'FAIL')
        self.assertIn('not the pinned', report['reason'])


class CheckoutTests(unittest.TestCase):
    def test_symlink_checkout_is_refused(self):
        from lcms2yield.rerun import verify_checkout
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'real'
            target.mkdir()
            link = Path(directory) / 'link'
            link.symlink_to(target, target_is_directory=True)
            with self.assertRaises(Invalid):
                verify_checkout(link)


if __name__ == '__main__':
    unittest.main()
