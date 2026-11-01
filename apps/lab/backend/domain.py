"""Immutable Color Mixing domain. Fractions are illustrative, not fluid physics."""
from dataclasses import asdict, dataclass, replace
import math
from typing import Literal

WELL_IDS = tuple(f'{row}{column}' for row in 'ABCDEFGH' for column in range(1, 13))
TIP_IDS = tuple(f'T{i}' for i in range(1, 97))
OPERATIONS = ('pickup_tip', 'return_tip', 'aspirate', 'dispense')


class Invalid(ValueError):
    def __init__(self, code: str, message: str, step_index: int | None = None):
        super().__init__(message)
        self.code, self.step_index = code, step_index

    def to_dict(self):
        return {'code': self.code, 'message': str(self), 'step_index': self.step_index}


def object_fields(value, allowed, required=()):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        raise Invalid('schema', f'Expected object fields {", ".join(allowed)}; required: {", ".join(required)}')
    return value


def number(value, name, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or (isinstance(value,float) and not math.isfinite(value)):
        raise Invalid('quantity', f'{name} must be a finite number')
    if not minimum <= value <= maximum:
        raise Invalid('quantity', f'{name} must be between {minimum} and {maximum}')
    return float(value)


def integer(value, name, minimum, maximum):
    result = number(value, name, minimum, maximum)
    if result != int(result):
        raise Invalid('quantity', f'{name} must be an integer')
    return int(result)


@dataclass(frozen=True)
class Well:
    id: str
    volume_ul: float
    red_fraction: float
    capacity_ul: float = 300.0


@dataclass(frozen=True)
class Pipette:
    tip_id: str | None = None
    volume_ul: float = 0.0
    red_fraction: float = 0.0
    capacity_ul: float = 300.0


@dataclass(frozen=True)
class LabState:
    wells: tuple[Well, ...]
    available_tips: tuple[str, ...]
    consumed_tips: tuple[str, ...]
    pipette: Pipette
    revision: int = 0

    def well(self, resource: str) -> Well:
        for well in self.wells:
            if well.id == resource:
                return well
        raise Invalid('well', f'Unknown well {resource}; use A1–H12')

    def to_dict(self):
        return {'wells': [asdict(w) for w in self.wells], 'available_tips': list(self.available_tips),
                'consumed_tips': list(self.consumed_tips), 'pipette': asdict(self.pipette),
                'revision': self.revision}


def initial_state() -> LabState:
    return LabState(tuple(Well(id, 200.0 if id in ('A1', 'A2') else 0.0,
                               1.0 if id == 'A1' else 0.0) for id in WELL_IDS),
                    TIP_IDS, (), Pipette())


@dataclass(frozen=True)
class Operation:
    op: Literal['pickup_tip', 'return_tip', 'aspirate', 'dispense']
    resource: str
    volume_ul: float | None = None

    def to_dict(self):
        result = {'op': self.op, 'resource': self.resource}
        if self.volume_ul is not None:
            result['volume_ul'] = self.volume_ul
        return result


@dataclass(frozen=True)
class Protocol:
    version: int
    initial_revision: int
    steps: tuple[Operation, ...]

    def to_dict(self):
        return {'version': self.version, 'initial_revision': self.initial_revision,
                'steps': [step.to_dict() for step in self.steps]}


def parse_operation(raw) -> Operation:
    raw = object_fields(raw, ('op', 'resource', 'volume_ul'), ('op', 'resource'))
    op, resource = raw['op'], raw['resource']
    if op not in OPERATIONS:
        raise Invalid('operation', 'Unsupported operation; use pickup_tip, return_tip, aspirate or dispense')
    if not isinstance(resource, str) or resource not in (TIP_IDS if op.endswith('tip') else WELL_IDS):
        raise Invalid('resource', 'Expected T1–T96 for tips or A1–H12 for wells')
    if op in ('aspirate', 'dispense'):
        volume = number(raw.get('volume_ul'), 'volume_ul (µL)', 0, 300)
        if volume == 0:
            raise Invalid('quantity', 'volume_ul must be greater than zero')
    else:
        if 'volume_ul' in raw:
            raise Invalid('schema', 'Tip operations do not take volume_ul')
        volume = None
    return Operation(op, resource, volume)


def parse_protocol(raw) -> Protocol:
    raw = object_fields(raw, ('version', 'initial_revision', 'steps'), ('version', 'initial_revision', 'steps'))
    version = integer(raw['version'], 'version', 1, 1)
    revision = integer(raw['initial_revision'], 'initial_revision', 0, 1000000)
    if not isinstance(raw['steps'], list) or not 1 <= len(raw['steps']) <= 64:
        raise Invalid('steps', 'Protocol requires 1–64 steps')
    steps = []
    for index, step in enumerate(raw['steps']):
        try:
            steps.append(parse_operation(step))
        except Invalid as error:
            raise Invalid(error.code, str(error), index) from error
    return Protocol(version, revision, tuple(steps))


def apply_operation(state: LabState, operation: Operation) -> LabState:
    """One transition owner; failure returns no state and never mutates its input."""
    p = state.pipette
    op, resource, volume = operation.op, operation.resource, operation.volume_ul
    if op == 'pickup_tip':
        if p.tip_id is not None:
            raise Invalid('tip_attached', 'Return the attached empty tip before picking up another')
        if resource not in state.available_tips:
            raise Invalid('tip_unavailable', f'Tip {resource} is missing or consumed')
        return replace(state, available_tips=tuple(t for t in state.available_tips if t != resource),
                       consumed_tips=state.consumed_tips + (resource,),
                       pipette=replace(p, tip_id=resource), revision=state.revision + 1)
    if op not in OPERATIONS:
        raise Invalid('operation', f'Unsupported operation {op}')
    if p.tip_id is None:
        raise Invalid('missing_tip', 'Pick up an unused tip before this operation')
    if op == 'return_tip':
        if resource != p.tip_id:
            raise Invalid('tip_mismatch', f'Return attached tip {p.tip_id} to its original location')
        if p.volume_ul > 1e-9:
            raise Invalid('tip_not_empty', 'Dispense all liquid before returning the tip')
        return replace(state, pipette=Pipette(capacity_ul=p.capacity_ul), revision=state.revision + 1)
    if volume is None or not math.isfinite(volume) or volume <= 0:
        raise Invalid('quantity', 'volume_ul must be finite and greater than zero')
    well = state.well(resource)
    if op == 'aspirate':
        if volume > well.volume_ul + 1e-9:
            raise Invalid('depletion', f'{resource} has only {well.volume_ul:g} µL')
        if p.volume_ul + volume > p.capacity_ul + 1e-9:
            raise Invalid('pipette_capacity', f'Pipette capacity is {p.capacity_ul:g} µL')
        total = p.volume_ul + volume
        pipette = replace(p, volume_ul=total,
                          red_fraction=(p.volume_ul * p.red_fraction + volume * well.red_fraction) / total)
        updated = replace(well, volume_ul=max(0.0, well.volume_ul - volume))
    else:
        if volume > p.volume_ul + 1e-9:
            raise Invalid('pipette_depletion', f'Pipette contains only {p.volume_ul:g} µL')
        total = well.volume_ul + volume
        if total > well.capacity_ul + 1e-9:
            raise Invalid('well_capacity', f'{resource} capacity is {well.capacity_ul:g} µL')
        updated = replace(well, volume_ul=total,
                          red_fraction=(well.volume_ul * well.red_fraction + volume * p.red_fraction) / total)
        remaining = max(0.0, p.volume_ul - volume)
        pipette = replace(p, volume_ul=remaining, red_fraction=p.red_fraction if remaining else 0.0)
    return replace(state, wells=tuple(updated if w.id == resource else w for w in state.wells),
                   pipette=pipette, revision=state.revision + 1)


def validate_protocol_envelope(protocol: Protocol, initial_revision: int, max_steps: int):
    if protocol.version != 1 or protocol.initial_revision != initial_revision:
        raise Invalid('state_mismatch', 'Protocol version or initial revision does not match the frozen state')
    if not 1 <= len(protocol.steps) <= max_steps:
        raise Invalid('step_budget', f'Protocol requires 1–{max_steps} steps')


def validate_protocol(state: LabState, protocol: Protocol, max_steps: int = 64) -> tuple[LabState, ...]:
    validate_protocol_envelope(protocol, state.revision, max_steps)
    snapshots = []
    for index, operation in enumerate(protocol.steps):
        try:
            state = apply_operation(state, operation)
        except Invalid as error:
            raise Invalid(error.code, str(error), index) from error
        snapshots.append(state)
    return tuple(snapshots)


@dataclass(frozen=True)
class EvaluationCriteria:
    target_well: str = 'B1'
    target_fraction: float = 0.5
    tolerance: float = 0.05
    target_volume_ul: float = 100.0
    volume_tolerance_ul: float = 1.0

    def to_dict(self):
        return asdict(self)


@dataclass(frozen=True)
class Experiment:
    id: str
    objective: str
    criteria: EvaluationCriteria
    initial_state: LabState
    max_trials: int = 4
    max_steps: int = 64
    created_revision: int = 1
    mode: str = 'simulation'
    allowed_operations: tuple[str, ...] = OPERATIONS

    def to_dict(self):
        return {'id': self.id, 'objective': self.objective, 'criteria': self.criteria.to_dict(),
                'initial_state': self.initial_state.to_dict(), 'max_trials': self.max_trials,
                'max_steps': self.max_steps, 'created_revision': self.created_revision,
                'mode': self.mode, 'allowed_operations': list(self.allowed_operations)}


def parse_experiment(raw, experiment_id: str) -> Experiment:
    raw = object_fields(raw, ('objective', 'target_fraction', 'tolerance', 'max_trials', 'max_steps'))
    objective = raw.get('objective', 'Mix 100 µL at red fraction 0.5 in B1')
    if not isinstance(objective, str) or not 1 <= len(objective.strip()) <= 500:
        raise Invalid('objective', 'Objective must contain 1–500 characters')
    criteria = EvaluationCriteria(target_fraction=number(raw.get('target_fraction', .5), 'target_fraction', 0, 1),
                                  tolerance=number(raw.get('tolerance', .05), 'tolerance', 0, 1))
    return Experiment(experiment_id, objective.strip(), criteria, initial_state(),
                      integer(raw.get('max_trials', 4), 'max_trials', 1, 8),
                      integer(raw.get('max_steps', 64), 'max_steps', 1, 64))


TRIAL_TRANSITIONS = {
    'proposed': ('validated', 'cancelled'),
    'validated': ('running', 'cancelled'),
    'running': ('completed', 'cancelled', 'failed', 'unknown'),
    'completed': (), 'cancelled': (), 'failed': (), 'unknown': (),
}


def transition_trial(status: str, next_status: str) -> str:
    if next_status not in TRIAL_TRANSITIONS.get(status, ()):
        raise Invalid('trial_transition', f'Cannot change trial from {status} to {next_status}; create a new candidate')
    return next_status


def parse_state(raw) -> LabState:
    """Deserialize persisted snapshots at the storage boundary, not in transitions."""
    raw = object_fields(raw, ('wells', 'available_tips', 'consumed_tips', 'pipette', 'revision'),
                        ('wells', 'available_tips', 'consumed_tips', 'pipette', 'revision'))
    if not isinstance(raw['wells'], (list, tuple)) or len(raw['wells']) != 96:
        raise Invalid('state', 'State must contain exactly 96 wells')
    wells = []
    for item in raw['wells']:
        item = object_fields(item, ('id', 'volume_ul', 'red_fraction', 'capacity_ul'),
                             ('id', 'volume_ul', 'red_fraction', 'capacity_ul'))
        wells.append(Well(item['id'], number(item['volume_ul'], 'volume_ul', 0, 300),
                          number(item['red_fraction'], 'red_fraction', 0, 1),
                          number(item['capacity_ul'], 'capacity_ul', 300, 300)))
    if tuple(w.id for w in wells) != WELL_IDS:
        raise Invalid('state', 'State well identities/order must match the 96-well plate')
    available, consumed = raw['available_tips'], raw['consumed_tips']
    if not isinstance(available, (tuple, list)) or not isinstance(consumed, (tuple, list)):
        raise Invalid('state', 'Tip inventory must be a list')
    all_tips = tuple(available) + tuple(consumed)
    if any(not isinstance(t, str) for t in all_tips) or len(all_tips) != 96 or set(all_tips) != set(TIP_IDS):
        raise Invalid('state', 'Available and consumed tips must partition T1–T96')
    p = object_fields(raw['pipette'], ('tip_id', 'volume_ul', 'red_fraction', 'capacity_ul'),
                      ('tip_id', 'volume_ul', 'red_fraction', 'capacity_ul'))
    pipette = Pipette(p['tip_id'], number(p['volume_ul'], 'pipette volume_ul', 0, 300),
                      number(p['red_fraction'], 'pipette red_fraction', 0, 1),
                      number(p['capacity_ul'], 'pipette capacity_ul', 300, 300))
    if pipette.tip_id is not None and pipette.tip_id not in consumed:
        raise Invalid('state', 'Attached tip must be consumed from inventory')
    if pipette.tip_id is None and pipette.volume_ul:
        raise Invalid('state', 'Liquid cannot be held without a tip')
    return LabState(tuple(wells), tuple(available), tuple(consumed), pipette,
                    integer(raw['revision'], 'revision', 0, 1000000))


def parse_experiment_snapshot(raw) -> Experiment:
    raw = object_fields(raw, ('id', 'objective', 'criteria', 'initial_state', 'max_trials', 'max_steps',
                             'created_revision', 'mode', 'allowed_operations'),
                        ('id', 'objective', 'criteria', 'initial_state', 'max_trials', 'max_steps',
                         'created_revision', 'mode', 'allowed_operations'))
    criteria = parse_criteria(raw['criteria'])
    if (raw['mode'] != 'simulation' or not isinstance(raw['allowed_operations'], (list, tuple))
            or tuple(raw['allowed_operations']) != OPERATIONS or raw['created_revision'] != 1):
        raise Invalid('experiment', 'Unsupported frozen experiment configuration')
    c = criteria.to_dict()
    experiment = parse_experiment({'objective': raw['objective'], 'target_fraction': c['target_fraction'],
                                   'tolerance': c['tolerance'], 'max_trials': raw['max_trials'],
                                   'max_steps': raw['max_steps']}, raw['id'])
    state = parse_state(raw['initial_state'])
    if state != initial_state():
        raise Invalid('experiment', 'Frozen initial state does not match Color Mixing v1')
    return experiment


def parse_criteria(raw) -> EvaluationCriteria:
    raw = object_fields(raw, ('target_well', 'target_fraction', 'tolerance', 'target_volume_ul', 'volume_tolerance_ul'),
                        ('target_well', 'target_fraction', 'tolerance', 'target_volume_ul', 'volume_tolerance_ul'))
    if raw['target_well'] != 'B1':
        raise Invalid('criteria', 'Color Mixing v1 target is B1')
    return EvaluationCriteria('B1', number(raw['target_fraction'], 'target_fraction', 0, 1),
                              number(raw['tolerance'], 'tolerance', 0, 1),
                              number(raw['target_volume_ul'], 'target_volume_ul', 100, 100),
                              number(raw['volume_tolerance_ul'], 'volume_tolerance_ul', 1, 1))


@dataclass(frozen=True)
class TrialReference:
    id: str
    evaluated: bool


@dataclass(frozen=True)
class ProposalContext:
    max_trials: int
    max_steps: int
    initial_revision: int
    trials: tuple[TrialReference, ...]


def validate_proposal(context: ProposalContext, protocol: Protocol,
                      parent_id: str | None, reason: str) -> str:
    """Admit a candidate without executing it or changing frozen search policy."""
    if len(context.trials) >= context.max_trials:
        raise Invalid('trial_budget', 'Frozen trial budget exhausted')
    if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 2000:
        raise Invalid('rationale', 'A revision rationale is required (1–2000 characters)')
    if parent_id is not None:
        if not isinstance(parent_id, str) or not parent_id:
            raise Invalid('parent', 'Parent trial must be a nonempty trial identity')
        parent = next((trial for trial in context.trials if trial.id == parent_id), None)
        if parent is None:
            raise Invalid('parent', 'Parent trial does not belong to this experiment')
        if not parent.evaluated:
            raise Invalid('parent', 'Evaluate the parent trial before proposing a revision')
    elif context.trials:
        raise Invalid('parent', 'Further candidates must link an evaluated parent trial')
    validate_protocol_envelope(protocol, context.initial_revision, context.max_steps)
    return reason.strip()
