"""Frozen fixed-case comparisons. Tolerance never repairs scientific identity.

No I/O or execution authority. PC-Gym's unresolved paper verdict is invariant.
"""
from dataclasses import asdict, dataclass
import math

from .pcgym_domain import (EPISODE_METRIC, PAPER, REPORTED, Invalid, MetricDefinition,
                           digest, fields, finite, identifier)


@dataclass(frozen=True)
class ComparisonPolicy:
    mode: str
    tolerance: float | None = None
    lower: float | None = None
    upper: float | None = None

    @classmethod
    def parse(cls, raw):
        if not isinstance(raw, dict):
            raise Invalid('comparison_policy', 'Choose an absolute, relative or bounds policy')
        mode = raw.get('mode')
        if mode in ('absolute', 'relative'):
            fields(raw, ('mode', 'tolerance'))
            tolerance = finite(raw['tolerance'], 'tolerance')
            if tolerance < 0:
                raise Invalid('comparison_policy', 'Tolerance must be nonnegative')
            return cls(mode, tolerance=tolerance)
        if mode == 'bounds':
            fields(raw, ('mode', 'lower', 'upper'))
            lower, upper = finite(raw['lower'], 'lower'), finite(raw['upper'], 'upper')
            if lower > upper:
                raise Invalid('comparison_policy', 'Lower bound must not exceed upper bound')
            return cls(mode, lower=lower, upper=upper)
        raise Invalid('comparison_policy', 'Choose absolute, relative or bounds')

    def to_dict(self):
        if self.mode == 'bounds':
            return dict(mode=self.mode, lower=self.lower, upper=self.upper)
        return dict(mode=self.mode, tolerance=self.tolerance)

    def assess(self, reported, actual):
        reported, actual = finite(reported, 'reported'), finite(actual, 'actual')
        difference = finite(actual - reported, 'difference')
        relative = abs(difference) / abs(reported) if reported != 0 else None
        if relative is not None and not math.isfinite(relative):
            relative = None
        if self.mode == 'relative' and relative is None:
            return dict(status='undefined', difference=difference, relative_error=None,
                        reason='Relative error is undefined for a zero reported value' if reported == 0 else
                        'Relative error cannot be represented as a finite number')
        within = (self.lower <= actual <= self.upper if self.mode == 'bounds' else
                  (relative if self.mode == 'relative' else abs(difference)) <= self.tolerance)
        return dict(status='within_tolerance' if within else 'outside_tolerance',
                    difference=difference, relative_error=relative)


@dataclass(frozen=True)
class ComparisonEvidence:
    spec_id: str
    paper_version: str
    metric: MetricDefinition
    full_coverage: bool
    execution_status: str
    actual: float | None
    integrity_verified: bool


@dataclass(frozen=True)
class VerificationItem:
    """A policy revision has a new identity; reruns retain this identity and spec."""
    spec_id: str
    paper_binding_digest: str
    annotation_id: str
    policy: str
    comparison: ComparisonPolicy
    reported: float
    paper_version: str = PAPER
    metric: MetricDefinition = EPISODE_METRIC

    @classmethod
    def create(cls, spec, annotation_id, policy, comparison):
        if spec.paper_binding_digest is None:
            raise Invalid('binding_required', 'Freeze the saved PDF and annotation before creating an item')
        identifier(annotation_id, 'annotation_id')
        if policy not in spec.policies:
            raise Invalid('policy', 'Choose a policy covered by this frozen specification')
        return cls(spec.id, spec.paper_binding_digest, annotation_id, policy,
                   ComparisonPolicy.parse(comparison), dict(REPORTED)[policy])

    def payload(self):
        return {**asdict(self), 'comparison': self.comparison.to_dict()}

    @property
    def id(self):
        return digest(self.payload())

    def to_dict(self):
        return dict(id=self.id, **self.payload())

    def compare(self, evidence):
        reasons = []
        if evidence.spec_id != self.spec_id or evidence.paper_version != self.paper_version:
            reasons.append('version_mismatch')
        if evidence.metric != self.metric:
            reasons.append('metric_mismatch')
        if not evidence.full_coverage:
            reasons.append('incomplete_coverage')
        if not evidence.integrity_verified:
            reasons.append('unverified_execution_evidence')
        if evidence.execution_status != 'completed':
            reasons.append('execution_not_completed')
        if evidence.actual is None:
            reasons.append('no_actual_value')
        # Input validity is checked even when other gates already fail.
        if evidence.actual is not None:
            finite(evidence.actual, 'actual')
        diagnostic = None if reasons else self.comparison.assess(self.reported, evidence.actual)
        reasons.append('pcgym_metric_and_original_experiment_unresolved')
        return dict(item_id=self.id, spec_id=self.spec_id,
                    execution_status=evidence.execution_status,
                    comparison_status='inconclusive', paper_verdict='INCONCLUSIVE',
                    reported=self.reported, actual=evidence.actual,
                    diagnostic=diagnostic, reasons=reasons)


@dataclass(frozen=True)
class ReproductionApproval:
    """One desktop decision over an exact frozen item and local execution binding."""
    item_id: str
    spec_id: str
    request_id: str
    frozen_digest: str

    @classmethod
    def create(cls, item, spec, request_id, binding, local):
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise Invalid('request_id', 'Use a stable request ID of 1–128 characters')
        return cls(item.id, spec.id, request_id,
                   digest(dict(item=item.payload(), spec=spec.to_dict(), paper_binding=binding, local=local)))

    @property
    def key(self):
        return digest(dict(request_id=self.request_id))

    @property
    def digest(self):
        return digest(asdict(self))

    def to_dict(self):
        return asdict(self)
