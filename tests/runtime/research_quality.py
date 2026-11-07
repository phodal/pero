"""Offline quality accounting. Humans judge entailment; this core never calls a model."""
from dataclasses import dataclass
from hashlib import sha256
import json
import math


def digest(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def ratio(numerator, denominator):
    return dict(numerator=numerator, denominator=denominator,
                value=numerator / denominator if denominator else None)


def indexed(rows, key, expected, label):
    require(isinstance(rows, list), f'{label} must be an array')
    require(all(isinstance(row, dict) and key in row for row in rows), f'Invalid {label} row')
    ids = [row[key] for row in rows]
    require(len(ids) == len(set(ids)) and set(ids) == set(expected), f'{label} must cover each ID exactly once')
    return {row[key]: row for row in rows}


@dataclass(frozen=True)
class QualityPacket:
    """One frozen evaluation object, bound to its complete run and registered rubric."""
    value: dict

    @classmethod
    def parse(cls, value):
        require(value.get('schema') == 'pero.research-quality.packet.v1', 'Unknown packet schema')
        body = {k: v for k, v in value.items() if k != 'sha256'}
        require(value.get('sha256') == digest(body), 'Packet digest mismatch')
        for label in ('claims', 'requirements', 'nextActions', 'sources', 'referenceSources'):
            rows = value[label]
            require(len({row['id'] for row in rows}) == len(rows), f'Duplicate {label} IDs')
        require(value['requirements'], 'Registered requirements are required')
        return cls(value)

    def template(self):
        return dict(schema='pero.research-quality.review.v1', packetSHA256=self.value['sha256'],
            reviewer=dict(name='', kind='human', independent=False, reviewedAt='', originalsInspected=False),
            claims=[dict(id=c['id'], verdict='unreviewed', critical=True, sourceIds=[], location='', rationale='') for c in self.value['claims']],
            requirements=[dict(id=r['id'], verdict='unreviewed', claimIds=[], rationale='') for r in self.value['requirements']],
            referenceSources=[dict(id=s['id'], verdict='unreviewed', sourceIds=[], rationale='') for s in self.value['referenceSources']],
            nextActions=[dict(id=n['id'], verdict='unreviewed', rationale='') for n in self.value['nextActions']],
            additionalCriticalOmissions=[], criticalErrors=[], finalReportChecked=False,
            finalReportNotes='Check saved report sections and final assistant text for additional uncited/overstated claims; any material extra assertion blocks acceptance.')

    def score(self, review):
        packet = self.value
        require(review.get('schema') == 'pero.research-quality.review.v1', 'Unknown review schema')
        require(review.get('packetSHA256') == packet['sha256'], 'Review is for another packet')
        reviewer = review['reviewer']
        require(reviewer.get('kind') == 'human' and reviewer.get('independent') is True,
                'An independent human reviewer is required; model self-scores cannot qualify')
        require(reviewer.get('name', '').strip() and reviewer.get('reviewedAt', '').strip()
                and reviewer.get('originalsInspected') is True, 'Identify reviewer, review time and original-source inspection')
        require(review.get('finalReportChecked') is True, 'Review the complete final report and assistant text')
        claims = indexed(review['claims'], 'id', [c['id'] for c in packet['claims']], 'Claim review')
        requirements = indexed(review['requirements'], 'id', [r['id'] for r in packet['requirements']], 'Requirement review')
        actions = indexed(review['nextActions'], 'id', [a['id'] for a in packet['nextActions']], 'Next-action review')
        sources = {s['id'] for s in packet['sources']}
        references = indexed(review['referenceSources'], 'id', [s['id'] for s in packet['referenceSources']], 'Reference-source review')
        source_by_id = {s['id']: s for s in packet['sources']}
        for row in references.values():
            require(row['verdict'] in ('read', 'equivalent_read', 'metadata_only', 'missed') and row.get('rationale', '').strip(),
                    'Finish each key-source verdict and rationale')
            if row['verdict'] in ('read', 'equivalent_read'):
                require(row.get('sourceIds') and all(identity in source_by_id and source_by_id[identity]['observedPages']
                        for identity in row['sourceIds']), 'Read coverage requires actually observed originals')
                if row['verdict'] == 'read':
                    expected = next(s for s in packet['referenceSources'] if s['id'] == row['id'])
                    require(any(source_by_id[i]['sourceId'] == expected['sourceId'] or
                                source_by_id[i]['url'] == expected['pdfUrl'] for i in row['sourceIds']),
                            'Exact reference version differs; explicitly justify an equivalent instead')
        for claim in packet['claims']:
            row = claims[claim['id']]
            require(row['verdict'] in ('supported', 'unsupported', 'uncertain'), 'Finish every claim verdict')
            require(row.get('rationale', '').strip(), 'Every claim needs a rationale')
            require(type(row.get('critical')) is bool, 'Classify whether each claim is material to the conclusion')
            if row['verdict'] == 'supported':
                require(row.get('location', '').strip() and row.get('sourceIds') and
                        set(row['sourceIds']).issubset(sources), 'Supported claims need saved sources and exact locations')
                require(claim['citationVerified'] and claim['sourceId'] in row['sourceIds'],
                        'Supported claim must use its actual observed, version-bound citation')
        for row in requirements.values():
            require(row['verdict'] in ('covered', 'omitted', 'uncertain'), 'Finish every requirement verdict')
            require(row.get('rationale', '').strip(), 'Every requirement needs a rationale')
            if row['verdict'] == 'covered':
                require(row.get('claimIds') and all(i in claims and claims[i]['verdict'] == 'supported'
                        for i in row['claimIds']), 'Covered requirements need supported claim IDs')
        for row in actions.values():
            require(row['verdict'] in ('grounded', 'ungrounded', 'uncertain') and row.get('rationale', '').strip(),
                    'Finish every next-action verdict and rationale')
        omissions = review.get('additionalCriticalOmissions')
        require(isinstance(omissions, list) and all(isinstance(s, str) and s.strip() for s in omissions),
                'Additional omissions must be a list of descriptions')
        critical_errors = review.get('criticalErrors')
        require(isinstance(critical_errors, list) and all(isinstance(s, str) and s.strip() for s in critical_errors),
                'Critical errors must be a list of descriptions')
        supported = sum(c['verdict'] == 'supported' for c in claims.values())
        covered = sum(r['verdict'] == 'covered' for r in requirements.values())
        counters = [r for r in packet['requirements'] if r['kind'] == 'counterevidence']
        omitted = sum(requirements[r['id']]['verdict'] != 'covered' for r in counters)
        metrics = dict(referenceSourceReadCoverage=ratio(sum(r['verdict'] in ('read', 'equivalent_read') for r in references.values()), len(references)),
            supportRate=ratio(supported, len(claims)),
            requirementCoverage=ratio(covered, len(requirements)),
            counterevidenceOmissionRate=ratio(omitted, len(counters)),
            groundedNextActions=ratio(sum(a['verdict'] == 'grounded' for a in actions.values()), len(actions)),
            citationIntegrity=ratio(sum(c['citationVerified'] for c in packet['claims']), len(claims)))
        thresholds = packet['thresholds']
        failures = list(packet['integrityErrors'])
        for key in ('supportRate', 'requirementCoverage', 'referenceSourceReadCoverage'):
            if metrics[key]['value'] is None or metrics[key]['value'] < thresholds[key]:
                failures.append(key + ' below threshold')
        if not counters or metrics['counterevidenceOmissionRate']['value'] > thresholds['counterevidenceOmissionRate']:
            failures.append('counterevidence omission threshold not met')
        if not actions or any(a['verdict'] != 'grounded' for a in actions.values()):
            failures.append('next actions are not all grounded')
        if critical_errors or any(c['critical'] and c['verdict'] != 'supported' for c in claims.values()):
            failures.append('material errors or unresolved material claims')
        if omissions:
            failures.append('additional critical omissions')
        if packet['run'].get('mode') != 'real-provider' or not packet['run'].get('executionPassed'):
            failures.append('real-provider execution not qualified')
        return dict(schema='pero.research-quality.score.v1', packetSHA256=packet['sha256'],
            reviewSHA256=digest(review), reviewer=reviewer, metrics=metrics, accounting=packet['run'].get('accounting'),
            thresholds=thresholds, failures=failures, passed=not failures,
            acceptance='review_thresholds_met' if not failures else 'not_accepted',
            limitation='Human identity/independence is an attestation, not authenticated by this offline tool. Fixed-case results do not establish general scientific quality.')


def measured_accounting(events, session_id, duration_ms, model_requests, app_calls, journal=()):
    """ACP session_usage is cumulative, not incremental; context occupancy is not billed tokens."""
    costs = [e['data']['cost'] for e in events if e.get('kind') == 'session_usage'
             and e.get('thread_id') == session_id and isinstance(e.get('data'), dict) and e['data'].get('cost')]
    cost = costs[-1] if costs else None
    if cost is not None:
        require(isinstance(cost.get('amount'), (int, float)) and not isinstance(cost['amount'], bool)
                and math.isfinite(cost['amount']) and cost['amount'] >= 0
                and isinstance(cost.get('currency'), str) and len(cost['currency']) == 3
                and cost['currency'].isupper(), 'Invalid reported cumulative cost')
    receipts = [e['data'].get('usage') for e in journal if e.get('type') in ('assistant/message', 'compaction/response')]
    known = [r for r in receipts if r is not None]
    for receipt in known:
        require(all(type(receipt.get(k)) is int and receipt[k] >= 0 for k in ('inputTokens', 'outputTokens')),
                'Invalid provider token receipt')
    complete = bool(known) and len(known) == len(receipts) == model_requests
    subtotal = {k: sum(r[k] for r in known) for k in ('inputTokens', 'outputTokens')} if known else None
    return dict(durationMs=duration_ms, modelRequests=model_requests, appCalls=app_calls,
                inputTokens=subtotal['inputTokens'] if complete else None,
                outputTokens=subtotal['outputTokens'] if complete else None, cost=cost,
                reportedTokenSubtotal=subtotal, tokenReceipts=len(known), tokenAccountingComplete=complete,
                costBasis='provider_reported_cumulative' if cost else 'not_reported',
                tokenBasis='provider_reported_receipts' if known else 'not_reported; ACP context occupancy is not token consumption')
