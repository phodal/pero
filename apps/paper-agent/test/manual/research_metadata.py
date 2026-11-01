"""Opt-in public metadata observation. Never download model/dataset bytes or call an LLM."""
import argparse
import json
from pathlib import Path
import sys
import threading
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from paper_agent.inspection_worker import inspect_bounded
from paper_agent.resource_inspection import ResourceInspector
from paper_agent.research_resources import ImportDraft, ResourceIdentity


def observation(draft, result):
    # A newly created draft has no resources until inspection finishes. Match
    # the requested seed, not an arbitrary successfully resolved linked work.
    identity = ResourceIdentity.from_url(draft.seedUrl).identity
    seed = next((resource for resource in result.resources
                 if identity in (resource.identity, *resource.aliases)), None)
    observed = result.status == 'ready' and seed is not None and seed.confidence == 'metadata' and not seed.unresolved
    return dict(observedAt=draft.createdAt, seedUrl=draft.seedUrl,
        outcome='METADATA_OBSERVED' if observed else 'INCONCLUSIVE', status=result.status,
        reason=None if observed else result.error or '; '.join(seed.unresolved if seed else ()) or 'Seed metadata was not resolved.',
        warnings=result.warnings, resources=[
            {key: r.to_dict()[key] for key in ('id', 'kind', 'title', 'url', 'originalUrl', 'revision', 'license',
                                             'size', 'relation', 'confidence', 'evidence', 'unresolved')}
            for r in result.resources])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-public-metadata', action='store_true', required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    observations = []
    # The second seed is an independently observed candidate from issue #68,
    # not an assertion that it was linked or announced by the first seed.
    for url in (
        'https://www.research.google/blog/timesfm-3-a-zero-shot-foundation-model-for-multivariate-forecasting/',
        'https://huggingface.co/google/timesfm-3.0-pytorch',
    ):
        now = datetime.now(timezone.utc).isoformat()
        draft = ImportDraft.create(url, now)
        result = inspect_bounded(draft, ResourceInspector(), threading.Event())
        observations.append(observation(draft, result))
    receipt = dict(outcome='METADATA_OBSERVED' if all(item['outcome'] == 'METADATA_OBSERVED' for item in observations) else 'INCONCLUSIVE',
                   scope='Actual application metadata resolver; independent public seeds. Not fixture or scientific/reproducibility acceptance.',
                   downloads=0, modelCalls=0, observations=observations)
    encoded = json.dumps(receipt, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding='utf-8')
    print(encoded, end='')


if __name__ == '__main__':
    main()
