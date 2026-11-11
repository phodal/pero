import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from pero_environment_proposal import Declaration, EnvironmentProposal


class ProjectDeclarations(unittest.TestCase):
    def test_review_preserves_sources_and_discloses_unresolved_inputs(self):
        for name, content, expected in [
            ('pyproject.toml', '[project]\nrequires-python=">=3.12"\ndependencies=["numpy==2.2.6"]\n[build-system]\nrequires=["untrusted-build"]', 'Build hooks'),
            ('requirements.txt', 'scipy==1.18.1\n-r private.txt\n--index-url https://example.invalid\n', 'Requirements options'),
            ('uv.lock', 'version=1\nrequires-python=">=3.12"\n[[package]]\nname="numpy"\nversion="2.2.6"', 'platform compatibility'),
            ('.python-version', '3.12.14\n3.14\n', 'Multiple Python'),
        ]:
            with self.subTest(name=name):
                declaration=Declaration.parse(name, content.encode())
                proposal=EnvironmentProposal.review('fixture', [declaration]).to_dict()
                self.assertTrue(any(expected in value for value in proposal['warnings']))
                self.assertEqual(proposal['status'], 'review_required')
                self.assertNotIn('content',proposal['declarations'][0])
                changed=EnvironmentProposal.review('fixture',[Declaration.parse(name,(content+'\n').encode())]).to_dict()
                self.assertNotEqual(proposal['digest'],changed['digest'])

    def test_invalid_and_missing_declarations_are_not_ready(self):
        for name,content in [('setup.py',b'raise Exception()'),('requirements.txt',b'\0'),('pyproject.toml',b'[project]\ndependencies="numpy"')]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                EnvironmentProposal.review('fixture',[Declaration.parse(name,content)])
        with self.assertRaises(ValueError): EnvironmentProposal.review('empty',[])


if __name__ == '__main__': unittest.main()
