"""Persistent research intent and progress, independent of Agent execution."""
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta

from .model import ID, Invalid, digest, mapping, sequence, text
from .research_candidates import ResearchCandidate


def reference(value, label='reference'):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise Invalid('Invalid ' + label)
    return value


@dataclass(frozen=True)
class ResearchBudget:
    rounds: int = 3
    searches: int = 8
    candidates: int = 24
    reads: int = 24
    downloads: int = 6
    downloadBytes: int = 60 * 1024 * 1024
    modelRequests: int = 40
    appCalls: int = 80

    @classmethod
    def parse(cls, value):
        value = mapping(value, 'research limits')
        maxima = dict(rounds=32, searches=100, candidates=1000, reads=500,
                      downloads=32, downloadBytes=512 * 1024 * 1024, modelRequests=500, appCalls=100)
        if set(value) - maxima.keys() or any(type(v) is not int or not 1 <= v <= maxima[k] for k, v in value.items()):
            raise Invalid('Research limits must be positive supported integers')
        return cls(**value)


@dataclass(frozen=True)
class ResearchProtocol:
    question: str
    scope: str
    inclusion: str
    exclusion: str
    seedPaperIds: tuple[str, ...]
    acquisition: str
    limits: ResearchBudget
    noProgressLimit: int
    deadline: str
    minutes: int = 30
    revision: int = 1

    @classmethod
    def parse(cls, value, now):
        seeds = tuple(reference(x, 'seed paper') for x in sequence(value.get('seedPaperIds'), 5, 'seed papers'))
        if not seeds or len(set(seeds)) != len(seeds):
            raise Invalid('Choose 1–5 distinct saved seed papers')
        mode = value.get('acquisition', 'saved_only')
        if mode not in ('saved_only', 'public_pdf', 'public_fulltext'):
            raise Invalid('Choose saved_only, public_pdf or public_fulltext acquisition')
        idle = value.get('noProgressLimit', 2)
        minutes = value.get('minutes', 30)
        if type(idle) is not int or not 1 <= idle <= 10 or type(minutes) is not int or not 1 <= minutes <= 240:
            raise Invalid('Choose a no-progress limit of 1–10 and deadline of 1–240 minutes')
        deadline = (datetime.fromisoformat(now.replace('Z', '+00:00')) + timedelta(minutes=minutes)).isoformat(timespec='seconds').replace('+00:00', 'Z')
        return cls(*(text(value.get(k), 4000, k) for k in ('question', 'scope', 'inclusion', 'exclusion')),
                   seeds, mode, ResearchBudget.parse(value.get('limits', {})), idle, deadline, minutes)

    def to_dict(self):
        return {**asdict(self), 'seedPaperIds': list(self.seedPaperIds)}

    @classmethod
    def restore(cls, value):
        return cls(**{**value, 'seedPaperIds': tuple(value['seedPaperIds']), 'limits': ResearchBudget(**value['limits'])})


@dataclass(frozen=True)
class ResearchUsage:
    rounds: int = 0
    searches: int = 0
    candidates: int = 0
    reads: int = 0
    downloads: int = 0
    downloadBytes: int = 0
    appCalls: int = 0

    def spend(self, resource, amount, limits):
        used = getattr(self, resource) + amount
        if used > getattr(limits, resource):
            raise Invalid('Research budget exhausted: ' + resource, 409)
        return replace(self, **{resource: used})


