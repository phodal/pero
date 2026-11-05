package harness

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

type progressObservation struct{ key, result [32]byte }
type toolProgressPatterns struct {
	turn                  int
	window                []progressObservation
	failure               string
	failures, inspections int
}

var gitOverview = regexp.MustCompile(`^git(?:\s+(?:--no-pager|-C\s+\S+))*\s+(?:status(?:\s+--?[\w-]+)*|diff(?:\s+--(?:stat|name-only|name-status|summary))*|ls-files(?:\s+--?[\w-]+)*)\s*$`)

// toolFailureWindow observes settled nonzero shell exits across inspections and
// edits. Mutating a file is not evidence that a failing experiment was repaired.
// This is a bounded diagnostic, never a semantic progress verdict or stop rule.
type toolFailureWindow struct {
	window      []bool
	sinceNotice int
	notified    bool
}

func observedShellResult(call ContentBlock, result ToolResult) (toolProgressShell, bool) {
	var receipt toolProgressShell
	if (call.Name != "Bash" && call.Name != "shell") || len(result.Content) != 1 || result.Content[0].Type != BlockText || json.Unmarshal([]byte(result.Content[0].Text), &receipt) != nil {
		return receipt, false
	}
	if receipt.Result != nil {
		outer := receipt
		receipt = *receipt.Result
		receipt.CleanupUncertain = receipt.CleanupUncertain || outer.CleanupUncertain
		receipt.TimedOut = receipt.TimedOut || outer.TimedOut
		receipt.Aborted = receipt.Aborted || outer.Aborted
	}
	return receipt, receipt.ExitCode != nil && !receipt.TimedOut && !receipt.Aborted && !receipt.CleanupUncertain
}

func (p *toolFailureWindow) observe(call ContentBlock, result ToolResult) *DeferredContext {
	receipt, settled := observedShellResult(call, result)
	failed := settled && *receipt.ExitCode != 0
	p.window = append(p.window, failed)
	if len(p.window) > 24 {
		p.window = p.window[1:]
	}
	p.sinceNotice++
	count := 0
	for _, failure := range p.window {
		if failure {
			count++
		}
	}
	if !failed || count < 8 || p.notified && p.sinceNotice < 24 {
		return nil
	}
	p.notified, p.sinceNotice = true, 0
	source, _ := json.Marshal(struct {
		Kind        string     `json:"kind"`
		Pattern     string     `json:"pattern"`
		CallID      ToolCallID `json:"callId"`
		Count       int        `json:"count"`
		WindowCalls int        `json:"windowCalls"`
	}{"tool-progress-pattern", "nonzero shell exits across recent operations", call.ToolCallID, count, len(p.window)})
	return &DeferredContext{Role: RoleUser, Source: source, Content: []ContentBlock{{Type: BlockText, Text: fmt.Sprintf("Observed %d settled nonzero shell exits in the last %d tool operations, including intervening edits or inspections. Review the actual diagnostics and the original requirements. If experiments are not improving independent validation, change the approach and run a focused check. Successful file edits alone do not verify a fix. This advisory does not establish stagnation or impose a call limit; preserve useful exploration and legitimate waits.", count, len(p.window))}}}
}

func (p *toolProgressPatterns) observe(turn int, call ContentBlock, key, fingerprint [32]byte, result ToolResult) *DeferredContext {
	if p.turn != turn {
		*p = toolProgressPatterns{turn: turn}
	}
	p.window = append(p.window, progressObservation{key, fingerprint})
	if len(p.window) > 6 {
		p.window = p.window[1:]
	}
	pattern, count := "", 0
	if len(p.window) == 6 && p.window[0].key != p.window[1].key {
		alternating := true
		for i := 2; i < 6; i++ {
			alternating = alternating && p.window[i] == p.window[i%2]
		}
		if alternating {
			pattern, count = "alternating calls with unchanged results", 6
			p.window = nil
		}
	}
	failure := ""
	if result.IsError {
		failure = "tool error"
	}
	if call.Name == "Bash" || call.Name == "shell" {
		if receipt, settled := observedShellResult(call, result); settled && *receipt.ExitCode != 0 {
			failure = fmt.Sprintf("shell exit %d", *receipt.ExitCode)
		}
		var args struct {
			Command string `json:"command"`
		}
		inspection := json.Unmarshal(call.Arguments, &args) == nil && gitOverview.MatchString(strings.TrimSpace(args.Command))
		if inspection {
			p.inspections++
		} else {
			p.inspections = 0
		}
		if p.inspections == 8 {
			pattern, count = "repeated Git overview inspections", p.inspections
		}
	} else {
		p.inspections = 0
	}
	if failure == "" {
		p.failure, p.failures = "", 0
	} else if failure == p.failure {
		p.failures++
	} else {
		p.failure, p.failures = failure, 1
	}
	if p.failures == 8 {
		pattern, count = "consecutive failures: "+failure, p.failures
	}
	if pattern == "" {
		return nil
	}
	source, _ := json.Marshal(struct {
		Kind         string     `json:"kind"`
		Pattern      string     `json:"pattern"`
		CallID       ToolCallID `json:"callId"`
		Count        int        `json:"count"`
		ResultSHA256 string     `json:"result_sha256"`
	}{
		"tool-progress-pattern", pattern, call.ToolCallID, count, hex.EncodeToString(fingerprint[:]),
	})
	return &DeferredContext{Role: RoleUser, Source: source, Content: []ContentBlock{{Type: BlockText, Text: fmt.Sprintf(
		"Observed %s (%d calls). Review the actual errors and required deliverables, then change strategy if these calls are not advancing the task. This advisory does not establish that files are unchanged or impose a call limit. Preserve productive exploration and legitimate waits.", pattern, count)}}}
}
