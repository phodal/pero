import unittest

from paper_agent.model import Invalid
from paper_agent.tex_preview import TexCompilation, TexInput, TexProject


class TexProjectTest(unittest.TestCase):
    def test_entry_selection(self):
        main = TexInput('main', 'paper/main.tex', b'\\documentclass{custom}\n\\input{section}')
        section = TexInput('section', 'paper/section.tex', b'Section content')
        commented = TexInput('comment', 'notes.tex', b'% \\documentclass{article}\nNotes')
        second = TexInput('second', 'supplement.tex', b'\\documentclass{article}')
        for label, files, selected, expected in (
            ('project with includes', (main, section, commented), None, 'paper/main.tex'),
            ('explicit supplementary document', (main, second), 'second', 'supplement.tex'),
            ('ambiguous main', (main, second), None, None),
            ('comment is not an entry', (commented, section), None, None),
            ('include cannot be compiled as main', (main, section), 'section', None),
        ):
            with self.subTest(label=label):
                project = TexProject('archive', files)
                if expected is None:
                    with self.assertRaises(Invalid):
                        project.entry(selected)
                else:
                    self.assertEqual(project.entry(selected).path, expected)


class TexCompilationTest(unittest.TestCase):
    def test_completion(self):
        for label, current, preview, error, expected in (
            ('compiled preview', TexCompilation('job'), 'preview', '', 'complete'),
            ('compiler error', TexCompilation('job'), None, 'Missing document class', 'failed'),
            ('no outcome', TexCompilation('job'), None, '', None),
            ('conflicting outcome', TexCompilation('job'), 'preview', 'Error', None),
            ('completed job cannot finish again', TexCompilation('job', 'complete', 'preview'), 'other', '', None),
        ):
            with self.subTest(label=label):
                if expected is None:
                    with self.assertRaises(Invalid):
                        current.finish(preview, error)
                else:
                    self.assertEqual(current.finish(preview, error).status, expected)
