"""Synthetic grader/collector tests; never evidence of live model quality."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

from research_quality import QualityPacket, digest, measured_accounting

ROOT = Path(__file__).resolve().parents[2]


def packet():
    value = dict(schema='pero.research-quality.packet.v1',
        claims=[dict(id='c1', citationVerified=True, sourceId='s1'), dict(id='c2', citationVerified=True, sourceId='s1')],
        requirements=[dict(id='support', kind='coverage'), dict(id='caveat', kind='counterevidence')],
        sources=[dict(id='s1', observedPages=[1], sourceId='ref-v1', url='https://example.test/ref-v1.pdf')],
        referenceSources=[dict(id='reference', sourceId='ref-v1', pdfUrl='https://example.test/ref-v1.pdf')], nextActions=[dict(id='r1')], integrityErrors=[],
        thresholds=dict(supportRate=.9, requirementCoverage=1, counterevidenceOmissionRate=0, referenceSourceReadCoverage=1),
        run=dict(mode='real-provider', executionPassed=True, accounting=dict(cost=None)))
    return QualityPacket.parse(dict(**value, sha256=digest(value)))


def review(p):
    result = p.template()
    result['reviewer'].update(name='Synthetic reviewer for test only', independent=True,
                              reviewedAt='2026-11-07T00:00:00Z', originalsInspected=True)
    result['finalReportChecked'] = True
    for row in result['claims']:
        row.update(verdict='supported', sourceIds=['s1'], location='Page 1', rationale='Synthetic entailment')
    for row in result['requirements']:
        row.update(verdict='covered', claimIds=['c1'], rationale='Synthetic coverage')
    result['referenceSources'][0].update(verdict='read', sourceIds=['s1'], rationale='Exact observed original')
    result['nextActions'][0].update(verdict='grounded', rationale='Addresses saved gap')
    return result


class ReviewTests(unittest.TestCase):
    def test_metrics_and_unknown_accounting_have_explicit_denominators(self):
        p = packet(); result = p.score(review(p))
        self.assertTrue(result['passed'])
        self.assertEqual(result['metrics']['supportRate'], dict(numerator=2, denominator=2, value=1))
        self.assertEqual(result['metrics']['counterevidenceOmissionRate'], dict(numerator=0, denominator=1, value=0))
        self.assertIsNone(result['accounting']['cost'])

    def test_reviews_fail_closed_at_the_entry_boundary(self):
        cases = [
            ('missing claim', lambda r: r['claims'].pop()),
            ('duplicate claim', lambda r: r['claims'].append(r['claims'][0])),
            ('unreviewed claim', lambda r: r['claims'][0].update(verdict='unreviewed')),
            ('different packet', lambda r: r.update(packetSHA256='other')),
            ('self-grading', lambda r: r['reviewer'].update(kind='model')),
            ('not independent', lambda r: r['reviewer'].update(independent=False)),
            ('no originals', lambda r: r['reviewer'].update(originalsInspected=False)),
            ('incomplete report review', lambda r: r.update(finalReportChecked=False)),
            ('bibliography only', lambda r: r['requirements'][0].update(claimIds=[])),
            ('unknown claim', lambda r: r['requirements'][0].update(claimIds=['invented'])),
            ('unknown source', lambda r: r['claims'][0].update(sourceIds=['invented'])),
            ('missing locator', lambda r: r['claims'][0].update(location='')),
            ('missing requirement', lambda r: r['requirements'].pop()),
            ('missing next action', lambda r: r['nextActions'].clear()),
        ]
        for label, edit in cases:
            with self.subTest(label=label):
                p = packet(); r = review(p); edit(r)
                with self.assertRaises(ValueError):
                    p.score(r)

    def test_omissions_and_uncertainty_cannot_be_averaged_away(self):
        for verdict in ('omitted', 'uncertain'):
            p = packet(); r = review(p)
            r['requirements'][1].update(verdict=verdict, claimIds=[])
            result = p.score(r)
            self.assertFalse(result['passed'])
            self.assertEqual(result['metrics']['counterevidenceOmissionRate']['numerator'], 1)
        p = packet(); r = review(p); r['claims'][1]['verdict'] = 'uncertain'
        self.assertEqual(p.score(r)['metrics']['supportRate']['value'], .5)
        r = review(p); r['additionalCriticalOmissions'] = ['Unqualified universal speedup in final answer']
        self.assertFalse(p.score(r)['passed'])

    def test_metadata_and_unread_originals_do_not_count_as_source_coverage(self):
        p = packet(); r = review(p)
        r['referenceSources'][0].update(verdict='metadata_only', sourceIds=[])
        result = p.score(r)
        self.assertFalse(result['passed'])
        self.assertEqual(result['metrics']['referenceSourceReadCoverage']['value'], 0)
        value = deepcopy(p.value); value.pop('sha256'); value['sources'][0]['observedPages'] = []
        p = QualityPacket.parse(dict(**value, sha256=digest(value)))
        with self.assertRaisesRegex(ValueError, 'observed originals'): p.score(review(p))
        value['sources'][0].update(observedPages=[1], sourceId='ref-v2', url='https://example.test/ref-v2.pdf')
        p = QualityPacket.parse(dict(**value, sha256=digest(value)))
        with self.assertRaisesRegex(ValueError, 'version differs'): p.score(review(p))

    def test_a_material_false_claim_cannot_hide_inside_ninety_percent_support(self):
        value = deepcopy(packet().value); value.pop('sha256')
        value['claims'] = [dict(id=f'c{n}', citationVerified=True, sourceId='s1') for n in range(10)]
        p = QualityPacket.parse(dict(**value, sha256=digest(value))); r = review(p)
        r['claims'][-1]['verdict'] = 'unsupported'
        self.assertEqual(p.score(r)['metrics']['supportRate']['value'], .9)
        self.assertFalse(p.score(r)['passed'])
        r = review(p); r['criticalErrors'] = ['Unsupported final assertion absent from claim list']
        self.assertFalse(p.score(r)['passed'])

    def test_token_receipts_include_compaction_and_preserve_incomplete_totals(self):
        journal = [dict(type=kind, data=dict(usage=dict(inputTokens=10, outputTokens=3)))
                   for kind in ('assistant/message', 'compaction/response')]
        complete = measured_accounting([], 'run', 10, 2, 1, journal)
        self.assertEqual(complete['inputTokens'], 20)
        self.assertEqual(complete['outputTokens'], 6)
        partial = measured_accounting([], 'run', 10, 3, 1, journal)
        self.assertIsNone(partial['inputTokens'])
        self.assertEqual(partial['reportedTokenSubtotal']['inputTokens'], 20)
        self.assertFalse(partial['tokenAccountingComplete'])

    def test_fixture_failed_execution_tamper_and_missing_citations_do_not_qualify(self):
        for change in ('fixture', 'failed', 'citation', 'empty'):
            value = deepcopy(packet().value); value.pop('sha256')
            if change == 'fixture': value['run']['mode'] = 'fixture'
            elif change == 'failed': value['run']['executionPassed'] = False
            elif change == 'citation': value['claims'][0]['citationVerified'] = False
            else: value['claims'] = []
            p = QualityPacket.parse(dict(**value, sha256=digest(value))); r = review(p)
            if change == 'citation':
                with self.assertRaises(ValueError): p.score(r)
            elif change == 'empty':
                for row in r['requirements']: row.update(verdict='omitted', claimIds=[])
                self.assertFalse(p.score(r)['passed'])
                self.assertIsNone(p.score(r)['metrics']['supportRate']['value'])
            else: self.assertFalse(p.score(r)['passed'])
        value = deepcopy(packet().value); value['run']['executionPassed'] = False
        with self.assertRaisesRegex(ValueError, 'digest'): QualityPacket.parse(value)

    def test_cumulative_cost_is_not_summed_or_inferred_from_context(self):
        events = [dict(kind='session_usage', thread_id='run', data=dict(context_used=900, cost=dict(amount=n, currency='USD')))
                  for n in (1, 2, 2)]
        events.append(dict(kind='session_usage', thread_id='other', data=dict(cost=dict(amount=99, currency='EUR'))))
        value = measured_accounting(events, 'run', 100, 3, 4)
        self.assertEqual(value['cost'], dict(amount=2, currency='USD'))
        self.assertIsNone(value['inputTokens'])
        self.assertIsNone(measured_accounting([], 'run', 100, 0, 0)['cost'])
        events[0]['data']['cost']['amount'] = float('nan')
        with self.assertRaises(ValueError): measured_accounting(events[:1], 'run', 1, 1, 1)


class CollectorTests(unittest.TestCase):
    def test_all_rounds_and_original_bytes_survive_real_store_export(self):
        sys.path[:0] = [str(ROOT / 'apps/paper-agent/backend'), str(ROOT / 'apps/paper-agent/test')]
        from test_program_records import ProgramRecordsAcceptance
        from test_research import NOW, reading
        from test_research_programs import ResearchProgramsAcceptance
        from paper_agent.model import PaperSnapshot, digest as byte_digest
        from paper_agent.pdf import PdfDocument, PdfPage
        from paper_agent.research_program_store import ResearchPrograms
        from paper_agent.store import ResearchStore
        spec = importlib.util.spec_from_file_location('quality_cli', ROOT / 'tests/runtime/paper-program-quality.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            store = ResearchStore(directory / 'app-data/paper-agent')
            fixture = ProgramRecordsAcceptance()
            fixture.store, fixture.programs = store, ResearchPrograms(store)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            data = b'Synthetic bytes, not a real PDF/model result'
            store.save_pdf(PdfDocument.create(paper.id, byte_digest(data), paper.url,
                tuple(PdfPage(n, 600, 800, f'Synthetic original observation {n}.') for n in (1, 2, 3)), NOW), data)
            fixture.state = fixture.programs.command(ResearchProgramsAcceptance.plan(paper), NOW)
            candidate = fixture.state['candidates'][0]['id']
            for number in (1, 2, 3):
                claim = fixture.pdf_claim(paper, candidate, number)
                fixture.perform('commit-round', f'commit-{number}', question=f'Question {number}',
                    reportIds=[claim['reportId']], claims=[claim], gaps=['Need counterevidence'], nextAction='Read original counterevidence')
            # Production API defaults to the last round; the collector must load the complete frozen history.
            self.assertEqual(len(fixture.state['rounds']), 1)
            module.write(directory / 'evidence.json', dict(current=fixture.state, events=[
                dict(kind='session_update', thread_id='synthetic-session', data=dict(sessionUpdate='agent_message_chunk',
                     content=dict(type='text', text='A material final assertion must be reviewed.')))]))
            module.write(directory / 'benchmark.json', module.read(ROOT / 'tests/runtime/research-quality/cases.json'))
            module.write(directory / 'result.json', dict(caseId='attention-parallelism', mode='fixture',
                model='scripted', provider='loopback', sessionId='synthetic-session', revision='test',
                durationMs=10, termination='turn_finished', hostSHA256='fixture', harnessSHA256='fixture',
                executionChecks=dict(passed=True)))
            target = module.collect(directory)
            result = QualityPacket.parse(module.read(target / 'packet.json'))
            self.assertEqual(result.value['finalAssistantText'], 'A material final assertion must be reviewed.')
            self.assertEqual(len(result.value['claims']), 3)
            self.assertEqual(len(result.value['nextActions']), 3)
            self.assertTrue(all(c['citationVerified'] for c in result.value['claims']))
            source, = result.value['sources']
            self.assertEqual(source['observedPages'], [1, 2, 3])
            self.assertEqual((target / source['file']).read_bytes(), data)
            self.assertEqual(result.value['integrityErrors'], [])
            self.assertEqual(module.read(target / 'status.json')['scientificAcceptance'], 'needs_independent_human_review')
            # Wrong original version must not be accepted just because quote text is unchanged.
            (store.root / 'pdf-files' / (byte_digest(data) + '.pdf')).write_bytes(b'changed original')
            module.collect(directory)
            broken = module.read(target / 'packet.json')
            self.assertTrue(broken['integrityErrors'])
            self.assertFalse(any(c['citationVerified'] for c in broken['claims']))


if __name__ == '__main__':
    unittest.main()
