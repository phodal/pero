import unittest

from recovery import build_recovery


class RecoveryAccounting(unittest.TestCase):
    def call(self, seq, command, failed, status=None, turn=1):
        return {"seq":seq, "result_seq":seq+1, "time":"2026-11-05T00:00:00Z",
                "end_time":"2026-11-05T00:00:01Z", "name":"Bash", "command":command,
                "argument_sha256":command, "turn":turn, "execution_failure":failed,
                "status":status or ("failed" if failed else "succeeded")}

    def response(self, seq, usage=None, purpose="agent"):
        return {"seq":seq, "purpose":purpose, "usage":usage}

    def test_same_operation_and_independent_success(self):
        for command, status, outcome in [
            ("check", "succeeded", "matching-operation-succeeded"),
            ("unrelated", "succeeded", "unresolved-at-turn-end"),
            ("check", "returned", "unresolved-at-turn-end"),
            ("check", "running", "unresolved-at-turn-end"),
        ]:
            with self.subTest(command=command,status=status):
                report=build_recovery([self.call(1,"check",True),self.call(4,command,False,status)],
                    [self.response(3)], [{"seq":8,"turn":1,"time":"2026-11-05T00:00:03Z"}], [], [], None, 8)
                chain=report["chains"][0]
                self.assertEqual(chain["outcome"],outcome)
                self.assertIsNone(chain["usage"]["total_tokens"])
                self.assertEqual(chain["committed_responses"],1)

    def test_nonoverlapping_windows_and_usage_lanes(self):
        usage={"inputTokens":2,"cacheReadTokens":10,"cacheWriteTokens":3,"outputTokens":5,"reasoningTokens":4,"totalTokens":17}
        responses=[self.response(0,usage),self.response(3,usage),self.response(4,usage,"compaction"),self.response(7,usage),self.response(10,usage)]
        report=build_recovery([self.call(1,"check",True),self.call(5,"check",False),self.call(8,"check",True),self.call(11,"check",False)],responses,[],[],[],None,12)
        first,second=report["chains"]
        self.assertEqual(first["response_seqs"],[3,4])
        self.assertEqual(second["response_seqs"],[10])
        self.assertEqual(report["outside_chain_response_seqs"],[0,7])
        self.assertEqual(first["usage"]["total_tokens"],34)
        self.assertEqual(first["usage"]["derived_total_tokens"],34)
        self.assertEqual(first["agent_usage"]["total_tokens"],17)
        self.assertEqual(first["compaction_usage"]["total_tokens"],17)

    def test_multiple_failures_and_missing_attempt_usage(self):
        report=build_recovery([self.call(1,"a",True),self.call(4,"b",True),self.call(6,"a",False)],
            [self.response(3,{"totalTokens":20})], [{"seq":10,"time":None}],
            [{"seq":8}], [{"seq":9}], None,10)
        first,chain=report["chains"]
        self.assertEqual(first["outcome"],"unresolved-at-different-failure")
        self.assertEqual(first["usage"]["known_total_tokens"],20)
        self.assertEqual(chain["unresolved_operations"],1)
        self.assertEqual(chain["failed_operations"],1)
        self.assertEqual(chain["usage"]["known_total_tokens"],0)
        self.assertIsNone(chain["usage"]["total_tokens"])
        self.assertFalse(chain["usage"]["usage_complete"])
        self.assertEqual(chain["unmatched_prepared_seqs"],[8])
        self.assertIsNone(chain["duration_ms"])
