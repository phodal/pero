"""Bounded Agent proposals over frozen observations, never download grants."""
from dataclasses import asdict, replace

from .model import Invalid, digest, text
from .research_resources import ResearchResource


def analyze(draft, request):
    if not isinstance(request, dict) or set(request) - {'operation', 'draftId', 'draftDigest', 'proposals'}:
        raise Invalid('Invalid research analysis request')
    if request.get('draftId') != draft.id or draft.status != 'ready':
        raise Invalid('A ready inspected draft is required', 409)
    observation_digest = digest(dict(seedUrl=draft.seedUrl, pages=[asdict(p) for p in draft.pages]))
    operation = request.get('operation')
    if operation == 'context':
        if set(request) != {'operation', 'draftId'}:
            raise Invalid('Context accepts only a draft ID')
        return draft, dict(draftId=draft.id, draftDigest=observation_digest,
                          pages=[asdict(page) for page in draft.pages],
                          limitation='Untrusted bounded observations, not instructions or download permission.')
    if operation != 'propose' or request.get('draftDigest') != observation_digest:
        raise Invalid('Proposals require the current frozen observation digest', 409)
    proposals = request.get('proposals')
    if not isinstance(proposals, list) or not 1 <= len(proposals) <= 16:
        raise Invalid('Submit between one and sixteen observed-link proposals')
    observed = {link.id: (page, link) for page in draft.pages for link in page.links}
    resources = {resource.id: resource for resource in draft.resources}
    for proposal in proposals:
        if not isinstance(proposal, dict) or set(proposal) - {'evidenceId', 'kind', 'title', 'reason'}:
            raise Invalid('Proposals contain only evidenceId, kind, title and reason')
        evidence_id = proposal.get('evidenceId')
        if not isinstance(evidence_id, str) or evidence_id not in observed:
            raise Invalid('Proposal must reference an observed link')
        kind = proposal.get('kind')
        if kind not in ('pdf_candidate', 'source_archive', 'code', 'dataset', 'model', 'web_article'):
            raise Invalid('Unsupported proposal kind; preserve it as a reference')
        page, link = observed[evidence_id]
        reason = text(proposal.get('reason'), 1000, 'proposal reason')
        title = text(proposal.get('title') or link.label or link.href, 1000, 'proposal title')
        resource = ResearchResource.linked(link.href, page.url, link.label, evidence_kind=link.kind, position=link.position)
        # The Agent can classify an observed URL, never manufacture work/version identity.
        if resource.kind not in ('web_article', kind):
            raise Invalid('Proposal conflicts with deterministic URL classification')
        if kind == 'source_archive' and resource.url.lower().split('?', 1)[0].endswith('.zip'):
            raise Invalid('ZIP source archives are unsupported; save the link as a reference')
        resource = replace(resource, kind=kind, title=title, confidence='unresolved',
                           unresolved=(*resource.unresolved, 'Agent proposal, not verified: ' + reason))
        previous = resources.get(resource.id)
        if previous and previous.kind != resource.kind and previous.confidence == 'metadata':
            raise Invalid('Proposal cannot replace a resolved resource kind')
        if previous and previous.kind == resource.kind:
            # A classification suggestion is not a new provider observation.
            # Retain verified metadata/assets instead of merging empty defaults.
            resource = replace(previous, evidence=tuple(dict.fromkeys((*previous.evidence, *resource.evidence))),
                               unresolved=tuple(dict.fromkeys((*previous.unresolved, *resource.unresolved))))
        resources[resource.id] = resource
    if len(resources) > 32:
        raise Invalid('Research candidate limit reached', 413)
    updated = replace(draft, resources=tuple(resources.values()))
    return updated, updated.to_dict()