@dataclass(frozen=True)
class ResearchProgram:
    id: str
    protocol: ResearchProtocol
    createdAt: str
    usage: ResearchUsage = ResearchUsage()
    roundIds: tuple[str, ...] = ()
    gaps: tuple[str, ...] = ()
    stopReason: str | None = None
    noProgress: int = 0
    sequence: int = 0
    candidates: tuple[ResearchCandidate, ...] = ()
    studyIds: tuple[str, ...] = ()
    jobIds: tuple[str, ...] = ()
    executionStatus: str = 'not_started'
    modelRequestsUsed: int = 0
    appCallsUsed: int = 0
    events: tuple['ResearchEvent', ...] = ()
    observationIds: tuple[str, ...] = ()
    sourceReportIds: tuple[str, ...] = ()
    researchRecordIds: tuple[str, ...] = ()

    @classmethod
    def create(cls, value, now):
        protocol = ResearchProtocol.parse(value, now)
        identity = digest(dict(requestId=text(value.get('requestId'), 200, 'request ID')))
        return cls(identity, protocol, now)

    @property
    def checkpoint(self):
        return digest(self.to_record())

    def to_record(self):
        value = {**asdict(self), 'protocol': self.protocol.to_dict(), 'roundIds': list(self.roundIds), 'gaps': list(self.gaps),
                'candidates': [c.to_dict() for c in self.candidates], 'studyIds': list(self.studyIds), 'jobIds': list(self.jobIds),
                'events': [asdict(event) for event in self.events], 'observationIds': list(self.observationIds), 'sourceReportIds': list(self.sourceReportIds)}
        if self.researchRecordIds:
            value['researchRecordIds'] = list(self.researchRecordIds)
        else:
            del value['researchRecordIds']
        return value

    @classmethod
    def restore(cls, value):
        return cls(**{**value, 'protocol': ResearchProtocol.restore(value['protocol']),
                      'usage': ResearchUsage(**value['usage']), 'roundIds': tuple(value['roundIds']), 'gaps': tuple(value['gaps']),
                      'candidates': tuple(ResearchCandidate.restore(c) for c in value.get('candidates', [])),
                      'studyIds': tuple(value.get('studyIds', [])), 'jobIds': tuple(value.get('jobIds', [])),
                      'researchRecordIds': tuple(value.get('researchRecordIds', [])),
                      'events': tuple(ResearchEvent(**e) for e in value.get('events', [])),
                      'observationIds': tuple(value.get('observationIds', [])), 'sourceReportIds': tuple(value.get('sourceReportIds', []))})

    def admit(self, expected, now, *, finalizing=False):
        if expected != self.checkpoint:
            raise Invalid('Research checkpoint changed; read the current program', 409)
        if self.stopReason and not finalizing:
            raise Invalid('Research stopped: ' + self.stopReason, 409)
        if not finalizing and datetime.fromisoformat(now.replace('Z', '+00:00')) >= datetime.fromisoformat(self.protocol.deadline.replace('Z', '+00:00')):
            raise Invalid('Research deadline reached', 409)

    def advance(self, **changes):
        return replace(self, sequence=self.sequence + 1, **changes)

    def complete_round(self, row, previous_screening):
        usage = self.usage.spend('rounds', 1, self.protocol.limits)
        no_progress = self.noProgress + 1 if not row.newEvidence and row.screeningDigest == previous_screening else 0
        stop = self.stopReason or ('round_limit' if usage.rounds >= self.protocol.limits.rounds else
                                  'no_progress' if no_progress >= self.protocol.noProgressLimit else None)
        return self.advance(roundIds=(*self.roundIds, row.id), gaps=row.gaps, usage=usage, noProgress=no_progress, stopReason=stop)

    def finish(self, reason):
        if reason not in ('user_stopped', 'scope_exhausted', 'needs_input', 'budget_exhausted', 'runtime_incomplete', 'storage_capacity', 'ready_for_review'):
            raise Invalid('Choose an explicit research stop reason')
        if self.stopReason and self.stopReason not in ('needs_input', 'runtime_incomplete') and reason != self.stopReason:
            raise Invalid('The research stop reason is final', 409)
        return self.advance(stopReason=reason)

    def observe_terminal(self, status, model_requests, app_calls, thread, now):
        reason = self.stopReason
        if not reason and datetime.fromisoformat(now.replace('Z', '+00:00')) >= datetime.fromisoformat(self.protocol.deadline.replace('Z', '+00:00')):
            reason = 'deadline_reached'
        elif not reason and (model_requests >= self.protocol.limits.modelRequests or app_calls >= self.protocol.limits.appCalls):
            reason = 'budget_exhausted'
        elif not reason and status == 'completed':
            reason = 'runtime_incomplete'
        return self.advance(executionStatus=status, modelRequestsUsed=model_requests, appCallsUsed=app_calls,
            stopReason=reason, events=(*self.events, ResearchEvent('host-run', status, thread, reason or status, now)))

    def discover(self, candidates, *, reserved=False):
        found = list(self.candidates)
        for candidate in candidates:
            index = next((i for i, item in enumerate(found) if item.matches(candidate)), None)
            if index is None:
                found.append(candidate)
            else:
                found[index] = found[index].merge(candidate)
        added = len(found) - len(self.candidates)
        usage = (self.usage if reserved else self.usage.spend('searches', 1, self.protocol.limits)).spend('candidates', added, self.protocol.limits)
        return self.advance(candidates=tuple(found), usage=usage)

    def candidate(self, identity):
        item = next((c for c in self.candidates if c.id == identity), None)
        if item is None:
            raise Invalid('Candidate is outside this research program')
        return item

    def update_candidate(self, candidate):
        self.candidate(candidate.id)
        return self.advance(candidates=tuple(candidate if c.id == candidate.id else c for c in self.candidates))


@dataclass(frozen=True)
class ResearchEvent:
    operation: str
    status: str
    reference: str
    detail: str
    at: str
