"""Reference admission, source identity and immutable review revisions."""
from dataclasses import FrozenInstanceError
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.model import Invalid
from paper_agent.numeric_evidence import NumericEvidence, ReferenceAssessment


def observation(**changes):
    return dict(identity=dict(metric='accuracy', condition='test split', series='model A', statistic='mean', unit='fraction'),
                anchor=dict(documentId='a' * 64, fileDigest='b' * 64, page=1), sourceKind='table',
                method='native_text', role='paper_reported', rawText='0.5', value=.5,
                semanticConfirmed=True, unitConfirmed=True, transcriptionConfirmed=True,
                reviewer='R', reason='Checked original source and quantity', **changes)


def evidence(**changes):
    return NumericEvidence.parse(dict(observation(), **changes))


class NumericEvidenceTest(unittest.TestCase):
    def test_admission_table(self):
        cases = [({}, 'numeric_ready', None),
                 ({'semanticConfirmed': False}, 'needs_review', 'semantic_identity_unconfirmed'),
                 ({'identity': dict(observation()['identity'], metric='')}, 'needs_review', 'semantic_identity_missing'),
                 ({'identity': dict(observation()['identity'], unit='')}, 'needs_review', 'unit_missing'),
                 ({'unitConfirmed': False}, 'needs_review', 'unit_unconfirmed'),
                 ({'transcriptionConfirmed': False}, 'needs_review', 'transcription_unconfirmed'),
                 ({'method': 'ocr', 'recognitionScore': .999, 'reviewer': None, 'reason': None}, 'needs_review', 'explicit_review_required'),
                 ({'method': 'visual', 'reviewer': None, 'reason': None}, 'needs_review', 'explicit_review_required'),
                 ({'method': 'native_text', 'reviewer': None, 'reason': None}, 'needs_review', 'explicit_review_required'),
                 ({'role': 'reproduction_output'}, 'needs_review', 'reproduction_output_not_reference'),
                 ({'rawText': '5'}, 'needs_review', 'raw_value_mismatch'),
                 ({'sourceKind': 'figure'}, 'needs_review', 'axis_calibration_missing'),
                 ({'issues': ['missing_sign']}, 'needs_review', 'missing_sign'),
                 ({'value': None}, 'unavailable', 'numeric_value_missing')]
        for changes, status, issue in cases:
            with self.subTest(changes=changes):
                result = ReferenceAssessment.assess([evidence(**changes)])
                self.assertEqual(result.status, status)
                if issue:
                    self.assertIn(issue, result.issues)
                    with self.assertRaises(Invalid):
                        result.freeze()
                else:
                    self.assertEqual(result.freeze().to_dict()['value'], .5)
                    self.assertEqual(result.cross_check_status, 'not_checked')

    def test_semantic_match_precedes_source_priority(self):
        base = evidence()
        for field in ('metric', 'condition', 'series', 'statistic', 'unit'):
            identity = dict(base.identity.to_dict(), **{field: 'different'})
            other = evidence(identity=identity, sourceKind='author_data', value=2, rawText='2')
            result = ReferenceAssessment.assess([base, other])
            with self.subTest(field=field):
                self.assertEqual(result.status, 'needs_review')
                self.assertIn('semantic_identity_mismatch', result.issues)
                self.assertEqual(result.conflicts, ())
                self.assertIsNone(result.selected)
        other_version = evidence(anchor=dict(documentId='c' * 64, fileDigest='d' * 64, page=1))
        self.assertIn('semantic_identity_mismatch', ReferenceAssessment.assess([base, other_version]).issues)

    def test_conflict_retained_despite_source_priority(self):
        result = ReferenceAssessment.assess([evidence(), evidence(sourceKind='author_data', value=.8, rawText='.8')])
        self.assertEqual(result.status, 'needs_review')
        self.assertEqual(len(result.conflicts), 1)
        self.assertEqual(result.cross_check_status, 'conflict')
        self.assertIsNone(result.selected)

    def test_matching_values_choose_source_and_record_cross_check(self):
        preferred = evidence(sourceKind='author_data')
        result = ReferenceAssessment.assess([evidence(), preferred])
        self.assertEqual(result.selected, preferred)
        self.assertEqual(result.cross_check_status, 'no_conflict')

    def test_review_revision_retains_prior_reference_and_conflicts(self):
        old = evidence()
        before = ReferenceAssessment.assess([old]).freeze()
        revision = evidence(method='manual', value=.8, reviewer='A. Reviewer', reason='Reread original decimal', previousId=old.id)
        after = ReferenceAssessment.assess([old, revision])
        self.assertEqual(after.status, 'numeric_ready')
        self.assertTrue(after.conflicts[0].resolved)
        self.assertNotEqual(before.id, after.freeze().id)
        self.assertEqual(before.to_dict()['value'], .5)
        self.assertEqual(after.freeze().to_dict()['value'], .8)
        self.assertEqual(revision.to_dict()['reviewProvenance'], 'client_reported_local_review')
        with self.assertRaises(FrozenInstanceError):
            old.value = .8
        unresolved = ReferenceAssessment.assess([old, revision, evidence(sourceKind='caption')])
        self.assertEqual(unresolved.status, 'needs_review')
        self.assertTrue(any(not c.resolved for c in unresolved.conflicts))

    def test_unrelated_or_missing_revision_target_blocks(self):
        for previous_id in ('f' * 64, evidence(identity=dict(observation()['identity'], metric='loss')).id):
            result = ReferenceAssessment.assess([evidence(), evidence(method='manual', reviewer='R', reason='Correct', previousId=previous_id)])
            self.assertIn('invalid_correction_target', result.issues)

    def test_qualitative_requires_independently_reviewed_series_and_direction(self):
        args = dict(value=None, reviewer='R', reason='Legend and direction legible', seriesReliable=True, directionReliable=True)
        self.assertEqual(ReferenceAssessment.assess([evidence(**args)]).status, 'qualitative_only')
        for key in ('seriesReliable', 'directionReliable', 'semanticConfirmed'):
            self.assertEqual(ReferenceAssessment.assess([evidence(**dict(args, **{key: False}))]).status, 'unavailable')
        self.assertEqual(ReferenceAssessment.assess([evidence(**dict(args, reviewer=None, reason=None))]).status, 'unavailable')

    def test_ocr_review_and_scores_remain_separate(self):
        item = evidence(method='ocr', reviewer='R', reason='Checked original', recognitionScore=98.3)
        self.assertEqual(ReferenceAssessment.assess([item]).status, 'numeric_ready')
        self.assertEqual(item.recognition_score, 98.3)
        self.assertEqual(ReferenceAssessment.assess([item]).to_dict()['confidence']['level'], 'medium')
        self.assertEqual(item.to_dict()['confidence']['meaning'], 'evidence_quality_not_probability')

    def test_point_must_use_axis_interpolation(self):
        axis = dict(ticks=[dict(pixel=p, value=v, rawText=str(v)) for p, v in [(0, 0), (100, 1), (200, 2)]],
                    pixel=50, unitConfirmed=True, multiplierConfirmed=True, transcriptionConfirmed=True)
        args = dict(method='pixel_calibration', sourceKind='figure', reviewer='R', reason='Verified axis', axis=axis)
        self.assertEqual(ReferenceAssessment.assess([evidence(**args)]).status, 'numeric_ready')
        self.assertIn('value_not_calibrated_point', evidence(**dict(args, value=1)).checks())
        self.assertIn('point_outside_axis', evidence(**dict(args, axis=dict(axis, pixel=201))).checks())

    def test_caption_axis_cross_check_is_not_general_source_check(self):
        result = ReferenceAssessment.assess([evidence(), evidence(sourceKind='caption')]).to_dict()
        self.assertEqual(result['crossCheck']['status'], 'no_conflict')
        self.assertEqual(result['captionAxisCrossCheck']['status'], 'not_checked')
        axis = dict(ticks=[dict(pixel=p, value=v, rawText=str(v)) for p, v in [(0, 0), (100, 1), (200, 2)]],
                    pixel=50, unitConfirmed=True, multiplierConfirmed=True, transcriptionConfirmed=True)
        figure = evidence(sourceKind='figure', method='pixel_calibration', axis=axis, reviewer='R', reason='Checked')
        for value, status in [(.5, 'no_conflict'), (.8, 'conflict')]:
            result = ReferenceAssessment.assess([figure, evidence(sourceKind='caption', value=value, rawText=str(value))]).to_dict()
            self.assertEqual(result['captionAxisCrossCheck']['status'], status)

    def test_tiny_calibrated_values_do_not_use_absolute_epsilon(self):
        axis = dict(ticks=[dict(pixel=p, value=v, rawText=str(v)) for p, v in [(0, 0), (100, 1e-15), (200, 2e-15)]],
                    pixel=50, unitConfirmed=True, multiplierConfirmed=True, transcriptionConfirmed=True)
        args = dict(method='pixel_calibration', sourceKind='figure', reviewer='R', reason='Verified', axis=axis)
        self.assertIn('value_not_calibrated_point', evidence(**dict(args, value=0)).checks())
        self.assertEqual(evidence(**dict(args, value=5e-16)).checks(), ())

    def test_unchecked_axis_cannot_claim_caption_agreement(self):
        axis = dict(ticks=[dict(pixel=p, value=v, rawText=str(v)) for p, v in [(0, 0), (100, 1), (200, 2)]],
                    pixel=50, unitConfirmed=True, multiplierConfirmed=False, transcriptionConfirmed=True)
        figure = evidence(sourceKind='figure', method='pixel_calibration', axis=axis, reviewer='R', reason='Checked')
        result = ReferenceAssessment.assess([figure, evidence(sourceKind='caption')]).to_dict()
        self.assertEqual(result['captionAxisCrossCheck']['status'], 'not_checked')

    def test_known_conflict_cannot_be_omitted_by_new_assessment(self):
        first = evidence()
        conflicting = evidence(sourceKind='caption', value=.8, rawText='.8')
        result = ReferenceAssessment.assess_known([first], [first, conflicting, first])
        self.assertEqual(result.status, 'needs_review')
        self.assertEqual(len(result.evidences), 2)
        with self.assertRaises(Invalid):
            result.freeze()

    def test_known_quantities_remain_independent(self):
        first = evidence()
        conflicting = evidence(sourceKind='caption', value=.8, rawText='.8')
        different = evidence(identity=dict(first.identity.to_dict(), metric='recall'))
        result = ReferenceAssessment.assess_known([different], [first, conflicting])
        self.assertEqual(result.status, 'numeric_ready')
        self.assertEqual(result.evidences, (different,))
        self.assertEqual(ReferenceAssessment.assess_known([], [first, conflicting]).status, 'unavailable')

    def test_known_correction_history_is_retained(self):
        first = evidence()
        revised = evidence(method='manual', value=.8, reviewer='R', reason='Reread decimal', previousId=first.id)
        result = ReferenceAssessment.assess_known([revised], [first, revised])
        self.assertEqual(result.status, 'numeric_ready')
        self.assertEqual(result.superseded_ids, (first.id,))
        self.assertTrue(result.conflicts[0].resolved)
        # Selecting the old candidate again cannot undo its recorded correction.
        reopened = ReferenceAssessment.assess_known([first], result.evidences)
        self.assertEqual(reopened.selected.id, revised.id)

    def test_extraction_provenance_survives_merge_and_freeze(self):
        item = evidence(method='ocr', reviewer='R', reason='Verified', extractionId='e' * 64)
        restored = NumericEvidence.parse(item.to_dict())
        self.assertEqual(restored, item)
        self.assertEqual(restored.extraction_id, 'e' * 64)
        result = ReferenceAssessment.assess_known([restored], [item])
        self.assertEqual(result.freeze().to_dict()['extractionId'], 'e' * 64)
        self.assertNotEqual(item.id, evidence(method='ocr', reviewer='R', reason='Verified', extractionId='f' * 64).id)
        for invalid in ('bad', 1, True):
            with self.subTest(invalid=invalid), self.assertRaises(Invalid):
                evidence(extractionId=invalid)

    def test_roundtrip_preserves_content_identity(self):
        item = evidence(method='ocr', reviewer='R', reason='Verified', recognitionScore=99)
        self.assertEqual(item, NumericEvidence.parse(item.to_dict()))
        self.assertEqual(item.id, NumericEvidence.parse(item.to_dict()).id)

    def test_invalid_input_table(self):
        for changes in [dict(method='manual', reviewer=None, reason=None), dict(reviewer='R', reason=None), dict(value=float('inf')),
                        dict(value=True), dict(unitConfirmed='true'), dict(previousId='bad'),
                        dict(sourceKind='code_default'), dict(role='expected')]:
            with self.subTest(changes=changes), self.assertRaises(Invalid):
                evidence(**changes)
        self.assertEqual(ReferenceAssessment.assess([]).status, 'unavailable')
        with self.assertRaises(Invalid):
            ReferenceAssessment.assess([evidence(), evidence()])
