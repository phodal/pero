package tool

import (
	"regexp"
	"strings"
)

// Only recognizable terminal failure structures are candidates. Individual
// error words, echoed assertions and expected-failure counts are insufficient.
// Even a whole traceback can be quoted intentionally: callers must present the
// observation as advisory, never as an acceptance verdict or process failure.
var validationSummary = regexp.MustCompile(`(?m)^(?:FAILED \([^\n]*(?:failures|errors)=[1-9][0-9]*[^\n]*\)|=+ [^\n]*\b[1-9][0-9]* failed[^\n]* =+|\*\*\*Test Failed\*\*\* [1-9][0-9]* failures?\.|FAIL\s+\S+[^\n]*)\s*$`)
var tracebackEnd = regexp.MustCompile(`(?m)^[A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception)(?::[^\n]*)?$`)

func validationFailureSignal(streams ...string) string {
	for _, text := range streams {
		if validationSummary.MatchString(text) {
			return "test-failure-summary"
		}
		if start := strings.Index(text, "Traceback (most recent call last):\n"); start >= 0 && (start == 0 || text[start-1] == '\n') {
			tail := text[start:]
			if strings.Contains(tail, "\n  File \"") && tracebackEnd.MatchString(tail) {
				return "python-traceback"
			}
		}
	}
	return ""
}
