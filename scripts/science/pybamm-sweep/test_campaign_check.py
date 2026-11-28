import json
import unittest

from bundle import ROOT, load_identity
from campaign_check import verify
from contract import digest, encoded
from dispatch import PREFIX, task_prompt


class CampaignCheckerTest(unittest.TestCase):
    def test_evidence_uses_frozen_input_and_exact_result_bytes(self):
        identity = load_identity()
        content = (ROOT / 'reference.jsonl').read_text().splitlines(keepends=True)[0]
        case = identity.method.experiments[0].id
        envelope = {'content': content, 'sha256': digest(content.encode()), 'path': 'result.jsonl'}
        prompt = task_prompt(case, identity.sha256)
        run = {'id': 'run', 'task_id': 'task', 'worker_id': 'worker', 'generation': 1,
               'status': 'succeeded', 'spec': {'prompt': prompt}}
        trial = {'task': {'prompt': prompt}, 'worker_id': 'worker'}
        for name, message, truncated, expected in (
                ('complete', envelope, False, 'consistent'),
                ('missing', None, False, 'missing'),
                ('altered', {**envelope, 'content': content.replace('final time', 'early stop')}, False, 'needs_review'),
                ('truncated', envelope, True, 'missing'),
                ('wrong condition', {**envelope, 'content': content.replace(case, 'other')}, False, 'needs_review')):
            with self.subTest(name=name):
                events = [] if message is None else [{
                    'kind': 'session_update', 'data': {'sessionUpdate': 'agent_message_chunk',
                        'content': {'text': PREFIX + encoded(message).decode()}}}]
                result = verify({'run': run, 'trial': trial, 'events': events, 'events_truncated': truncated})
                self.assertEqual(result['status'], expected)
                if expected == 'consistent':
                    self.assertEqual(result['result_digest'], envelope['sha256'])
                    source = json.loads(content)
                    self.assertEqual(result['environment_digest'], digest(encoded({
                        field: source[field] for field in ('environment', 'platform', 'architecture')})))
