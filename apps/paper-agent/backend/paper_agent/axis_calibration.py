"""Pure pixel-space calibration. Geometry validates consistency, not transcription."""
from dataclasses import dataclass
import math
import re

from .model import Invalid, mapping, sequence, text


def number(value, name):
    if type(value) not in (int, float):
        raise Invalid(f'Invalid {name}: expected a finite number')
    try:
        parsed = float(value)
    except OverflowError:
        raise Invalid(f'Invalid {name}: expected a finite number') from None
    if not math.isfinite(parsed):
        raise Invalid(f'Invalid {name}: expected a finite number')
    return parsed


def flag(value, key):
    result = value.get(key, False)
    if type(result) is not bool:
        raise Invalid(f'Invalid {key}: expected a boolean')
    return result


def literal_number(raw):
    # Unicode minus is a numeric glyph, not a guessed missing sign.
    normalized = raw.strip().replace('\N{MINUS SIGN}', '-')
    if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', normalized):
        return None
    parsed = float(normalized)
    return parsed if math.isfinite(parsed) else None


@dataclass(frozen=True)
class AxisTick:
    pixel: float
    raw_text: str
    value: float

    @classmethod
    def parse(cls, value):
        value = mapping(value, 'axis tick')
        return cls(number(value.get('pixel'), 'tick pixel'), text(value.get('rawText'), 100, 'tick text'),
                   number(value.get('value'), 'tick value'))

    def to_dict(self):
        return dict(pixel=self.pixel, rawText=self.raw_text, value=self.value)


@dataclass(frozen=True)
class AxisFit:
    scale: str
    slope: float
    intercept: float
    residual: float

    def to_dict(self):
        return dict(scale=self.scale, slope=self.slope, intercept=self.intercept, residualPixels=self.residual)


@dataclass(frozen=True)
class AxisCalibration:
    ticks: tuple[AxisTick, ...]
    scale: str
    scale_confirmed: bool
    unit_confirmed: bool
    multiplier_confirmed: bool
    transcription_confirmed: bool
    multiplier: float
    pixel: float | None
    fits: tuple[AxisFit, ...]
    issues: tuple[str, ...]
    selected_scale: str | None

    @classmethod
    def parse(cls, value):
        value = mapping(value, 'axis calibration')
        ticks = tuple(AxisTick.parse(t) for t in sequence(value.get('ticks', []), 100, 'axis ticks'))
        scale = value.get('scale', 'auto')
        if scale not in ('auto', 'linear', 'log'):
            raise Invalid('Only ordinary linear and positive log axes are supported')
        scale_confirmed = flag(value, 'scaleConfirmed')
        unit_confirmed = flag(value, 'unitConfirmed')
        multiplier_confirmed = flag(value, 'multiplierConfirmed')
        transcription_confirmed = flag(value, 'transcriptionConfirmed')
        multiplier = number(value.get('multiplier', 1), 'axis multiplier')
        if multiplier <= 0:
            raise Invalid('Axis multiplier must be positive')
        pixel = None if value.get('pixel') is None else number(value['pixel'], 'point pixel')
        issues = []
        if len(ticks) < (2 if scale_confirmed and scale != 'auto' else 3):
            issues.append('insufficient_ticks')
        if any(literal_number(t.raw_text) != t.value for t in ticks):
            issues.append('tick_transcription_mismatch')
        if not transcription_confirmed:
            issues.append('tick_transcription_unconfirmed')
        if not unit_confirmed:
            issues.append('axis_unit_unconfirmed')
        if not multiplier_confirmed:
            issues.append('axis_multiplier_unconfirmed')
        fits = []
        ordered = sorted(ticks, key=lambda t: t.pixel)
        if len(ticks) >= 2:
            span = ordered[-1].pixel - ordered[0].pixel
            if len(set(t.pixel for t in ticks)) != len(ticks) or span < 10:
                issues.append('tick_geometry_degenerate')
            differences = [b.value - a.value for a, b in zip(ordered, ordered[1:])]
            if not (all(d > 0 for d in differences) or all(d < 0 for d in differences)):
                issues.append('tick_values_not_monotonic')
            for candidate in ('linear', 'log'):
                if candidate == 'log' and any(t.value <= 0 for t in ticks):
                    continue
                xs = [math.log(t.value) if candidate == 'log' else t.value for t in ticks]
                # Center before fitting; residuals are always measured in pixels.
                x_scale = max(abs(x) for x in xs) or 1.0
                p_scale = max(abs(t.pixel) for t in ticks) or 1.0
                normalized_x = [x / x_scale for x in xs]
                normalized_p = [t.pixel / p_scale for t in ticks]
                mean_x = sum(normalized_x) / len(xs)
                mean_p = sum(normalized_p) / len(ticks)
                denom = sum((x - mean_x) ** 2 for x in normalized_x)
                if not denom:
                    continue
                normalized_slope = sum((x - mean_x) * (p - mean_p) for x, p in zip(normalized_x, normalized_p)) / denom
                slope = normalized_slope * p_scale / x_scale
                intercept = (mean_p - normalized_slope * mean_x) * p_scale
                residual = max(abs(t.pixel - (slope * x + intercept)) for x, t in zip(xs, ticks))
                if slope and all(math.isfinite(n) for n in (slope, intercept, residual)):
                    fits.append(AxisFit(candidate, slope, intercept, residual))
            if pixel is not None and not ordered[0].pixel <= pixel <= ordered[-1].pixel:
                issues.append('point_outside_axis')
        eligible = [f for f in fits if f.residual <= 1.0]
        selected = None
        if scale_confirmed and scale != 'auto':
            matches = [f for f in eligible if f.scale == scale]
            if matches:
                selected = scale
            else:
                issues.append('declared_scale_inconsistent')
        elif len(eligible) == 1:
            selected = eligible[0].scale
        elif len(eligible) > 1:
            issues.append('ambiguous_scale')
        else:
            issues.append('axis_geometry_inconsistent')
        return cls(ticks, scale, scale_confirmed, unit_confirmed, multiplier_confirmed,
                   transcription_confirmed, multiplier, pixel, tuple(fits), tuple(issues), selected)

    def point_value(self):
        if self.issues or self.pixel is None or self.selected_scale is None:
            raise Invalid('Resolve axis checks and select an in-range point before interpolation')
        fit = next(f for f in self.fits if f.scale == self.selected_scale)
        transformed = (self.pixel - fit.intercept) / fit.slope
        try:
            result = (math.exp(transformed) if fit.scale == 'log' else transformed) * self.multiplier
        except OverflowError:
            raise Invalid('Calibrated value is outside the finite numeric range') from None
        return number(result, 'calibrated value')

    def to_dict(self):
        return dict(ticks=[t.to_dict() for t in self.ticks], scale=self.scale,
                    scaleConfirmed=self.scale_confirmed, unitConfirmed=self.unit_confirmed,
                    multiplierConfirmed=self.multiplier_confirmed, transcriptionConfirmed=self.transcription_confirmed,
                    multiplier=self.multiplier, pixel=self.pixel, selectedScale=self.selected_scale,
                    fits=[f.to_dict() for f in self.fits], issues=list(self.issues))
