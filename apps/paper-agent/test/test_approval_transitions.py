"""Value-only approval decisions: no process, files, Host, or scientific engine."""
from dataclasses import replace
import unittest

from test_pcgym_reproduction import specification  # establishes backend module path
from paper_agent.pcgym_domain import Invalid
from paper_agent.verification import ReproductionApproval
from paper_agent.reproduction_approval import (ApprovalCommand, ApprovalDecision, ApprovalDenied, ApprovalUnavailable,
    ApprovalState, ExecutionFacts, PendingApproval, dispatch_failure)

APPROVAL = ReproductionApproval('a' * 64, 'b' * 64, 'fixed-request', 'c' * 64)
PENDING = PendingApproval('d' * 64, APPROVAL)


def command(operation='prepare', **changes):
    raw = dict(operation=operation, itemId=APPROVAL.item_id, specId=APPROVAL.spec_id,
               requestId=APPROVAL.request_id)
    if operation == 'decide':
        raw.update(ticket=PENDING.ticket, bindingDigest=APPROVAL.digest, decision='allow')
    return ApprovalCommand.parse({**raw, **changes})


class ApprovalTransitions(unittest.TestCase):
    def test_capabilities_are_not_exposed_by_typed_value_repr(self):
        for value in (PENDING, command('decide'), ApprovalState(APPROVAL, PENDING),
                      ApprovalState(APPROVAL, PENDING).transition(command(), APPROVAL)):
            self.assertNotIn(PENDING.ticket, repr(value))

    def test_availability_preserves_shape_then_authority_then_identity_priority(self):
        raw = dict(operation='prepare', itemId='invalid', specId='invalid', requestId='')
        with self.assertRaises(ApprovalUnavailable):
            ApprovalCommand.parse(raw, available=False)
        with self.assertRaises(Invalid) as identity:
            ApprovalCommand.parse(raw, available=True)
        self.assertEqual(identity.exception.code, 'identity')
        for invalid in ({**raw, 'extra': True}, {**raw, 'operation': 'unknown'},
                        dict(operation='prepare')):
            with self.subTest(invalid=invalid), self.assertRaises(Invalid) as shape:
                ApprovalCommand.parse(invalid, available=False)
            self.assertNotIsInstance(shape.exception, ApprovalUnavailable)
            self.assertIn(shape.exception.code, ('schema', 'operation'))

    def test_boundary_rejects_malformed_identity_and_unknown_fields(self):
        for changes in (dict(itemId='wrong'), dict(specId='wrong'), dict(requestId=''),
                        dict(requestId=True), dict(operation='launch'), dict(approved=True)):
            with self.subTest(changes=changes), self.assertRaises(Invalid):
                command(**changes)

    def test_prepare_new_reused_busy_and_restart(self):
        cases = (
            (ApprovalState(), False, 'requires-approval', 'new', True),
            (ApprovalState(), True, 'blocked', 'none', False),
            (ApprovalState(APPROVAL, PENDING), True, 'requires-approval', 'reuse', False),
            (ApprovalState(APPROVAL), True, 'cancelled', 'none', False),
        )
        for state, busy, outcome, action, save in cases:
            with self.subTest(state=state, busy=busy):
                result = state.transition(command(), APPROVAL, busy=busy)
                self.assertEqual((result.outcome, result.pending_action, result.save_approval),
                                 (outcome, action, save))
                self.assertFalse(result.dispatch)
                self.assertFalse(result.cancel_matching)
                self.assertEqual(result.pending, PENDING if action == 'reuse' else None)
                if outcome == 'cancelled':
                    self.assertEqual(result.save_decision,
                        ApprovalDecision('cancelled', 'Approval owner restarted before dispatch'))
        self.assertTrue(ApprovalState().needs_execution_status(command()))
        for state in (ApprovalState(APPROVAL), ApprovalState(APPROVAL, PENDING),
                      ApprovalState(APPROVAL, decision=ApprovalDecision('allowed'))):
            self.assertFalse(state.needs_execution_status(command()))
        for operation in ('cancel', 'decide'):
            self.assertFalse(ApprovalState().needs_execution_status(command(operation)))

    def test_stopping_and_repeat_decision_use_saved_binding(self):
        state = ApprovalState(APPROVAL, PENDING)
        self.assertIsNone(state.binding_for(command()))
        self.assertIsNone(state.binding_for(command('decide')))
        self.assertEqual(state.binding_for(command('decide', decision='deny')), APPROVAL)
        self.assertEqual(state.binding_for(command('cancel')), APPROVAL)
        terminal = replace(state, decision=ApprovalDecision('allowed'))
        for operation in ('prepare', 'cancel', 'decide'):
            with self.subTest(operation=operation):
                self.assertEqual(terminal.binding_for(command(operation)), APPROVAL)
        for changes in (dict(itemId='e' * 64), dict(specId='e' * 64), dict(requestId='different')):
            with self.subTest(changes=changes), self.assertRaises(Invalid):
                terminal.binding_for(command('cancel', **changes))
            with self.subTest(changes=changes), self.assertRaises(Invalid):
                state.transition(command(**changes), APPROVAL)
        with self.assertRaises(Invalid):
            state.transition(command(), replace(APPROVAL, frozen_digest='f' * 64))

    def test_capability_gate_precedes_decision_and_consumes_before_dispatch(self):
        state = ApprovalState(APPROVAL, PENDING)
        for changes in (dict(ticket='wrong'), dict(ticket=None), dict(ticket=True), dict(ticket='\u4e0d\u5339\u914d'),
                        dict(ticket='\ud800'),
                        dict(bindingDigest='wrong'), dict(ticket='wrong', decision='invalid')):
            with self.subTest(changes=changes), self.assertRaises(ApprovalDenied):
                state.transition(command('decide', **changes), APPROVAL)
        with self.assertRaises(ApprovalDenied):
            ApprovalState(APPROVAL).transition(command('decide'), APPROVAL)
        with self.assertRaises(ApprovalDenied):
            replace(state, pending=PendingApproval(PENDING.ticket, replace(APPROVAL, frozen_digest='e' * 64))).transition(
                command('decide'), APPROVAL)
        with self.assertRaises(Invalid) as invalid:
            state.transition(command('decide', decision='invalid'), APPROVAL)
        self.assertEqual(invalid.exception.code, 'decision')
        for choice, outcome, dispatch in (('allow', 'allowed', True), ('deny', 'denied', False)):
            with self.subTest(choice=choice):
                result = state.transition(command('decide', decision=choice), APPROVAL)
                self.assertEqual(result.outcome, outcome)
                self.assertEqual(result.pending_action, 'consume')
                self.assertEqual(result.save_decision, ApprovalDecision(outcome))
                self.assertEqual(result.dispatch, dispatch)
                # Feed the resulting durable decision back: a lost response cannot relaunch.
                saved = ApprovalState(APPROVAL, decision=result.save_decision)
                repeated = saved.transition(command('decide', ticket='expired'), APPROVAL)
                self.assertEqual(repeated.outcome, outcome)
                self.assertFalse(repeated.dispatch)
                self.assertEqual(repeated.pending_action, 'none')
                self.assertIsNone(repeated.save_decision)

    def test_cancel_only_matching_live_owner_after_decision(self):
        state = ApprovalState(APPROVAL, decision=ApprovalDecision('allowed'))
        for operation, owner, live, cancel in (
            ('cancel', APPROVAL.request_id, True, True),
            ('cancel', 'another-request', True, False),
            ('cancel', APPROVAL.request_id, False, False),
            ('prepare', APPROVAL.request_id, True, False),
            ('decide', APPROVAL.request_id, True, False),
        ):
            with self.subTest(operation=operation, owner=owner, live=live):
                result = state.transition(command(operation), APPROVAL,
                                          owner_request_id=owner, owner_live=live)
                self.assertEqual(result.cancel_matching, cancel)
                self.assertEqual(result.outcome, 'allowed')
                self.assertFalse(result.dispatch)
        cancelled = ApprovalState(APPROVAL, PENDING).transition(command('cancel'), APPROVAL)
        self.assertEqual(cancelled.outcome, 'cancelled')
        self.assertEqual(cancelled.pending_action, 'consume')
        self.assertTrue(cancelled.save_approval)
        self.assertEqual(cancelled.save_decision.reason, 'Cancelled before dispatch')
        self.assertFalse(cancelled.cancel_matching)

    def test_execution_facts_preserve_unknown_and_lock_as_busy(self):
        for lock, attempts, requests, expected in (
            (False, (), (), False),
            (False, ('completed', 'failed'), ('cancelled',), False),
            (True, ('completed',), (), True),
            (False, ('unknown',), (), True),
            (False, (), ('starting',), True),
            (False, ('running',), (), True),
            (False, (), ('unexpected',), True),
        ):
            with self.subTest(lock=lock, attempts=attempts, requests=requests):
                self.assertEqual(ExecutionFacts(lock, attempts, requests).busy, expected)

    def test_close_and_dispatch_failure_never_offer_replay(self):
        state = ApprovalState(APPROVAL, PENDING)
        close = state.close()
        self.assertEqual(close.pending_action, 'consume')
        self.assertEqual(close.save_decision, ApprovalDecision.closed())
        self.assertEqual(close.approval, APPROVAL)
        self.assertFalse(close.dispatch)
        self.assertIsNone(ApprovalState(APPROVAL).close())
        self.assertIsNone(ApprovalState(APPROVAL, decision=ApprovalDecision('allowed')).close())
        self.assertEqual(ApprovalDecision.closed().to_dict(),
                         dict(state='cancelled', reason='Approval owner closed before dispatch'))
        refused = dispatch_failure(False)
        self.assertEqual((refused.state, refused.status, refused.persist, refused.propagate),
                         ('blocked', 'not_started', True, False))
        uncertain = dispatch_failure(True)
        self.assertEqual((uncertain.state, uncertain.status, uncertain.persist, uncertain.propagate),
                         ('unknown', 'unknown', False, True))
