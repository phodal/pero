"""Live-observation reporting semantics, without live network access."""
from dataclasses import replace
import unittest

from manual.research_metadata import observation
from paper_agent.research_resources import ImportDraft, ResearchResource


class MetadataObservationTest(unittest.TestCase):
    def test_seed_observation_is_not_inferred_from_linked_metadata(self):
        draft = ImportDraft.create('https://research.example/release', '2026-11-01T00:00:00Z')
        seed = replace(ResearchResource.linked(draft.seedUrl, draft.seedUrl), confidence='metadata')
        linked = replace(ResearchResource.linked('https://huggingface.co/example/model', draft.seedUrl), confidence='metadata')
        cases = [
            (draft.finish((seed, linked), ()), 'METADATA_OBSERVED', None),
            (draft.finish((replace(seed, unresolved=('Source unavailable',)), linked), ()), 'INCONCLUSIVE', 'Source unavailable'),
            (draft.finish((linked,), ()), 'INCONCLUSIVE', 'Seed metadata was not resolved.'),
            (draft.finish((), (), 'failed', 'Inspection timed out.'), 'INCONCLUSIVE', 'Inspection timed out.'),
            (draft.finish((), (), 'cancelled', 'Inspection cancelled.'), 'INCONCLUSIVE', 'Inspection cancelled.'),
        ]
        self.assertEqual(draft.resources, ())
        for result, outcome, reason in cases:
            with self.subTest(outcome=outcome, reason=reason):
                receipt = observation(draft, result)
                self.assertEqual((receipt['outcome'], receipt['reason']), (outcome, reason))
                self.assertEqual(receipt['seedUrl'], draft.seedUrl)
                self.assertEqual(len(receipt['resources']), len(result.resources))


if __name__ == '__main__':
    unittest.main()
