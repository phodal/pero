package nativetools

import (
	"strings"
	"testing"
	"time"
)

func TestBashTimingHostPolicy(t *testing.T) {
	for _, test := range []struct {
		name                                                 string
		options                                              BashTimingOptions
		environment                                          []string
		foreground, foregroundMax, background, backgroundMax time.Duration
		disabled, fail                                       bool
	}{
		{"defaults", BashTimingOptions{}, nil, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute, 2 * time.Hour, false, false},
		{"lower environment does not shorten", BashTimingOptions{}, []string{"BASH_DEFAULT_TIMEOUT_MS=1", "BASH_MAX_TIMEOUT_MS=2"}, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute, 2 * time.Hour, false, false},
		{"raised foreground default", BashTimingOptions{}, []string{"BASH_DEFAULT_TIMEOUT_MS=900000"}, 15 * time.Minute, 15 * time.Minute, 30 * time.Minute, 2 * time.Hour, false, false},
		{"default raises both maxima", BashTimingOptions{}, []string{"BASH_DEFAULT_TIMEOUT_MS=10800000"}, 3 * time.Hour, 3 * time.Hour, 3 * time.Hour, 3 * time.Hour, false, false},
		{"maximum raises both ceilings", BashTimingOptions{}, []string{"BASH_MAX_TIMEOUT_MS=14400000"}, 2 * time.Minute, 4 * time.Hour, 30 * time.Minute, 4 * time.Hour, false, false},
		{"disable environment", BashTimingOptions{}, []string{"CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1"}, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute, 2 * time.Hour, true, false},
		{"bare host", BashTimingOptions{Bare: true}, nil, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute, 2 * time.Hour, true, false},
		{"unknown host mode", BashTimingOptions{HostMode: "tty"}, nil, 0, 0, 0, 0, false, true},
		{"duration overflow", BashTimingOptions{}, []string{"BASH_DEFAULT_TIMEOUT_MS=9223372036854775807"}, 0, 0, 0, 0, false, true},
		{"invalid maximum", BashTimingOptions{}, []string{"BASH_MAX_TIMEOUT_MS=private-invalid-value"}, 0, 0, 0, 0, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			policy, err := resolveBashTimingPolicy(test.options, test.environment)
			if (err != nil) != test.fail {
				t.Fatalf("policy=%+v error=%v", policy, err)
			}
			if test.fail {
				if err != nil && strings.Contains(err.Error(), "private-invalid-value") {
					t.Fatal("configuration value leaked")
				}
				return
			}
			if policy.foregroundDefault != test.foreground || policy.foregroundMaximum != test.foregroundMax || policy.backgroundDefault != test.background || policy.backgroundMaximum != test.backgroundMax || policy.disabled != test.disabled {
				t.Fatalf("policy=%+v", policy)
			}
		})
	}
}

func TestBashTimingCommandSelection(t *testing.T) {
	for _, test := range []struct {
		name, command       string
		options             BashTimingOptions
		background          bool
		timeout             int
		wait, runtime       time.Duration
		promote, none, fail bool
	}{
		{"foreground promotes", "printf work", BashTimingOptions{}, false, 25, 25 * time.Millisecond, 25 * time.Millisecond, true, false, false},
		{"sleep does not promote", "  sleep 30; printf done", BashTimingOptions{}, false, 25, 25 * time.Millisecond, 25 * time.Millisecond, false, false, false},
		{"absolute sleep", "/bin/sleep 30", BashTimingOptions{}, false, 25, 25 * time.Millisecond, 25 * time.Millisecond, false, false, false},
		{"different prefix", "sleeper 30", BashTimingOptions{}, false, 25, 25 * time.Millisecond, 25 * time.Millisecond, true, false, false},
		{"background request cap", "printf work", BashTimingOptions{}, true, 999999999, 0, 2 * time.Hour, false, false, false},
		{"interactive has no background deadline", "printf work", BashTimingOptions{HostMode: BashInteractive}, true, 25, 0, 0, false, true, false},
		{"disabled stops foreground", "printf work", BashTimingOptions{DisableBackground: true}, false, 25, 25 * time.Millisecond, 25 * time.Millisecond, false, false, false},
		{"disabled rejects explicit background", "printf work", BashTimingOptions{DisableBackground: true}, true, 25, 0, 0, false, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			policy, err := resolveBashTimingPolicy(test.options, nil)
			if err != nil {
				t.Fatal(err)
			}
			selected, err := policy.selectTimeout(test.command, test.timeout, test.background)
			if (err != nil) != test.fail || !test.fail && (selected.wait != test.wait || selected.runtime != test.runtime || selected.promote != test.promote || selected.noDeadline != test.none) {
				t.Fatalf("selection=%+v error=%v", selected, err)
			}
		})
	}
}
