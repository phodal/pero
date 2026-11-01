import json
import unittest
from dataclasses import FrozenInstanceError, replace
from domain import (Invalid, LabState, Operation, Pipette, Protocol, apply_operation, initial_state,
                    parse_experiment, parse_experiment_snapshot, parse_protocol, parse_state,
                    transition_trial, validate_protocol, ProposalContext, TrialReference, validate_proposal)


def protocol(red=50, water=50):
    return Protocol(1, 0, (Operation('pickup_tip', 'T1'), Operation('aspirate', 'A1', red),
                          Operation('dispense', 'B1', red), Operation('return_tip', 'T1'),
                          Operation('pickup_tip', 'T2'), Operation('aspirate', 'A2', water),
                          Operation('dispense', 'B1', water), Operation('return_tip', 'T2')))


class DomainTests(unittest.TestCase):
    def test_transitions_and_invalid_operations_are_atomic(self):
        base = initial_state()
        tipped = apply_operation(base, Operation('pickup_tip', 'T1'))
        loaded = apply_operation(tipped, Operation('aspirate', 'A1', 200))
        full = replace(loaded, pipette=replace(loaded.pipette, volume_ul=300))
        returned = apply_operation(tipped, Operation('return_tip', 'T1'))
        cases = [
            (base, Operation('aspirate', 'A1', 1), 'missing_tip'),
            (base, Operation('pickup_tip', 'T97'), 'tip_unavailable'),
            (tipped, Operation('pickup_tip', 'T2'), 'tip_attached'),
            (returned, Operation('pickup_tip', 'T1'), 'tip_unavailable'),
            (tipped, Operation('return_tip', 'T2'), 'tip_mismatch'),
            (loaded, Operation('return_tip', 'T1'), 'tip_not_empty'),
            (tipped, Operation('aspirate', 'Z1', 1), 'well'),
            (tipped, Operation('aspirate', 'B1', 1), 'depletion'),
            (tipped, Operation('aspirate', 'A1', 201), 'depletion'),
            (full, Operation('aspirate', 'A2', 1), 'pipette_capacity'),
            (loaded, Operation('dispense', 'A2', 101), 'well_capacity'),
            (tipped, Operation('dispense', 'B1', 1), 'pipette_depletion'),
            (tipped, Operation('aspirate', 'A1', 0), 'quantity'),
            (tipped, Operation('aspirate', 'A1', -1), 'quantity'),
            (tipped, Operation('aspirate', 'A1', float('nan')), 'quantity'),
            (base, Operation('execute_python', 'anything'), 'operation'),
        ]
        for state, operation, code in cases:
            with self.subTest(operation=operation, code=code):
                before = state.to_dict()
                with self.assertRaises(Invalid) as caught:
                    apply_operation(state, operation)
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(state.to_dict(), before)

    def test_golden_protocol_conserves_volume_and_dye(self):
        initial = initial_state()
        states = validate_protocol(initial, protocol())
        final = states[-1]
        self.assertEqual((final.well('B1').volume_ul, final.well('B1').red_fraction), (100, .5))
        self.assertEqual(sum(w.volume_ul for w in final.wells), 400)
        self.assertEqual(sum(w.volume_ul * w.red_fraction for w in final.wells), 200)
        self.assertEqual(final.consumed_tips, ('T1', 'T2'))
        self.assertIsNone(final.pipette.tip_id)
        self.assertEqual(final.revision, 8)
        self.assertEqual(initial, initial_state())
        self.assertEqual(parse_state(json.loads(json.dumps(final.to_dict()))), final)
        self.assertEqual(validate_protocol(initial, protocol()), states)

    def test_protocol_failure_is_localized_and_leaves_initial_state(self):
        initial = initial_state()
        candidate = Protocol(1, 0, (Operation('pickup_tip', 'T1'), Operation('aspirate', 'B1', 1)))
        with self.assertRaises(Invalid) as caught:
            validate_protocol(initial, candidate)
        self.assertEqual(caught.exception.step_index, 1)
        self.assertEqual(initial, initial_state())
        for candidate, budget in ((replace(protocol(), initial_revision=1), 64), (protocol(), 4)):
            with self.assertRaises(Invalid):
                validate_protocol(initial, candidate, budget)

    def test_boundary_rejects_untyped_and_unbounded_input(self):
        valid = protocol().to_dict()
        invalid = [dict(valid, version=True), dict(valid, arbitrary_code='print(1)'),
                   dict(valid, steps=[]), dict(valid, steps=valid['steps'] * 9)]
        for volume in (True, 0, -1, 10 ** 1000, float('inf'), '50', None):
            altered = protocol().to_dict()
            altered['steps'][1]['volume_ul'] = volume
            invalid.append(altered)
        for candidate in invalid:
            with self.subTest(candidate=candidate), self.assertRaises(Invalid):
                parse_protocol(candidate)
        self.assertEqual(parse_protocol(valid), protocol())

    def test_frozen_experiment_and_snapshot(self):
        experiment = parse_experiment({}, 'exp1')
        with self.assertRaises(FrozenInstanceError):
            experiment.max_trials = 100
        self.assertEqual(parse_experiment_snapshot(json.loads(json.dumps(experiment.to_dict()))), experiment)
        for raw in ({'max_trials': 9}, {'max_steps': 65}, {'target_fraction': True},
                    {'tolerance': -1}, {'mode': 'hardware'}, {'objective': ' '}, {'criteria': {}}):
            with self.subTest(raw=raw), self.assertRaises(Invalid):
                parse_experiment(raw, 'exp1')

    def test_trial_transition_no_replay(self):
        self.assertEqual(transition_trial('proposed', 'validated'), 'validated')
        self.assertEqual(transition_trial('validated', 'running'), 'running')
        for end in ('completed', 'failed', 'cancelled', 'unknown'):
            self.assertEqual(transition_trial('running', end), end)
            with self.assertRaises(Invalid):
                transition_trial(end, 'running')
        with self.assertRaises(Invalid):
            transition_trial('proposed', 'completed')

    def test_frozen_proposal_budget_and_parent_contract(self):
        empty = ProposalContext(2, 64, 0, ())
        evaluated = TrialReference('parent', True)
        waiting = TrialReference('waiting', False)
        self.assertEqual(validate_proposal(empty, protocol(), None, ' baseline '), 'baseline')
        self.assertEqual(validate_proposal(replace(empty, trials=(evaluated,)), protocol(), 'parent', 'feedback'), 'feedback')
        cases = [(replace(empty, max_trials=1, trials=(evaluated,)), 'parent', 'feedback', 'trial_budget'),
                 (replace(empty, trials=(evaluated,)), None, 'feedback', 'parent'),
                 (replace(empty, trials=(waiting,)), 'waiting', 'feedback', 'parent'),
                 (empty, 'missing', 'feedback', 'parent'), (empty, [], 'feedback', 'parent'),
                 (empty, None, '', 'rationale'), (empty, None, 'x' * 2001, 'rationale'),
                 (replace(empty, initial_revision=1), None, 'baseline', 'state_mismatch'),
                 (replace(empty, max_steps=2), None, 'baseline', 'step_budget')]
        for context, parent, reason, code in cases:
            with self.subTest(code=code), self.assertRaises(Invalid) as caught:
                validate_proposal(context, protocol(), parent, reason)
            self.assertEqual(caught.exception.code, code)
