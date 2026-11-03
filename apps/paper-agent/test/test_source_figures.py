"""Figure association values and one real approved PDF-image/report journey."""
import base64
import tempfile
import unittest

from test_source_archives import archive_bytes
from test_source_downloads import SourceDownloads, SourceTransport, bundle, finish, NOW
from test_pdf import image_pdf_fixture, pdf_fixture
from paper_agent.model import Invalid, PaperSnapshot, digest
from paper_agent.source_archive import SourceArchive
from paper_agent.source_figures import SourceFigure
from paper_agent.source_reading import source_read
from paper_agent.source_reports import source_report
from paper_agent.store import ResearchStore

TEX = r'''\documentclass{article}
\begin{document}
\begin{figure}\includegraphics{figures/ablation}\caption{Ablation of two methods.}\label{fig:ablation}\end{figure}
\end{document}'''


class SourceFiguresTest(unittest.TestCase):
    def test_literal_associations_keep_ambiguity_and_original_locations(self):
        for label, reference, files, expected in (
            ('relative to TeX', 'figures/ablation', ('paper/figures/ablation.pdf',), 1),
            ('project root', 'plot.png', ('plot.png',), 1),
            ('ambiguous omitted extension', 'plot', ('plot.png', 'plot.pdf'), 2),
            ('missing graphicspath', 'plot', ('figures/plot.pdf',), 0),
            ('macro remains unresolved', r'\asset/plot', ('figures/plot.pdf',), 0),
        ):
            with self.subTest(label=label):
                tex = TEX.replace('figures/ablation', reference)
                archive, _, _ = SourceArchive.inspect(archive_bytes([('paper/main.tex', tex.encode()), *((name, b'not rendered') for name in files)]))
                figure, = SourceFigure.in_archive(archive)
                self.assertEqual(len(figure.memberIds), expected)
                self.assertEqual((figure.caption, figure.label, figure.startLine, figure.endLine), ('Ablation of two methods.', 'fig:ablation', 3, 3))

        paired = TEX.replace(r'\end{figure}', r'\includegraphics{other.pdf}\caption{Transfer results.}\label{fig:transfer}\end{figure}')
        archive, _, _ = SourceArchive.inspect(archive_bytes([('main.tex', paired.encode())]))
        self.assertEqual([(f.reference, f.caption, f.label) for f in SourceFigure.in_archive(archive)],
                         [('figures/ablation', 'Ablation of two methods.', 'fig:ablation'), ('other.pdf', 'Transfer results.', 'fig:transfer')])

    def test_approved_figure_read_cache_replay_and_exact_version(self):
        original = image_pdf_fixture()
        data = archive_bytes([('main.tex', TEX.encode()), ('figures/ablation.pdf', original), ('multipage.pdf', pdf_fixture())])
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            self.addCleanup(lambda: store.source_downloads.close())
            selection, _ = bundle(store)
            store.source_downloads = SourceDownloads(store, SourceTransport(data))
            store.source_downloads.request(dict(operation='start', **selection))
            self.assertEqual(finish(store.source_downloads, selection)['status'], 'source_available')
            def paper(revision):
                result = PaperSnapshot.from_reading(dict(source='arxiv', sourceId='2610.24806' + revision,
                    title='Local fixture', url='https://arxiv.org/abs/2610.24806' + revision,
                    contentKind='abstract', content='Self-authored figure fixture.'), NOW)
                store.save_paper(result)
                return result
            paper_v1 = paper('v1')
            query = dict(operation='figures', paperId=paper_v1.id, query='ablation')
            figures = source_read(store, query)
            figure, = figures['figures']
            self.assertTrue(figure['resolved'])
            self.assertEqual(figure['members'][0]['path'], 'figures/ablation.pdf')
            self.assertEqual(figures['links'], [dict(label='Local fixture', location=f'paper/{paper_v1.id}')])
            self.assertEqual(source_read(store, dict(query, paperId=paper('v2').id))['sources'], [])
            self.assertEqual(source_report(store, dict(operation='observations', bundleId=selection['bundleId']), NOW)['observations'], [])
            image_request = dict(operation='image', **selection, memberId=figure['members'][0]['id'])
            before = (store.root / 'source-archives' / (digest(data) + '.json')).read_bytes()
            image = source_read(store, image_request)
            pixels = base64.b64decode(image['data'])
            self.assertTrue(pixels.startswith(b'\x89PNG\r\n\x1a\n'))
            self.assertEqual(image['provenance']['originalSha256'], digest(original))
            self.assertEqual(image['provenance']['previewSha256'], digest(pixels))
            self.assertNotEqual(digest(original), digest(pixels))
            reopened = ResearchStore(directory)
            self.addCleanup(lambda: reopened.source_downloads.close())
            self.assertEqual(source_read(reopened, image_request), image)
            report = source_report(reopened, dict(operation='create', bundleId=selection['bundleId'], title='Figure evidence', observationIds=[image['observationId']]), NOW)
            self.assertTrue(report['currentAvailability'][0]['available'])
            self.assertEqual(report['observations'][0]['anchor']['visualReview'], 'not_reviewed')
            self.assertEqual((store.root / 'source-archives' / (digest(data) + '.json')).read_bytes(), before)
            members = source_read(store, dict(operation='list', **selection))['members']
            multi = next(m for m in members if m['path'] == 'multipage.pdf')
            with self.assertRaisesRegex(Invalid, 'single-page'):
                source_read(store, dict(image_request, memberId=multi['id']))
            path = store.root / 'source-figure-previews' / (figure['members'][0]['id'] + '.png')
            path.write_bytes(b'changed preview')
            with self.assertRaisesRegex(Invalid, 'integrity'):
                source_read(store, image_request)
