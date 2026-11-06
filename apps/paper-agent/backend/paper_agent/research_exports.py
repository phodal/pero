"""Deterministic program artifacts; source evidence keeps its original owner."""
import json
from .model import digest


def export_program(program, rounds):
    protocol = program.protocol
    accounting = (f'Model attempts: {program.modelRequestsUsed}; App calls: {program.appCallsUsed}'
                  if program.executionStatus in ('completed', 'failed', 'cancelled', 'interrupted')
                  else 'Final execution accounting: not yet recorded')
    report = [f'# {protocol.question}', '', 'Review: needs_review', '',
              f'Scope: {protocol.scope}', f'Checkpoint: {program.checkpoint}',
              f'Stop reason: {program.stopReason or "not recorded"}', accounting, '', '## Findings']
    evidence = []
    for row in rounds:
        report.extend(['', f'### Round {row["number"]}: {row["question"]}'])
        for claim in row['claims']:
            link = claim['sourceUrl'] if claim.get('sourceKind') == 'html' else f'pero-app-location://paper-agent/main/report/{claim["reportId"]}/passage/{claim["passageId"]}'
            report.extend([f'- **{claim["stance"]}**: {claim["text"]} ([source report]({link}))',
                           f'  > {claim["quote"]}'])
            evidence.append(dict(round=row['number'], **claim))
    report.extend(['', '## Unresolved questions', *['- ' + g for g in program.gaps], '', '## Next action',
                   rounds[-1]['nextAction'] if rounds else 'Inspect the seed sources and identify the first evidence gap.',
                   '', 'Citation matching establishes source location, not scientific acceptance.'])
    papers = ['# Literature', '', 'Screening and reading are distinct; metadata is not full-text evidence.', '']
    for candidate in program.candidates:
        papers.extend([f'## {candidate.title}', f'- Source: {candidate.url}', f'- Screening: {candidate.decision}: {candidate.reason}',
                       f'- Saved paper: {candidate.paperId or "not saved"}', f'- PDF: {candidate.documentId or "not read"}',
                       f'- Blocker: {candidate.blocker or "none recorded"}',
                       '- Discovered through: ' + ', '.join(p.relation + ':' + p.batchId for p in candidate.discoveries), ''])
    from dataclasses import asdict
    logs = [dict(event='operation', **asdict(event)) for event in program.events]
    for row in rounds:
        logs.append(dict(event='round', **{k: v for k, v in row.items() if k != 'claims'}))
        logs.extend(dict(event='claim', round=row['number'], **claim) for claim in row['claims'])
    values = [('report', 'research-report.md', report, '\n'),
              ('evidence', 'evidence-matrix.json', [json.dumps(c, ensure_ascii=False) for c in evidence], ','),
              ('literature', 'literature.md', papers, '\n'),
              ('log', 'research-log.jsonl', [json.dumps(r, ensure_ascii=False, sort_keys=True) for r in logs], '\n')]
    documents = []
    for slot, filename, records, separator in values:
        # Split at complete records so every JSON/JSONL artifact remains independently readable.
        chunks, current, size = [], [], 0
        for record in records:
            width = len(record.encode('utf-8')) + 1
            if current and size + width > 160 * 1024:
                chunks.append(separator.join(current)); current, size = [], 0
            current.append(record); size += width
        chunks.append(separator.join(current))
        for index, chunk in enumerate(chunks):
            if slot == 'evidence':
                chunk = '{"checkpoint":' + json.dumps(program.checkpoint) + ',"acceptance":"needs_review","part":' + str(index + 1) + ',"claims":[' + chunk + ']}'
            documents.append(dict(slot=slot if index == 0 else f'{slot}-{index + 1}',
                                  filename=filename if index == 0 else f'{index + 1}-{filename}',
                                  content=chunk, sha256=digest(chunk.encode())))
    if len(documents) > 4:
        documents[0]['content'] = '# Export contents\n\n' + '\n'.join('- ' + d['filename'] + ' (slot: ' + d['slot'] + ')' for d in documents) + '\n\n' + documents[0]['content']
        documents[0]['sha256'] = digest(documents[0]['content'].encode())
    return dict(programId=program.id, checkpoint=program.checkpoint, documents=documents, acceptance='needs_review')
