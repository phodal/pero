package nativetools

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestBashOutputPolicyConfiguration(t *testing.T) {
	for _, test := range []struct {
		name             string
		options          BashOutputOptions
		environment      []string
		inline, readback int
		fail             bool
	}{
		{"defaults", BashOutputOptions{}, nil, 30000, 30000, false},
		{"readback environment", BashOutputOptions{}, []string{"BASH_MAX_OUTPUT_LENGTH=60000"}, 30000, 60000, false},
		{"environment hard ceiling", BashOutputOptions{}, []string{"BASH_MAX_OUTPUT_LENGTH=999999"}, 30000, 150000, false},
		{"typed readback", BashOutputOptions{ReadbackChars: 50000}, []string{"BASH_MAX_OUTPUT_LENGTH=70000"}, 30000, 50000, false},
		{"inline override controls both", BashOutputOptions{BashOutputMaxChars: 128000}, []string{"BASH_MAX_OUTPUT_LENGTH=invalid"}, 128000, 128000, false},
		{"invalid inline override", BashOutputOptions{BashOutputMaxChars: 128001}, nil, 0, 0, true},
		{"invalid typed readback", BashOutputOptions{ReadbackChars: 150001}, nil, 0, 0, true},
		{"invalid environment", BashOutputOptions{}, []string{"BASH_MAX_OUTPUT_LENGTH=invalid"}, 0, 0, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			policy, err := resolveBashOutputPolicy(test.options, test.environment)
			if (err != nil) != test.fail || !test.fail && (policy.inlineChars != test.inline || policy.readbackChars != test.readback) {
				t.Fatalf("policy=%+v error=%v", policy, err)
			}
		})
	}
}

func TestBashOutputProjectionUsesUnicodeAndReadbackWindow(t *testing.T) {
	unicode := strings.Repeat("汉🙂", 15000)
	failure := strings.Repeat("A", 5000) + strings.Repeat("M", 20000) + strings.Repeat("C", 5000) + strings.Repeat("D", 10000)
	for _, test := range []struct {
		name, source        string
		success             bool
		options             BashOutputOptions
		characters          int
		artifact, truncated bool
		start, end, absent  string
	}{
		{"success at default boundary", strings.Repeat("a", 30000), true, BashOutputOptions{}, 30000, false, false, "a", "a", ""},
		{"success above default boundary", strings.Repeat("a", 30001), true, BashOutputOptions{}, 2000, true, true, "a", "a", ""},
		{"unicode counts as characters", unicode, true, BashOutputOptions{}, 30000, false, false, "汉🙂", "汉🙂", ""},
		{"unicode preview is safe", unicode + "尾", true, BashOutputOptions{}, 2000, true, true, "汉🙂", "汉🙂", "尾"},
		{"failure at inline boundary", strings.Repeat("f", 10000), false, BashOutputOptions{}, 10000, false, false, "f", "f", ""},
		{"failure excerpt uses first readback window", failure, false, BashOutputOptions{}, 10000, false, true, "AAAA", "CCCC", "D"},
		{"raised readback changes failure tail", failure, false, BashOutputOptions{ReadbackChars: 60000}, 10000, false, true, "AAAA", "DDDD", ""},
		{"override raises inline threshold", strings.Repeat("x", 40000), true, BashOutputOptions{BashOutputMaxChars: 50000}, 40000, false, false, "x", "x", ""},
		{"readback alone does not raise inline", strings.Repeat("r", 35000), true, BashOutputOptions{ReadbackChars: 60000}, 2000, true, true, "r", "r", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			policy, err := resolveBashOutputPolicy(test.options, nil)
			if err != nil {
				t.Fatal(err)
			}
			prefix, err := policy.readPrefix(strings.NewReader(test.source))
			if err != nil {
				t.Fatal(err)
			}
			view := projectBashOutput(policy, prefix, test.success)
			if utf8.RuneCountInString(view.Text) != test.characters || !utf8.ValidString(view.Text) || view.artifact != test.artifact || view.Truncated != test.truncated || !strings.HasPrefix(view.Text, test.start) || !strings.HasSuffix(view.Text, test.end) || test.absent != "" && strings.Contains(view.Text, test.absent) {
				t.Fatalf("projection chars=%d artifact=%v truncated=%v prefix=%q suffix=%q", utf8.RuneCountInString(view.Text), view.artifact, view.Truncated, view.Text[:min(20, len(view.Text))], view.Text[max(0, len(view.Text)-20):])
			}
		})
	}
}
