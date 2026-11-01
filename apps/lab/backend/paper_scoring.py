"""Mathematical reproduction only: VERID paper v1 §6.3, equations (1)–(5).

Source: Semantic Representation for Agentic Self-Play in Automated Laboratories,
arXiv:2610.32755v1, DOI 10.48550/arXiv.2610.32755, PDF page 13:
https://www.gstatic.com/science-ai/verid_semantic_lab.pdf
PDF SHA-256: b047f7609e237ca371e42fac76fe77e454cdf6bba5436388499a28ccb3f7783c.

Inputs are full-strength-stock equivalents of red, green, blue and yellow dye;
water is the remaining fraction. The paper scores four estimated target mixtures
against known truth, not single-dye transfer predictions. Natural logarithms give
nats; the four-target arithmetic mean is converted to millinats by multiplying
by 1000. This module is deliberately separate from Color Mixing's evaluation.

No optical calibration, inference model, wet-lab experiment, agent improvement,
or reported 307→58 mnat result is reproduced or claimed by these equations.
"""
from dataclasses import dataclass
import math

BETA = 0.5
EPSILON = 0.03
WATER_CLIP = 1e-4
TOTAL_WEIGHT = BETA ** 2 / 8


@dataclass(frozen=True)
class DyeFractions:
    red: float
    green: float
    blue: float
    yellow: float

    def __post_init__(self):
        for value in self.values:
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or not 0 <= value <= 1 or not math.isfinite(value)):
                raise ValueError('Dye fractions must be finite numbers in [0, 1], not booleans')
        if math.fsum(self.values) > 1:
            raise ValueError('Total dye fraction must not exceed 1; remaining fraction is water')

    @property
    def values(self) -> tuple[float, float, float, float]:
        return self.red, self.green, self.blue, self.yellow

    @property
    def water(self) -> float:
        return 1 - math.fsum(self.values)


def parse_fractions(raw) -> DyeFractions:
    """Validate external data once; inward scoring accepts immutable typed values."""
    if not isinstance(raw, dict) or set(raw) != {'red', 'green', 'blue', 'yellow'}:
        raise ValueError('Expected exactly red, green, blue and yellow dye fractions')
    return DyeFractions(raw['red'], raw['green'], raw['blue'], raw['yellow'])


@dataclass(frozen=True)
class TargetEstimate:
    truth: DyeFractions
    scored: DyeFractions


def _tempered(fractions: DyeFractions) -> tuple[float, ...]:
    total = math.fsum(fractions.values)
    shares = tuple(value / total for value in fractions.values) if total > 0 else (0.25,) * 4
    weights = tuple((share + EPSILON) ** BETA for share in shares)
    normalizer = math.fsum(weights)
    return tuple(weight / normalizer for weight in weights)


def _water_logit(fractions: DyeFractions) -> float:
    water = min(1 - WATER_CLIP, max(WATER_CLIP, fractions.water))
    return math.log(water / (1 - water))


def target_loss_nats(truth: DyeFractions, scored: DyeFractions) -> float:
    """KL(tempered truth || tempered estimate) + weighted squared water logit error."""
    true_distribution, scored_distribution = _tempered(truth), _tempered(scored)
    composition = math.fsum(p * math.log(p / q) for p, q in zip(true_distribution, scored_distribution))
    concentration = TOTAL_WEIGHT * (_water_logit(scored) - _water_logit(truth)) ** 2
    # KL is nonnegative analytically; only floating-point cancellation can go below zero.
    return max(0.0, composition) + concentration


def run_score_mnats(targets: tuple[TargetEstimate, ...]) -> float:
    """Exactly four target losses, arithmetic mean, converted from nats to mnats."""
    if len(targets) != 4:
        raise ValueError('The paper run score requires exactly four target estimates')
    return math.fsum(target_loss_nats(target.truth, target.scored) for target in targets) * 250.0
