"""Immutable observations and conservative admission to numerical comparison.

Recognition scores describe an engine, never scientific correctness. Client review
records are local assertions, not authenticated reviewer identities.
"""
from dataclasses import dataclass
import math

from .axis_calibration import AxisCalibration, flag, literal_number, number
from .model import ID, Invalid, digest, mapping, sequence, text
from .pdf import PdfAnchor

SOURCE_ORDER = ('author_data', 'table', 'text', 'caption', 'figure')
METHODS = ('native_text', 'ocr', 'visual', 'pixel_calibration', 'manual')
ROLES = ('paper_reported', 'derived_reference', 'reproduction_output')


@dataclass(frozen=True)
class QuantityIdentity:
    metric: str
    condition: str
    series: str
    statistic: str
    unit: str

    @classmethod
    def parse(cls, value):
        value = mapping(value, 'quantity identity')
        return cls(*(text(value.get(k), 1000, k) for k in ('metric', 'condition', 'series', 'statistic', 'unit')))

    def to_dict(self):
        return dict(metric=self.metric, condition=self.condition, series=self.series,
                    statistic=self.statistic, unit=self.unit)


@dataclass(frozen=True)
class NumericEvidence:
    identity: QuantityIdentity
    anchor: PdfAnchor
    source_kind: str
    method: str
    role: str
    raw_text: str
    value: float | None
    engine: str
    engine_version: str
    recognition_score: float | None
    semantic_confirmed: bool
    unit_confirmed: bool
    transcription_confirmed: bool
    series_reliable: bool
    direction_reliable: bool
    axis: AxisCalibration | None
    reviewer: str | None
    reason: str | None
    previous_id: str | None
    issues: tuple[str, ...]
    extraction_id: str | None = None

    @classmethod
    def parse(cls, value):
        value = mapping(value, 'numeric evidence')
        source_kind, method, role = (value.get(k) for k in ('sourceKind', 'method', 'role'))
        if source_kind not in SOURCE_ORDER or method not in METHODS or role not in ROLES:
            raise Invalid('Choose an explicit numeric source, extraction method and role')
        reviewer = text(value['reviewer'], 500, 'reviewer') if value.get('reviewer') is not None else None
        reason = text(value['reason'], 4000, 'review reason') if value.get('reason') is not None else None
        if bool(reviewer) != bool(reason) or method == 'manual' and not reviewer:
            raise Invalid('Manual review requires both reviewer and reason')
        previous_id = value.get('previousId')
        if previous_id is not None and (not isinstance(previous_id, str) or not ID.fullmatch(previous_id) or not reviewer):
            raise Invalid('A correction requires a prior evidence ID, reviewer and reason')
        extraction_id = value.get('extractionId')
        if extraction_id is not None and (not isinstance(extraction_id, str) or not ID.fullmatch(extraction_id)):
            raise Invalid('An extraction ID must identify an immutable extraction record')
        numeric = None if value.get('value') is None else number(value['value'], 'evidence value')
        score = None if value.get('recognitionScore') is None else number(value['recognitionScore'], 'raw recognition score')
        axis = AxisCalibration.parse(value['axis']) if value.get('axis') is not None else None
        issues = tuple(text(i, 1000, 'evidence issue') for i in sequence(value.get('issues', []), 100, 'evidence issues'))
        return cls(QuantityIdentity.parse(value.get('identity')), PdfAnchor.parse(value.get('anchor')),
                   source_kind, method, role, text(value.get('rawText'), 4000, 'raw observation'), numeric,
                   text(value.get('engine', 'manual' if method == 'manual' else 'unspecified'), 500, 'engine'),
                   text(value.get('engineVersion', 'unspecified'), 500, 'engine version'), score,
                   *(flag(value, key) for key in ('semanticConfirmed', 'unitConfirmed', 'transcriptionConfirmed',
                                                 'seriesReliable', 'directionReliable')),
                   axis, reviewer, reason, previous_id, issues, extraction_id)

    @property
    def id(self):
        return digest(self._content())

    @property
    def quantity_key(self):
        # Different figure/table locations can refer to the same quantity, but
        # different immutable paper versions cannot silently be pooled.
        return self.anchor.document_id, self.anchor.file_digest, self.identity

    def checks(self):
        issues = list(self.issues)
        if self.role == 'reproduction_output':
            issues.append('reproduction_output_not_reference')
        if not self.semantic_confirmed:
            issues.append('semantic_identity_unconfirmed')
        if not self.unit_confirmed:
            issues.append('unit_unconfirmed')
        if not self.transcription_confirmed:
            issues.append('transcription_unconfirmed')
        # Every semantic/transcription confirmation in this POC is a local
        # review assertion, including PDF text that may itself be archival OCR.
        if not self.reviewer:
            issues.append('explicit_review_required')
        if self.value is None:
            issues.append('numeric_value_missing')
        elif self.method in ('native_text', 'ocr', 'visual') and literal_number(self.raw_text) != self.value:
            issues.append('raw_value_mismatch')
        if self.method == 'pixel_calibration' or self.source_kind == 'figure':
            if self.axis is None:
                issues.append('axis_calibration_missing')
        if self.axis:
            issues.extend(self.axis.issues)
            if self.axis.pixel is None:
                issues.append('point_pixel_missing')
            elif not self.axis.issues and self.value is not None:
                calibrated = self.axis.point_value()
                if not math.isclose(calibrated, self.value, rel_tol=1e-9, abs_tol=8 * max(math.ulp(calibrated), math.ulp(self.value))):
                    issues.append('value_not_calibrated_point')
        return tuple(dict.fromkeys(issues))

    def _content(self):
        return dict(identity=self.identity.to_dict(), anchor=self.anchor.to_dict(), sourceKind=self.source_kind,
                    method=self.method, role=self.role, rawText=self.raw_text, value=self.value,
                    engine=self.engine, engineVersion=self.engine_version, recognitionScore=self.recognition_score,
                    semanticConfirmed=self.semantic_confirmed, unitConfirmed=self.unit_confirmed,
                    transcriptionConfirmed=self.transcription_confirmed, seriesReliable=self.series_reliable,
                    directionReliable=self.direction_reliable, axis=self.axis.to_dict() if self.axis else None,
                    reviewer=self.reviewer, reason=self.reason, previousId=self.previous_id, issues=list(self.issues), extractionId=self.extraction_id)

    def confidence(self):
        checks = self.checks()
        level = 'unknown' if self.value is None else 'low' if checks else 'medium'
        return dict(level=level, reasons=list(checks) if checks else ['admission_checks_satisfied'],
                    meaning='evidence_quality_not_probability')

    def to_dict(self):
        return dict(id=self.id, **self._content(), checks=list(self.checks()), confidence=self.confidence(),
                    reviewProvenance='client_reported_local_review' if self.reviewer else None,
                    recognitionScoreMeaning='raw_engine_score_not_scientific_confidence')


