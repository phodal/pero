"""Real official RDKit and loopback transport; synthetic chemistry, no provider."""
import http.client
from http.server import ThreadingHTTPServer
import json
import math
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from molecules import MAX_REQUEST, MAX_OUTPUT, MoleculeRequest, preview
from server import PreviewRunner, handler


class MoleculesTest(unittest.TestCase):
    def test_real_rdkit_svg_descriptors_and_invalid_record(self):
        result = preview(MoleculeRequest.parse({'format': 'smiles', 'records': ['CCO', 'invalid@@']}))
        self.assertEqual(result['engine'], {'name': 'RDKit', 'version': '2026.09.1'})
        ethanol, invalid = result['rows']
        self.assertIn('<svg', ethanol['svg'])
        self.assertAlmostEqual(ethanol['descriptors']['MolWt'], 46.069, places=3)
        self.assertEqual(ethanol['descriptors']['NumHDonors'], 1)
        self.assertTrue(all(math.isfinite(value) for value in ethanol['descriptors'].values()))
        self.assertEqual(invalid['error'], 'Invalid molecule')
        self.assertNotIn('svg', invalid)

    def test_mol_and_sdf_use_real_chemistry_without_metadata_execution(self):
        from rdkit import Chem
        block = Chem.MolToMolBlock(Chem.MolFromSmiles('O'))
        for kind, value in [('mol', block), ('sdf', block + '\n$$$$\n')]:
            row = preview(MoleculeRequest.parse({'format': kind, 'records': [value]}))['rows'][0]
            self.assertAlmostEqual(row['descriptors']['MolWt'], 18.015, places=3)
            self.assertIn('<svg', row['svg'])

    def test_sdf_frontend_records_preserve_blank_titles_for_real_rdkit(self):
        from rdkit import Chem
        parser = (Path(__file__).resolve().parents[1] / 'ui-src' / 'files.ts').as_uri()
        script = f"""import {{ moleculeRecords }} from {json.dumps(parser)};
import {{ readFileSync }} from 'node:fs';
process.stdout.write(JSON.stringify(moleculeRecords('molecules.sdf', readFileSync(0))));"""
        blank = Chem.MolToMolBlock(Chem.MolFromSmiles('O'))
        ethanol = Chem.MolFromSmiles('CCO')
        ethanol.SetProp('_Name', 'Ethanol$$$$title')
        named = Chem.MolToMolBlock(ethanol)
        for newline in ('\n', '\r\n'):
            # Both named and genuinely blank titles occur after delimiters.
            blocks = [blank, named, blank]
            source = ''.join(block + '$$$$\n' for block in blocks).replace('\n', newline)
            with self.subTest(newline=repr(newline)):
                parsed = subprocess.run(['node', '--input-type=module', '-e', script],
                                        input=source.encode(), capture_output=True, timeout=10, check=True)
                records = json.loads(parsed.stdout)
                self.assertEqual(records, [block.replace('\n', newline) for block in blocks])
                rows = preview(MoleculeRequest.parse({'format': 'sdf', 'records': records}))['rows']
                self.assertEqual(len(rows), 3)
                for row, weight in zip(rows, (18.015, 46.069, 18.015)):
                    self.assertNotIn('error', row)
                    self.assertAlmostEqual(row['descriptors']['MolWt'], weight, places=3)
                    self.assertIn('<svg', row['svg'])

    def test_request_and_molecule_budgets(self):
        for value in [None, {}, {'format': 'python', 'records': ['pass']}, {'format': 'smiles', 'records': []},
                      {'format': 'smiles', 'records': ['O'] * 201}, {'format': 'smiles', 'records': [' ']},
                      {'format': 'smiles', 'records': ['C' * 32769]}, {'format': 'smiles', 'records': [1]},
                      {'format': 'smiles', 'records': ['O'], 'path': '/tmp/arbitrary'}]:
            with self.subTest(value=str(value)[:80]), self.assertRaises(ValueError):
                MoleculeRequest.parse(value)
        row = preview(MoleculeRequest.parse({'format': 'smiles', 'records': ['C' * 513]}))['rows'][0]
        self.assertIn('512 atoms', row['error'])

    def test_timeout_and_output_budget_kill_and_reap_child(self):
        real_popen = subprocess.Popen
        children = []
        def launch(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            children.append(process)
            return process
        with patch('server.subprocess.Popen', side_effect=launch):
            runner = PreviewRunner([sys.executable, '-c', 'import threading;threading.Event().wait()'], timeout=0.2)
            self.assertEqual(runner.run(b'{}')[0], 504)
            self.assertIsNotNone(children[-1].poll())
            runner = PreviewRunner([sys.executable, '-c', f'import sys;sys.stdout.buffer.write(b"x"*{MAX_OUTPUT + 1000})'])
            self.assertEqual(runner.run(b'{}')[0], 413)
            self.assertIsNotNone(children[-1].poll())
        runner.lock.acquire()
        try:
            self.assertEqual(runner.run(b'{}')[0], 503)
        finally:
            runner.lock.release()
        runner.close()
        self.assertEqual(runner.run(b'{}')[0], 503)

    def test_real_http_host_auth_limits_and_worker(self):
        runner = PreviewRunner()
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(runner, 'test-secret'))
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        def call(value, token='test-secret', headers=None, path='/api/molecules'):
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=30)
            try:
                body = json.dumps(value).encode()
                connection.request('POST', path, body, {'Content-Type': 'application/json', 'X-Pero-App-Token': token, **(headers or {})})
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()
        try:
            request = {'format': 'smiles', 'records': ['CCO', 'bad']}
            self.assertEqual(call(request, token='wrong')[0], 401)
            self.assertEqual(call(request, path='/api/execute')[0], 404)
            self.assertEqual(call(request, headers={'Content-Type': 'text/plain'})[0], 400)
            self.assertEqual(call(request, headers={'Content-Length': str(MAX_REQUEST + 1)})[0], 400)
            invalid_status, invalid = call({'format': 'smiles', 'records': []})
            self.assertEqual(invalid_status, 400)
            self.assertIn('1 to 200', invalid['detail'])
            status, result = call(request)
            self.assertEqual(status, 200)
            self.assertIn('<svg', result['rows'][0]['svg'])
            self.assertIn('error', result['rows'][1])
        finally:
            server.shutdown()
            server.server_close()
            runner.close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
