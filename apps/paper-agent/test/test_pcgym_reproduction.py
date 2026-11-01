"""Self-authored fixtures, never labelled original Table 6 experiment evidence."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

BACKEND = Path(__file__).resolve().parents[1] / 'backend'
sys.path.insert(0, str(BACKEND))
from paper_agent.pcgym_domain import (Claim, Invalid, Observation, ReproductionSpec,
    REQUIRED_PACKAGES, canonical, digest, evaluate, verification, PaperAnchor, PolicyTrace)
from paper_agent.pcgym_sources import CASE, PINS, SourceFile, audit_sources, read_checkout
from paper_agent.pcgym import (write_json, read_json, check_attempt, export,
                              run, status, root_path)


def specification(profile='smoke', *, include_oracle=True, paper_binding_digest=None):
    return ReproductionSpec.create(seed=0, profile=profile,
        packages={name: 'fixture-version' for name in REQUIRED_PACKAGES},
        source_manifest_digest='a' * 64, python_version='3.11.8', pipeline_digest='d' * 64,
        include_oracle=include_oracle, paper_binding_digest=paper_binding_digest)


def observation(spec, origin='synthetic-fixture'):
    return {'schema': 'pero.pcgym.observation.v1', 'spec_id': spec.id,
            'attempt_id': 'b' * 64, 'origin': origin,
            'policies': [{'policy': name, 'temperature_unit': 'K', 'includes_initial_state': True,
                          'temperatures': [[324.] * spec.samples for _ in range(spec.episodes)]}
                         for name in spec.policies]}


def synthetic_sources():
    fixture = {
        CASE + 'constraint_paper.py': 'env_params_con = {}\nenv_params = env_params_con\nx = DDPG("MlpPolicy", env)\n',
        CASE + 'constraint_violation_vis.py': 'def violation_rate(x):\n    violations = (x > 327) | (x < 321)\n    return np.mean(violations)\n',
        CASE + 'custom_reward.py': "cons = {'T': [327, 321]}\ndef reward(bounds):\n    lower_bound, upper_bound = bounds\n",
        'src/pcgym/policy_evaluation.py': 'N = 60\n',
    }
    return tuple(SourceFile.parse(path, text.encode()) for path, text in fixture.items())


class MetricContractTests(unittest.TestCase):
    def setUp(self):
        self.spec = specification()
        self.raw = observation(self.spec)

    def test_one_violating_sample_preserves_both_denominators(self):
        claim = Claim()
        for violating, episode_count, sample_count in ((0, 0, 0), (1, 1, 1), (2, 1, 2), (60, 1, 60)):
            with self.subTest(violating=violating):
                trace = PolicyTrace('base', ((328.,) * violating + (324.,) * (60 - violating),))
                self.assertEqual(claim.metric.counts(trace), (episode_count, 1))
                self.assertEqual(claim.implemented_metric.counts(trace), (sample_count, 60))
        self.raw['policies'][0]['temperatures'][0][1] = 328.
        result = evaluate(Observation.parse(self.raw, self.spec))[0]
        self.assertEqual((result.violated_samples, result.total_samples), (1, 120))
        self.assertEqual((result.violated_episodes, result.total_episodes), (1, 2))
        self.assertAlmostEqual(result.sample_fraction, 1 / 120)
        self.assertEqual(result.episode_fraction, .5)

    def test_inclusive_kelvin_bounds_are_not_violations(self):
        self.raw['policies'][0]['temperatures'][0] = [321., 327.] * 30
        result = evaluate(Observation.parse(self.raw, self.spec))[0]
        self.assertEqual(result.violated_samples, 0)

    def test_full_violating_episode_does_not_mean_all_episodes(self):
        self.raw['policies'][0]['temperatures'][0] = [320.] * 60
        result = evaluate(Observation.parse(self.raw, self.spec))[0]
        self.assertEqual(result.violated_samples, 60)
        self.assertEqual(result.episode_fraction, .5)

    def test_missing_or_invalid_observations_are_not_silently_filtered(self):
        mutations = {
            'missing-policy': lambda v: v['policies'].pop(),
            'duplicate-policy': lambda v: v['policies'][1].update(policy='base'),
            'missing-episode': lambda v: v['policies'][0]['temperatures'].pop(),
            'missing-sample': lambda v: v['policies'][0]['temperatures'][0].pop(),
            'celsius': lambda v: v['policies'][0].update(temperature_unit='C'),
            'omit-initial': lambda v: v['policies'][0].update(includes_initial_state=False),
            'unknown-origin': lambda v: v.update(origin='verified'),
            'wrong-spec': lambda v: v.update(spec_id='c' * 64),
            'wrong-attempt-id': lambda v: v.update(attempt_id='../other'),
        }
        for name, change in mutations.items():
            with self.subTest(name=name):
                raw = deepcopy(self.raw)
                change(raw)
                with self.assertRaises(Invalid):
                    Observation.parse(raw, self.spec)

    def test_frozen_policy_coverage_is_exact_with_or_without_oracle(self):
        for include_oracle in (True, False):
            with self.subTest(include_oracle=include_oracle):
                spec = specification(include_oracle=include_oracle)
                raw = observation(spec)
                report = verification(spec, Observation.parse(raw, spec), 'completed', False)
                self.assertEqual(report['numeric_recomputation'], 'PASS')
                self.assertEqual(report['paper_verdict'], 'INCONCLUSIVE')
                self.assertEqual(report['policy_coverage'], list(spec.policies))
                self.assertEqual([m['policy'] for m in report['metrics']], list(spec.policies))
                for missing in spec.policies:
                    incomplete = deepcopy(raw)
                    incomplete['policies'] = [p for p in incomplete['policies'] if p['policy'] != missing]
                    with self.assertRaises(Invalid):
                        Observation.parse(incomplete, spec)
                if not include_oracle:
                    raw['policies'].append(observation(specification())['policies'][-1])
                    with self.assertRaises(Invalid):
                        Observation.parse(raw, spec)

    def test_invalid_numbers_are_rejected(self):
        for value in (float('nan'), float('inf'), True, '324', None):
            with self.subTest(value=value):
                raw = deepcopy(self.raw)
                raw['policies'][0]['temperatures'][0][0] = value
                with self.assertRaises(Invalid):
                    Observation.parse(raw, self.spec)

    def test_table6_values_not_all_on_fifty_episode_grid(self):
        spec = specification('table6')
        metrics = evaluate(Observation.parse(observation(spec), spec))
        self.assertEqual([m.episode_grid_compatible for m in metrics], [False, False, True])
        self.assertTrue(all(m.total_samples == 3000 and m.total_episodes == 50 for m in metrics))

    def test_no_fixture_or_numeric_match_becomes_paper_pass(self):
        for origin, status, matches in [('synthetic-fixture', 'completed', True),
                                        ('imported', 'completed', True),
                                        ('pcgym-execution', 'failed', True),
                                        ('pcgym-execution', 'completed', False),
                                        ('pcgym-execution', 'completed', True)]:
            with self.subTest(origin=origin, status=status, matches=matches):
                self.raw['origin'] = origin
                report = verification(self.spec, Observation.parse(self.raw, self.spec), status, matches)
                self.assertEqual(report['paper_verdict'], 'INCONCLUSIVE')
                self.assertEqual(report['acceptance'], 'unreviewed')
                expected = 'CONSISTENT' if (origin, status, matches) == ('pcgym-execution', 'completed', True) else 'UNVERIFIED'
                self.assertEqual(report['execution_evidence'], expected)

    def test_more_violations_in_same_episode_only_changes_sample_grain(self):
        self.raw['policies'][0]['temperatures'][0][0] = 328.
        first = evaluate(Observation.parse(self.raw, self.spec))[0]
        self.raw['policies'][0]['temperatures'][0][1] = 328.
        second = evaluate(Observation.parse(self.raw, self.spec))[0]
        self.assertEqual(first.episode_fraction, second.episode_fraction)
        self.assertEqual(second.violated_samples, first.violated_samples + 1)


class FrozenProtocolTests(unittest.TestCase):
    def test_round_trip_and_stable_identity(self):
        spec = specification()
        self.assertEqual(ReproductionSpec.parse(json.loads(canonical(spec.to_dict()))), spec)
        self.assertEqual(spec.id, specification().id)

    def test_optional_oracle_is_frozen_without_changing_original_spec_identity(self):
        original = specification()
        optional = specification(include_oracle=False)
        self.assertNotIn('include_oracle', original.payload())
        self.assertFalse(optional.payload()['include_oracle'])
        self.assertNotEqual(optional.id, original.id)
        self.assertEqual(ReproductionSpec.parse(json.loads(canonical(optional.to_dict()))), optional)
        changed = json.loads(canonical(optional.to_dict()))
        del changed['include_oracle']
        with self.assertRaises(Invalid):
            ReproductionSpec.parse(changed)
        for value in (0, 1, 'false', None):
            with self.subTest(value=value), self.assertRaises(Invalid):
                specification(include_oracle=value)

    def test_paper_binding_digest_preserves_exact_frozen_input(self):
        original = specification()
        bound = specification(paper_binding_digest='e' * 64)
        self.assertNotIn('paper_binding_digest', original.payload())
        self.assertNotEqual(bound.id, original.id)
        self.assertEqual(ReproductionSpec.parse(json.loads(canonical(bound.to_dict()))), bound)
        for value in (None, 'f' * 64):
            changed = json.loads(canonical(bound.to_dict()))
            if value is None:
                del changed['paper_binding_digest']
            else:
                changed['paper_binding_digest'] = value
            with self.assertRaises(Invalid):
                ReproductionSpec.parse(changed)
        for value in ('', 'not-a-digest', True, 0):
            with self.subTest(value=value), self.assertRaises(Invalid):
                specification(paper_binding_digest=value)

    def test_changes_are_rejected_not_absorbed(self):
        spec = specification()
        for key, value in [('steps', 25000), ('episodes', 1), ('samples', 59),
                           ('comparison', 'sample-only'), ('commit', 'main'),
                           ('mode', 'verified'), ('id', 'c' * 64)]:
            with self.subTest(key=key):
                raw = json.loads(canonical(spec.to_dict()))
                raw[key] = value
                with self.assertRaises(Invalid):
                    ReproductionSpec.parse(raw)

    def test_seed_bool_and_missing_packages_refused(self):
        with self.assertRaises(Invalid):
            ReproductionSpec.create(seed=True, profile='table6', packages={}, source_manifest_digest='a' * 64, python_version='3.11.8', pipeline_digest='d' * 64)
        with self.assertRaises(Invalid):
            ReproductionSpec.create(seed=0, profile='table6', packages={}, source_manifest_digest='a' * 64, python_version='3.11.8', pipeline_digest='d' * 64)

    def test_no_ad_hoc_tolerance(self):
        raw = json.loads(canonical(specification().to_dict()))
        raw['tolerance'] = 1.
        with self.assertRaises(Invalid):
            ReproductionSpec.parse(raw)
        raw = json.loads(canonical(specification().to_dict()))
        raw['metrics'][0]['measurement_grain'] = 'sample'
        raw['id'] = digest({k: v for k, v in raw.items() if k != 'id'})
        with self.assertRaises(Invalid):
            ReproductionSpec.parse(raw)

    def test_duplicate_package_identity_rejected(self):
        raw = json.loads(canonical(specification().to_dict()))
        raw['packages'].append(raw['packages'][0])
        with self.assertRaises(Invalid):
            ReproductionSpec.parse(raw)

    def test_optional_anchor_is_version_bound(self):
        anchor = PaperAnchor.parse({'paper_id': 'a' * 64, 'document_id': 'b' * 64,
                                   'file_digest': 'c' * 64, 'passage_id': 'd' * 64, 'page': 20})
        self.assertEqual(anchor.page, 20)
        with self.assertRaises(Invalid):
            PaperAnchor.parse({**anchor.__dict__, 'page': 0})


class AuditTests(unittest.TestCase):
    def test_findings_reference_observed_lines_and_keep_fixture_label(self):
        report = audit_sources(synthetic_sources())
        self.assertEqual(report['source_status'], 'synthetic-fixture')
        self.assertEqual(report['paper_verdict'], 'INCONCLUSIVE')
        self.assertEqual(len(report['findings']), 4)
        metric = next(f for f in report['findings'] if f['id'] == 'metric-grain')
        self.assertEqual(metric['code']['start_line'], 3)
        self.assertEqual(metric['code']['end_line'], 3)

    def test_changed_blob_does_not_reuse_pin(self):
        with self.assertRaises(Invalid):
            SourceFile.parse(CASE + 'constraint_paper.py', b'x = 1\n', PINS[CASE + 'constraint_paper.py'])

    def test_missing_sources_fail_coverage(self):
        with self.assertRaises(Invalid):
            audit_sources(synthetic_sources()[:-1])

    def test_missing_structure_is_not_reported_as_observed(self):
        sources = list(synthetic_sources())
        sources[1] = SourceFile.parse(CASE + 'constraint_violation_vis.py', b'x = 1\n')
        with self.assertRaises(Invalid):
            audit_sources(sources)

    def test_non_python_and_binary_rejected(self):
        for content in (b'\xff', b'x=\x00', b'def broken('):
            with self.subTest(content=content):
                with self.assertRaises(Invalid):
                    SourceFile.parse(CASE + 'custom_reward.py', content)

    def test_unpinned_checkout_fails_before_code_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(['git', 'init', '-q', directory], check=True)
            Path(directory, 'marker.py').write_text('raise RuntimeError("must never execute")')
            with self.assertRaises(Invalid):
                read_checkout(directory)


class EvidencePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.spec = specification()
        write_json(self.root / 'spec.json', self.spec.to_dict())
        for name, value in [('claim', Claim().to_dict()), ('audit', audit_sources(synthetic_sources())),
                            ('source-manifest', {'origin': 'synthetic-fixture'})]:
            write_json(self.root / (name + '.json'), value)
        self.target = self.root / 'attempts' / ('b' * 64)
        self.target.mkdir(parents=True)
        self.raw = observation(self.spec)
        self.raw['policies'][0]['temperatures'][0][0] = 328.
        write_json(self.target / 'observations.json', self.raw)
        self.receipt = {'spec_id': self.spec.id, 'attempt_id': 'b' * 64, 'status': 'completed',
                        'origin': 'synthetic-fixture', 'observations_sha256':
                            hashlib.sha256((self.target / 'observations.json').read_bytes()).hexdigest()}
        write_json(self.target / 'execution.json', self.receipt)

    def test_persist_reopen_recompute(self):
        result = check_attempt(self.root, 'b' * 64)
        self.assertEqual(result['metrics'][0]['violated_samples'], 1)
        self.assertEqual(result['paper_verdict'], 'INCONCLUSIVE')
        self.assertEqual(check_attempt(self.root, 'b' * 64), result)

    def test_tampered_observations_fail_integrity(self):
        self.raw['policies'][0]['temperatures'][0][0] = 324.
        write_json(self.target / 'observations.json', self.raw)
        result = check_attempt(self.root, 'b' * 64)
        self.assertEqual(result['numeric_recomputation'], 'FAIL')
        self.assertEqual(result['execution_evidence'], 'UNVERIFIED')

    def test_observations_cannot_move_between_attempts(self):
        self.raw['attempt_id'] = 'c' * 64
        write_json(self.target / 'observations.json', self.raw)
        with self.assertRaises(Invalid):
            check_attempt(self.root, 'b' * 64)

    def test_export_recomputes_without_agent_or_solver(self):
        destination = self.root / 'evidence.zip'
        export(self.root, 'b' * 64, destination)
        extracted = self.root / 'fresh'
        extracted.mkdir()
        with zipfile.ZipFile(destination) as archive:
            self.assertNotIn('local.json', archive.namelist())
            self.assertNotIn('paper-binding.json', archive.namelist())
            self.assertNotIn('execution.log', archive.namelist())
            archive.extractall(extracted)  # only our own test-produced archive
        process = subprocess.run([sys.executable, str(extracted / 'verify.py')],
                                 capture_output=True, text=True, timeout=15)
        self.assertEqual(process.returncode, 0, process.stderr)
        report = json.loads(process.stdout)
        self.assertEqual(report['paper_verdict'], 'INCONCLUSIVE')
        self.assertEqual(report['metrics'][0]['violated_samples'], 1)
        (extracted / 'observations.json').write_text('{}')
        altered = subprocess.run([sys.executable, '-O', str(extracted / 'verify.py')],
                                 capture_output=True, text=True, timeout=15)
        self.assertNotEqual(altered.returncode, 0)

    def test_bound_export_checks_binding_even_with_rehashed_manifest(self):
        binding = {'paper_id': 'e' * 64, 'annotation_id': 'f' * 64}
        spec = specification(paper_binding_digest=digest(binding))
        write_json(self.root / 'spec.json', spec.to_dict())
        write_json(self.root / 'paper-binding.json', binding)
        self.raw['spec_id'] = spec.id
        write_json(self.target / 'observations.json', self.raw)
        self.receipt.update(spec_id=spec.id, observations_sha256=
            hashlib.sha256((self.target / 'observations.json').read_bytes()).hexdigest())
        write_json(self.target / 'execution.json', self.receipt)
        destination = self.root / 'bound.zip'
        export(self.root, 'b' * 64, destination)
        extracted = self.root / 'bound-export'
        with zipfile.ZipFile(destination) as archive:
            self.assertIn('paper-binding.json', archive.namelist())
            archive.extractall(extracted)
        command = [sys.executable, str(extracted / 'verify.py')]
        checked = subprocess.run(command, capture_output=True, text=True, timeout=15)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        altered = {**binding, 'annotation_id': 'a' * 64}
        write_json(extracted / 'paper-binding.json', altered)
        manifest = read_json(extracted / 'manifest.json')
        for item in manifest['files']:
            if item['name'] == 'paper-binding.json':
                item['sha256'] = hashlib.sha256((extracted / item['name']).read_bytes()).hexdigest()
        write_json(extracted / 'manifest.json', manifest)
        checked = subprocess.run(command, capture_output=True, text=True, timeout=15)
        self.assertNotEqual(checked.returncode, 0)
        self.assertIn('Paper binding differs', checked.stderr)
        write_json(self.root / 'paper-binding.json', altered)
        with self.assertRaises(Invalid):
            export(self.root, 'b' * 64, self.root / 'changed-binding.zip')
        self.assertFalse((self.root / 'changed-binding.zip').exists())

    def test_cli_checker_is_a_real_separate_process(self):
        for changed, expected_code in ((False, 0), (True, 2)):
            with self.subTest(changed=changed):
                if changed:
                    self.raw['policies'][0]['temperatures'][0][0] = 324.
                    write_json(self.target / 'observations.json', self.raw)
                process = subprocess.run([sys.executable, '-m', 'paper_agent.pcgym', 'verify',
                                  '--bundle', str(self.root), '--attempt', 'b' * 64],
                                 env={**os.environ, 'PYTHONPATH': str(BACKEND)},
                                 capture_output=True, text=True, timeout=15)
                self.assertEqual(process.returncode, expected_code, process.stderr)
                self.assertEqual(json.loads(process.stdout)['paper_verdict'], 'INCONCLUSIVE')
                if changed:
                    destination = self.root / 'invalid-evidence.zip'
                    with self.assertRaises(Invalid):
                        export(self.root, 'b' * 64, destination)
                    self.assertFalse(destination.exists())

    def test_unapproved_execution_is_side_effect_free(self):
        with self.assertRaises(Invalid):
            run(self.root, self.spec.id, confirm=False, accept_findings=True)
        self.assertFalse((self.root / 'running.lock').exists())
        with self.assertRaises(Invalid):
            run(self.root, 'f' * 64, confirm=True, accept_findings=True)

    def test_status_does_not_restart_or_infer_liveness(self):
        before = (self.target / 'execution.json').read_bytes()
        result = status(self.root)
        self.assertEqual(result['attempts'][0]['liveness'], 'not-probed')
        self.assertEqual((self.target / 'execution.json').read_bytes(), before)

    def test_non_finite_json_and_symlinks_rejected(self):
        bad = self.root / 'bad.json'
        bad.write_text('{"number": NaN}')
        with self.assertRaises(Invalid):
            read_json(bad)
        if os.name != 'nt':
            link = self.root / 'link.json'
            link.symlink_to(self.root / 'spec.json')
            with self.assertRaises(Invalid):
                read_json(link)
            with self.assertRaises(Invalid):
                write_json(link, {})


if __name__ == '__main__':
    unittest.main()
