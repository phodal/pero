"""Prepare/score an offline independent review; never fetches sources or invokes a provider."""
import argparse
from dataclasses import asdict
from hashlib import sha256
import json
from pathlib import Path
import sys

from research_quality import QualityPacket, digest, measured_accounting
from research_quality_review import render_review

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')


def collect(directory):
    sys.path.insert(0, str(ROOT / 'apps/paper-agent/backend'))
    from paper_agent.research_program_store import ResearchPrograms
    from paper_agent.store import ResearchStore
    result = read(directory / 'result.json')
    evidence = read(directory / 'evidence.json')
    # The manifest was frozen before launch; never silently score against an edited rubric.
    catalog = read(directory / 'benchmark.json')
    case = next(c for c in catalog['cases'] if c['id'] == result['caseId'])
    store = ResearchStore(directory / 'app-data/paper-agent')
    programs = ResearchPrograms(store)
    program = programs.read(evidence['current']['id'], evidence['current']['checkpoint'])
    rounds = programs.rounds(program)
    sources, passages, reports, errors = {}, {}, [], []
    review_dir = directory / 'quality'
    for identity in program.studyIds:
        study = store.study(identity)
        for passage in study.passages:
            passages[passage.id] = passage
        if study.report_id:
            # Saved sections can contain assertions not repeated in the round claim list.
            reports.append(store._read('reports', study.report_id))
        for source in study.sources:
            if source.document_id in sources:
                continue
            document = store.pdf(source.document_id)
            paper = store.paper(source.paper_id)
            data = store.pdf_bytes(document)
            if sha256(data).hexdigest() != source.file_digest or document.file_digest != source.file_digest:
                errors.append('Original PDF digest mismatch: ' + source.document_id)
                continue
            path = Path('sources') / (source.file_digest + '.pdf')
            (review_dir / path).parent.mkdir(parents=True, exist_ok=True)
            (review_dir / path).write_bytes(data)
            sources[source.document_id] = dict(id=source.document_id, paperId=source.paper_id,
                title=paper.title, sourceId=paper.source_id, url=document.source_url,
                sha256=source.file_digest, file=path.as_posix(), pages=[p.to_dict() for p in document.pages],
                observedPages=sorted({p.page for p in passages.values() if p.document_id == source.document_id}))
    claims = []
    for row in rounds:
        for claim in row['claims']:
            passage = passages.get(claim.get('passageId'))
            source = sources.get(passage.document_id) if passage else None
            page = next((p for p in source['pages'] if p['number'] == passage.page), None) if source else None
            # A saved quote is not proof of entailment. It only qualifies the citation for human review.
            report = next((r for r in reports if r['id'] == claim['reportId']), None)
            refs = [ref for group in (report.get('sections', []) + report.get('matrix', {}).get('cells', []))
                    for ref in group.get('evidence', [])] if report else []
            verified = bool(passage and source and page and passage.paper_id == claim['paperId']
                and passage.file_digest == source['sha256'] and claim['quote'] and claim['quote'] in passage.content
                and page['text'][passage.start:passage.start + len(passage.content)] == passage.content
                and any(all(ref.get(key) == claim.get(key) for key in ('paperId', 'passageId', 'quote')) for ref in refs))
            claims.append(dict(id=f'claim-{len(claims) + 1}', round=row['number'], **claim,
                sourceId=source['id'] if source else None, page=passage.page if passage else None,
                observedText=passage.content if passage else None, citationVerified=verified))
            if not verified:
                errors.append('Unverified original/observation citation: ' + claims[-1]['id'])
    # Recompute after all studies, since another study may read further pages of the same original.
    for source in sources.values():
        source['observedPages'] = sorted({p.page for p in passages.values() if p.document_id == source['id']})
    if not rounds or not claims:
        errors.append('No completed research claims')
    journal, journals = [], []
    for path in sorted((directory / 'sessions').glob('*.jsonl')):
        data = path.read_bytes()
        journals.append(dict(file=path.name, sha256=sha256(data).hexdigest()))
        journal.extend(row['event'] for row in (json.loads(line) for line in data.splitlines()) if 'event' in row)
    assistant_text = [event['data']['content']['text'] for event in evidence['events']
        if event.get('thread_id') == result['sessionId'] and event.get('kind') == 'session_update'
        and event.get('data', {}).get('sessionUpdate') == 'agent_message_chunk'
        and event['data'].get('content', {}).get('type') == 'text']
    body = dict(schema='pero.research-quality.packet.v1', caseId=case['id'], benchmarkVersion=catalog['version'],
        benchmarkSHA256=digest(catalog), requirements=case['requirements'], thresholds=catalog['thresholds'],
        referenceSources=[source for source in catalog['sources'] if source['id'] in {r['source'] for r in case['requirements']}], protocol=program.protocol.to_dict(),
        programId=program.id, checkpoint=program.checkpoint, claims=claims, sources=list(sources.values()),
        candidates=[c.to_dict() for c in program.candidates], reports=reports,
        observations=[p.to_dict() for p in passages.values()],
        nextActions=[dict(id='round-' + str(row['number']), question=row['question'], gaps=row['gaps'],
                          nextAction=row['nextAction']) for row in rounds],
        programEvents=[asdict(event) for event in program.events],
        jobs=[read(path) for path in sorted((programs.directory(program.id) / 'jobs').glob('*/job.json'))],
        finalAssistantText=''.join(assistant_text), journals=journals,
        run=dict(mode=result['mode'], model=result['model'], provider=result['provider'], sessionId=result['sessionId'],
            executionPassed=result['executionChecks']['passed'], termination=result['termination'],
            startedAt=result.get('startedAt'), finishedAt=result.get('finishedAt'),
            evaluationCode=result.get('evaluationCode'), generationConfig=result.get('generationConfig'),
            stopReason=program.stopReason, revision=result['revision'], hostSHA256=result['hostSHA256'],
            harnessSHA256=result['harnessSHA256'],
            accounting=measured_accounting(evidence['events'], result['sessionId'], result['durationMs'],
                                          program.modelRequestsUsed, program.appCallsUsed, journal)),
        integrityErrors=errors, evidenceSHA256=sha256((directory / 'evidence.json').read_bytes()).hexdigest())
    packet = QualityPacket.parse(dict(**body, sha256=digest(body)))
    write(review_dir / 'packet.json', packet.value)
    (review_dir / 'review.html').write_text(render_review(packet), encoding='utf-8')
    # Never overwrite a completed review on repeated export.
    template = review_dir / 'review-template.json'
    write(template, packet.template())
    write(review_dir / 'status.json', dict(scientificAcceptance='needs_independent_human_review',
          realModelRun=result['mode'] == 'real-provider', integrityErrors=errors,
          counts=dict(claims=len(claims), sources=len(sources), rounds=len(rounds)), packetSHA256=packet.value['sha256']))
    return review_dir


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('collect'); p.add_argument('run_directory', type=Path)
    p = sub.add_parser('score'); p.add_argument('packet', type=Path); p.add_argument('review', type=Path)
    p.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.command == 'collect':
        print(collect(args.run_directory.resolve()))
    else:
        packet = QualityPacket.parse(read(args.packet))
        # Recheck retained originals at scoring time, not just at collection time.
        for source in packet.value['sources']:
            path = args.packet.parent / source['file']
            if sha256(path.read_bytes()).hexdigest() != source['sha256']:
                raise ValueError('Saved original changed: ' + source['id'])
        score = packet.score(read(args.review))
        write(args.output, score)
        print(json.dumps(score, ensure_ascii=False))
        if not score['passed']:
            raise SystemExit(1)


if __name__ == '__main__':
    main()
