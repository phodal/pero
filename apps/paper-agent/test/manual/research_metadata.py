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
from paper_agent.research_resources import ImportDraft


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-public-metadata', action='store_true', required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    url = 'https://www.research.google/blog/timesfm-3-a-zero-shot-foundation-model-for-multivariate-forecasting/'
    now = datetime.now(timezone.utc).isoformat()
    result = inspect_bounded(ImportDraft.create(url, now), ResourceInspector(), threading.Event())
    receipt = dict(observedAt=now, seedUrl=url, status=result.status, error=result.error,
                   warnings=result.warnings, downloads=0, modelCalls=0, resources=[
                       {key: r.to_dict()[key] for key in ('id', 'kind', 'title', 'url', 'originalUrl', 'revision', 'license',
                                                        'size', 'relation', 'confidence', 'evidence', 'unresolved')}
                       for r in result.resources])
    encoded = json.dumps(receipt, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding='utf-8')
    print(encoded, end='')


if __name__ == '__main__':
    main()
