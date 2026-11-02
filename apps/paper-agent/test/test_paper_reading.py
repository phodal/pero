"""Search snapshots acquire fixed HTML through the existing review and store."""
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest

from test_paper_documents import HtmlTransport, SOURCE, NOW
from paper_agent.model import Invalid, PaperSnapshot
from paper_agent.paper_documents import PaperDocuments
from paper_agent.paper_reading import reading_command
from paper_agent.research_resources import ImportDraft, ResearchResource
from paper_agent.store import ResearchStore


class PaperReadingTest(unittest.TestCase):
    def test_review_selection_fixed_reading_and_restart(self):
        for identifier, tex in (('2606.03979', False), ('2606.03979v2', True)):
            with self.subTest(identifier=identifier, tex=tex), tempfile.TemporaryDirectory() as directory:
                store = ResearchStore(directory)
                paper = store.save_paper(PaperSnapshot.from_reading(dict(source='alphaxiv', sourceId=identifier,
                    title='Search result', url='https://www.alphaxiv.org/abs/' + identifier,
                    pdfUrl='https://arxiv.org/pdf/' + identifier, contentKind='full-text',
                    content='The original search text is immutable.'), NOW))
                seed = 'https://arxiv.org/abs/' + identifier
                resource = replace(ResearchResource.linked('https://arxiv.org/abs/2606.03979v2', seed),
                                   excerpt='An independently retrieved abstract.', contentKind='abstract')
                archive = ResearchResource.linked('https://arxiv.org/src/2606.03979v2', seed)
                draft = ImportDraft.create(seed, NOW).finish((resource, archive), ())
                store.imports._replace('import-drafts', draft.id, draft.to_dict())
                review = reading_command(store, paper, dict(operation='review', draftId=draft.id), NOW)
                self.assertEqual(review['version'], 'v2')
                self.assertEqual(store.imports.bundles(), [])
                self.assertEqual(store._list('scientific-documents'), [])
                confirm = dict(operation='confirm', draftId=draft.id, reviewId=review['reviewId'], tex=tex, confirmedDownloads=True)
                for change in (dict(reviewId='changed'), dict(confirmedDownloads=False), dict(tex='yes')):
                    with self.subTest(change=change), self.assertRaises(Invalid):
                        reading_command(store, paper, {**confirm, **change}, NOW)
                selected = reading_command(store, paper, confirm, NOW)
                bundle = selected['bundle']
                self.assertEqual(bundle['pdfDownloadIds'], ())
                self.assertEqual(bundle['sourceDownloadIds'], (archive.id,) if tex else ())
                self.assertEqual(bundle['htmlDownloadIds'], (resource.id,))
                documents = PaperDocuments(store, HtmlTransport(SOURCE, str(Path(directory) / 'calls')))
                request = dict(operation='prepare', paperId=paper.id, bundleId=selected['source']['bundleId'], resourceId=selected['source']['resourceId'])
                document = documents.prepare(request, NOW)
                self.assertEqual(document.paper_id, paper.id)
                self.assertEqual(store.paper(paper.id), paper)
                self.assertEqual(PaperDocuments(ResearchStore(directory)).overview(paper.id)['revisions'][0]['id'], document.id)
                self.assertEqual(store._list('source-observations'), [])
                # An explicit snapshot version never inherits another version's
                # read scope, even if the work itself is the same.
                for snapshot_id in ('2606.03979v1', '2606.03979', '2606.03979v2'):
                    other = store.save_paper(PaperSnapshot.from_reading(dict(source='alphaxiv', sourceId=snapshot_id,
                        title='Earlier or conflicting version', url='https://arxiv.org/abs/' + snapshot_id,
                        pdfUrl='https://arxiv.org/pdf/2606.03979v1', contentKind='abstract', content='Earlier text.'), NOW))
                    self.assertEqual(documents.overview(other.id)['sources'], [])
                    with self.assertRaises(Invalid):
                        documents.prepare({**request, 'paperId': other.id}, NOW)
                    with self.assertRaises(Invalid):
                        reading_command(store, other, dict(operation='review', draftId=draft.id), NOW)