@dataclass(frozen=True)
class SourceConflict:
    evidence_ids: tuple[str, str]
    values: tuple[float, float]
    resolved: bool = False

    def to_dict(self):
        return dict(kind='source_conflict', evidenceIds=list(self.evidence_ids), values=list(self.values),
                    resolved=self.resolved)


@dataclass(frozen=True)
class FrozenReference:
    assessment_id: str
    evidence: NumericEvidence
    evidence_ids: tuple[str, ...]

    @property
    def id(self):
        return digest(dict(assessmentId=self.assessment_id, selectedEvidenceId=self.evidence.id))

    def to_dict(self):
        return dict(id=self.id, schema='pero.numeric-reference.v1', assessmentId=self.assessment_id,
                    evidenceId=self.evidence.id, evidenceIds=list(self.evidence_ids), value=self.evidence.value,
                    extractionId=self.evidence.extraction_id,
                    identity=self.evidence.identity.to_dict(), anchor=self.evidence.anchor.to_dict(),
                    status='numeric_ready', scientificAcceptance='not_assessed')


@dataclass(frozen=True)
class ReferenceAssessment:
    evidences: tuple[NumericEvidence, ...]
    status: str
    selected: NumericEvidence | None
    issues: tuple[str, ...]
    conflicts: tuple[SourceConflict, ...]
    cross_check_status: str
    superseded_ids: tuple[str, ...]

    @classmethod
    def assess_known(cls, proposed, prior_evidences):
        """Retain known observations of each proposed quantity across requests.

        The shell supplies saved evidence; choosing a new assessment ID cannot
        erase an unresolved source conflict or its correction history.
        """
        proposed = tuple(proposed)
        prior_evidences = tuple(prior_evidences)
        if not proposed:
            return cls.assess(())
        if any(not isinstance(e, NumericEvidence) for e in proposed + prior_evidences):
            raise Invalid('Parse numeric evidence before assessment')
        if len({e.id for e in proposed}) != len(proposed):
            raise Invalid('Duplicate numeric evidence')
        quantities = {e.quantity_key for e in proposed}
        known = {e.id: e for e in prior_evidences if e.quantity_key in quantities}
        known.update((e.id, e) for e in proposed)
        return cls.assess(tuple(known.values()))

    @classmethod
    def assess(cls, evidences):
        evidences = tuple(evidences)
        if len(evidences) > 100:
            raise Invalid('Assess at most 100 observations for one selected result')
        if any(not isinstance(e, NumericEvidence) for e in evidences):
            raise Invalid('Parse numeric evidence before assessment')
        by_id = {e.id: e for e in evidences}
        if len(by_id) != len(evidences):
            raise Invalid('Duplicate numeric evidence')
        superseded = set()
        issues = []
        for e in evidences:
            if e.previous_id:
                previous = by_id.get(e.previous_id)
                if previous is None or previous.quantity_key != e.quantity_key or previous.role != e.role:
                    issues.append('invalid_correction_target')
                else:
                    superseded.add(previous.id)
        active = tuple(e for e in evidences if e.id not in superseded)
        conflicts = []
        for i, left in enumerate(evidences):
            for right in evidences[i + 1:]:
                if left.semantic_confirmed and right.semantic_confirmed and left.quantity_key == right.quantity_key and left.value is not None and right.value is not None and left.value != right.value:
                    conflicts.append(SourceConflict((left.id, right.id), (left.value, right.value),
                                                    left.id in superseded or right.id in superseded))
        unresolved = any(not c.resolved for c in conflicts)
        if unresolved:
            issues.append('source_conflict')
        if len({e.quantity_key for e in active}) > 1:
            issues.append('semantic_identity_mismatch')
        for e in active:
            issues.extend(e.checks())
        issues = tuple(dict.fromkeys(issues))
        ready = bool(active) and not issues
        selected = min(active, key=lambda e: (SOURCE_ORDER.index(e.source_kind), e.id)) if ready else None
        qualitative = bool(active) and all(e.series_reliable and e.direction_reliable and e.semantic_confirmed
                                          and e.reviewer and e.role != 'reproduction_output' for e in active)
        # Any source/identity conflict remains reviewable, even with reliable trends.
        absolute_only = {'numeric_value_missing', 'transcription_unconfirmed', 'raw_value_mismatch',
                         'unit_unconfirmed', 'axis_calibration_missing', 'point_pixel_missing',
                         'tick_transcription_unconfirmed', 'tick_transcription_mismatch', 'axis_unit_unconfirmed',
                         'axis_multiplier_unconfirmed', 'insufficient_ticks', 'ambiguous_scale',
                         'axis_geometry_inconsistent', 'declared_scale_inconsistent', 'tick_geometry_degenerate',
                         'tick_values_not_monotonic', 'value_not_calibrated_point'}
        if ready:
            status = 'numeric_ready'
        elif qualitative and set(issues) <= absolute_only:
            status = 'qualitative_only'
        elif not active or all(e.value is None for e in active) and not qualitative and not unresolved:
            status = 'unavailable'
        else:
            status = 'needs_review'
        cross_check = 'conflict' if unresolved else 'no_conflict' if len(active) >= 2 and all(e.semantic_confirmed for e in active) and len({e.quantity_key for e in active}) == 1 else 'not_checked'
        return cls(evidences, status, selected, issues, tuple(conflicts), cross_check, tuple(sorted(superseded)))

    @property
    def id(self):
        return digest(dict(schema='pero.reference-assessment.v1', evidenceIds=sorted(e.id for e in self.evidences),
                           status=self.status, issues=sorted(self.issues)))

    def freeze(self):
        if self.status != 'numeric_ready' or self.selected is None:
            raise Invalid('Resolve all numeric reference checks before freezing', 409)
        return FrozenReference(self.id, self.selected, tuple(e.id for e in self.evidences))

    def to_dict(self):
        active = [e for e in self.evidences if e.id not in self.superseded_ids]
        captions = [e for e in active if e.source_kind == 'caption']
        figures = [e for e in active if e.source_kind == 'figure' and e.axis is not None]
        pairs = [(a, b) for a in captions for b in figures
                 if a.quantity_key == b.quantity_key and a.semantic_confirmed and b.semantic_confirmed
                 and a.value is not None and b.value is not None]
        caption_axis = 'conflict' if any(a.value != b.value for a, b in pairs) else 'no_conflict' if pairs and all(not a.checks() and not b.checks() for a, b in pairs) else 'not_checked'
        level = 'medium' if self.status == 'numeric_ready' else 'unknown' if self.status == 'unavailable' else 'low'
        return dict(id=self.id, schema='pero.reference-assessment.v1', status=self.status,
                    selectedEvidenceId=self.selected.id if self.selected else None,
                    selected=self.selected.to_dict() if self.selected else None,
                    evidenceIds=[e.id for e in self.evidences], issues=list(self.issues),
                    conflicts=[c.to_dict() for c in self.conflicts], supersededIds=list(self.superseded_ids),
                    crossCheck=dict(status=self.cross_check_status), captionAxisCrossCheck=dict(status=caption_axis),
                    confidence=dict(level=level, reasons=list(self.issues) if self.issues else ['admission_checks_satisfied'],
                                    meaning='evidence_quality_not_probability'), scientificAcceptance='not_assessed')
