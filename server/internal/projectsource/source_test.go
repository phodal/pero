package projectsource

import (
	"crypto/sha256"
	"fmt"
	"strings"
	"testing"
)

func TestReviewSource(t *testing.T) {
	base := Draft{ID: "12345678-1234-1234-1234-123456789abc", URL: "https://example.test/article",
		Title: "审阅", Content: "Excerpt", Reason: "Evidence", Question: "Why?",
		Scope: "selection", Truncated: true, CapturedAt: 1234567890}
	for _, tc := range []struct {
		name   string
		change func(*Draft)
	}{
		{"accepted", nil},
		{"non-web URL", func(d *Draft) { d.URL = "file:///private/source" }},
		{"credentials", func(d *Draft) { d.URL = "https://name:password@example.test" }},
		{"invalid capture identity", func(d *Draft) { d.ID = "../other" }},
		{"invalid scope", func(d *Draft) { d.Scope = "dynamic" }},
		{"empty text", func(d *Draft) { d.Content = "\u00a0\t" }},
		{"excess UTF-8 bytes", func(d *Draft) { d.Content = strings.Repeat("文", 6000) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := base
			if tc.change != nil {
				tc.change(&input)
			}
			got, err := Review(input)
			if tc.change != nil {
				if err == nil {
					t.Fatal("invalid review was accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			const markdown = "# 审阅\n\nhttps://example.test/article\n\nChrome selection · 1234567890 (Unix ms)\nCapture was truncated.\n\nExcerpt\n\n## Why collect it?\nEvidence\n\n## Question\nWhy?"
			if got.SHA256() != fmt.Sprintf("%x", sha256.Sum256([]byte(markdown))) {
				t.Fatal("receipt digest does not describe the reviewed Markdown")
			}
		})
	}
}
