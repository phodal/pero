import unittest

from paper_agent.model import Invalid
from paper_agent.tex_preview import TexCompilation, TexFailure, TexInput, TexProject


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
            ('compiled preview', TexCompilation('job'), 'preview', None, 'complete'),
            ('compiler error', TexCompilation('job'), None, 'Missing document class', 'failed'),
            ('no outcome', TexCompilation('job'), None, None, None),
            ('conflicting outcome', TexCompilation('job'), 'preview', 'Error', None),
            ('completed job cannot finish again', TexCompilation('job', 'complete', 'preview'), 'other', None, None),
        ):
            with self.subTest(label=label):
                failure = TexFailure(error) if error else None
                if expected is None:
                    with self.assertRaises(Invalid):
                        current.finish(preview, failure)
                else:
                    self.assertEqual(current.finish(preview, failure).status, expected)


class TexFailureTest(unittest.TestCase):
    def test_compiler_diagnostics(self):
        for log, biber_available, timed_out, code, message in (
            ('warning: missing glyph\nnote: Running external tool biber ...\nerror: No such file or directory (os error 2)',
             False, False, 'biber_unavailable', 'A compatible Biber executable is required to build the bibliography.'),
            ('error: the external tool exited with an error code; its stdout was:\n'
             'ERROR - Error: Found biblatex control file version 3.8, expected version 3.9.\n'
             'error: the external tool exited with error code 2',
             True, False, 'biber_version', 'Error: Found biblatex control file version 3.8, expected version 3.9.'),
            ('warning: overfull box\nerror: main.tex:5: Undefined control sequence\nerror: halted',
             False, False, 'compile_failed', 'main.tex:5: Undefined control sequence'),
            ('note: downloading package', False, True, 'timeout', 'TeX compilation exceeded 180 seconds.'),
            ('warning: overfull box', False, False, 'compile_failed', 'The compiler did not produce a PDF.'),
        ):
            with self.subTest(code=code, message=message):
                failure = TexFailure.from_compiler(log, biber_available=biber_available, timed_out=timed_out)
                self.assertEqual(failure, TexFailure(message, code, log))
