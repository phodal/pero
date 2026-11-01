"""Pure decisions for the one-shot, fixed-case Host approval.

The shell supplies saved values and execution facts, generates pending tickets,
then applies the returned intents. No storage, process, clock or secret source.
"""
from dataclasses import dataclass, field
import hmac
from typing import Literal

from .pcgym_domain import Invalid, digest, fields, identifier
from .verification import ReproductionApproval


class ApprovalUnavailable(Invalid):
    """The supplied trusted-composition fact disables this operation."""
    def __init__(self):
        super().__init__('execution_disabled', 'Local computation is disabled by the trusted composition root')


class ApprovalDenied(Invalid):
    """The transport maps this domain refusal to HTTP 403."""
    def __init__(self):
        super().__init__('approval_required', 'The one-time Host approval is missing, expired or changed')


@dataclass(frozen=True)
class ApprovalCommand:
    operation: Literal['prepare', 'decide', 'cancel']
    item_id: str
    spec_id: str
    request_id: str
    ticket: str | None = field(default=None, repr=False)
    binding_digest: str | None = None
    decision: str | None = None

    @classmethod
    def parse(cls, raw, *, available=True):
        operation = raw.get('operation') if isinstance(raw, dict) else None
        required = ('operation', 'itemId', 'specId', 'requestId')
        fields(raw, required + (('ticket', 'bindingDigest', 'decision') if operation == 'decide' else ()))
        if operation not in ('prepare', 'decide', 'cancel'):
            raise Invalid('operation', 'Unknown private reproduction operation')
        if not available:
            raise ApprovalUnavailable()
        item_id, spec_id = identifier(raw['itemId'], 'itemId'), identifier(raw['specId'], 'specId')
        request_id = raw['requestId']
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise Invalid('request_id', 'Use a stable request ID of 1–128 characters')
        # Invalid capability values become absent, so the capability gate owns the
        # refusal. Known decision choices are deliberately checked after that gate.
        return cls(operation, item_id, spec_id, request_id,
                   raw.get('ticket') if isinstance(raw.get('ticket'), str) else None,
                   raw.get('bindingDigest') if isinstance(raw.get('bindingDigest'), str) else None,
                   raw.get('decision') if isinstance(raw.get('decision'), str) else None)

    @property
    def key(self):
        return digest(dict(request_id=self.request_id))

    @property
    def stopping(self):
        return self.operation == 'cancel' or (self.operation == 'decide' and self.decision == 'deny')


@dataclass(frozen=True)
class PendingApproval:
    ticket: str = field(repr=False)
    approval: ReproductionApproval


@dataclass(frozen=True)
class ApprovalDecision:
    state: Literal['allowed', 'denied', 'cancelled']
    reason: str = ''

    def to_dict(self):
        return dict(state=self.state, **(dict(reason=self.reason) if self.reason else {}))

    @classmethod
    def closed(cls):
        return cls('cancelled', 'Approval owner closed before dispatch')


@dataclass(frozen=True)
class ApprovalTransition:
    """Apply consume -> save approval/decision -> new pending -> dispatch/cancel.

    In particular a dispatch intent never precedes consumption and durable
    decision persistence. A failure applying either must prevent dispatch.
    For ``new``, the shell generates a ticket for ``approval``; ``reuse`` returns
    the existing pending value without generating a new capability.
    """
    approval: ReproductionApproval
    outcome: str
    reason: str = ''
    save_approval: bool = False
    save_decision: ApprovalDecision | None = None
    pending_action: Literal['none', 'new', 'reuse', 'consume'] = 'none'
    pending: PendingApproval | None = None
    dispatch: bool = False
    cancel_matching: bool = False


@dataclass(frozen=True)
class ExecutionFacts:
    lock_present: bool
    attempt_states: tuple[str, ...]
    request_states: tuple[str, ...]

    @property
    def busy(self):
        terminal = ('completed', 'failed', 'cancelled')
        return (self.lock_present or any(state not in terminal for state in self.attempt_states)
                or any(state not in terminal for state in self.request_states))


