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
		var receipt toolProgressShell
		if len(result.Content) == 1 && json.Unmarshal([]byte(result.Content[0].Text), &receipt) == nil {
			if receipt.Result != nil {
				receipt = *receipt.Result
			}
			if receipt.ExitCode != nil && *receipt.ExitCode != 0 && !receipt.TimedOut && !receipt.Aborted && !receipt.CleanupUncertain {
				failure = fmt.Sprintf("shell exit %d", *receipt.ExitCode)
			}
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
