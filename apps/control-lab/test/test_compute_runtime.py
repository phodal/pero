import copy
import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'backend'))
from control_lab.compute_runtime import ComputeProfile
from control_lab.experiments import Invalid


class ComputeProfileTests(unittest.TestCase):
    def test_frozen_identity_rejects_drift(self):
        value = dict(root='/compute/prefix', project_sha256='1'*64, lock_sha256='2'*64,
                     python_request='3.12.14', python_archive_url='https://example.test/python.tar.gz', python_archive_sha256='5'*64, uv_version='0.12.20', uv_sha256='3'*64,
                     observation=dict(version='3.12.14', build='CPython build', platform='Linux',
                                      machine='x86_64', packages_sha256='6'*64, executable_sha256='4'*64, packages={'control': '0.10.2'}))
        profile = ComputeProfile.parse(value)
        profile.require(value['observation'])
        for key in value['observation']:
            changed = copy.deepcopy(value['observation'])
            changed[key] = {} if key == 'packages' else 'changed'
            with self.subTest(key=key), self.assertRaises(Invalid):
                profile.require(changed)
        for key, changed in [('root', 'relative'), ('lock_sha256', 'bad'), ('observation', {}), ('command', 'arbitrary')]:
            invalid = {**value, key: changed}
            with self.subTest(key=key), self.assertRaises(Invalid):
                ComputeProfile.parse(invalid)
        original = profile.payload
        value['observation']['packages'].clear()
        self.assertEqual(profile.payload, original)


class NativeExecutableTests(unittest.TestCase):
    def test_frozen_solver_rejects_each_identity_change(self):
        from control_lab.native_executable import NativeExecutable
        from dataclasses import replace
        original = NativeExecutable('/opt/solver/ngspice', 'a'*64, 'ngspice-46')
        original.require(NativeExecutable.parse(original.to_dict()))
        for field, value in [('path','/other/ngspice'),('sha256','b'*64),('version','ngspice-47')]:
            with self.subTest(field=field), self.assertRaisesRegex(Invalid, 'executable changed'):
                original.require(replace(original, **{field:value}))