@dataclass(frozen=True)
class ApprovalState:
    saved: ReproductionApproval | None = None
    pending: PendingApproval | None = None
    decision: ApprovalDecision | None = None

    def close(self) -> ApprovalTransition | None:
        """Plan each pending cancellation before the shell clears all capabilities.

        The shell clears every pending ticket before applying any persistence
        intent and must still clean up owned processes if a write fails.
        """
        if self.pending is None:
            return None
        decision = ApprovalDecision.closed()
        return ApprovalTransition(self.pending.approval, decision.state, decision.reason,
                                  save_decision=decision, pending_action='consume')

    def needs_execution_status(self, command: ApprovalCommand) -> bool:
        return (command.operation == 'prepare' and self.saved is None
                and self.pending is None and self.decision is None)

    def binding_for(self, command: ApprovalCommand) -> ReproductionApproval | None:
        """Return the saved binding when executable inputs must not be reread."""
        if (command.stopping or self.decision is not None) and self.saved is not None:
            if (self.saved.item_id != command.item_id or self.saved.spec_id != command.spec_id
                    or self.saved.request_id != command.request_id):
                raise Invalid('approval_changed', 'The request belongs to another item or specification')
            return self.saved
        return None

    def transition(self, command: ApprovalCommand, current: ReproductionApproval, *,
                   busy: bool = False, owner_request_id: str | None = None,
                   owner_live: bool = False) -> ApprovalTransition:
        if (current.item_id != command.item_id or current.spec_id != command.spec_id
                or current.request_id != command.request_id or
                (self.saved is not None and self.saved != current)):
            raise Invalid('approval_changed', 'This request belongs to a different frozen approval; create a new request')
        if self.decision is not None:
            return ApprovalTransition(current, self.decision.state, self.decision.reason,
                cancel_matching=(command.operation == 'cancel' and owner_live
                                 and owner_request_id == current.request_id))
        if command.operation == 'prepare':
            if self.saved is not None and self.pending is None:
                decision = ApprovalDecision('cancelled', 'Approval owner restarted before dispatch')
                return ApprovalTransition(current, decision.state, decision.reason, save_decision=decision)
            if self.pending is None:
                if busy:
                    return ApprovalTransition(current, 'blocked',
                        'Reconcile the existing execution before requesting another run')
                return ApprovalTransition(current, 'requires-approval', save_approval=True, pending_action='new')
            return ApprovalTransition(current, 'requires-approval', pending_action='reuse', pending=self.pending)
        if command.operation == 'cancel':
            decision = ApprovalDecision('cancelled', 'Cancelled before dispatch')
            return ApprovalTransition(current, decision.state, decision.reason, save_approval=True,
                                      save_decision=decision, pending_action='consume')
        pending = self.pending
        if (pending is None or command.ticket is None
                or not hmac.compare_digest(pending.ticket.encode('utf-8', errors='surrogatepass'),
                                           command.ticket.encode('utf-8', errors='surrogatepass'))
                or command.binding_digest != current.digest or pending.approval != current):
            raise ApprovalDenied()
        if command.decision not in ('allow', 'deny'):
            raise Invalid('decision', 'Choose allow or deny')
        decision = ApprovalDecision('allowed' if command.decision == 'allow' else 'denied')
        return ApprovalTransition(current, decision.state, save_decision=decision,
                                  pending_action='consume', dispatch=decision.state == 'allowed')


@dataclass(frozen=True)
class DispatchFailure:
    state: Literal['blocked', 'unknown']
    status: Literal['not_started', 'unknown']
    reason: str
    persist: bool
    propagate: bool

    def to_dict(self):
        return dict(state=self.state, status=self.status, reason=self.reason)


def dispatch_failure(launch_record_exists: bool) -> DispatchFailure:
    """A recorded launch cannot be classified as safe to retry after an error."""
    if launch_record_exists:
        return DispatchFailure('unknown', 'unknown',
                               'A launch request exists; reconcile execution before retry', False, True)
    return DispatchFailure('blocked', 'not_started',
        'Execution was refused before launch; inspect current status before a new request', True, False)
