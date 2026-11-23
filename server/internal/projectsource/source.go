// Package projectsource owns the reviewed text and identity shared by project members.
package projectsource

import (
	"crypto/sha256"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

const MaxSourcesPerProject = 256
const maxMarkdownBytes = 16_384

var captureID = regexp.MustCompile(`^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$`)
var projectID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type CaptureID string

func ParseCaptureID(value string) (CaptureID, bool) {
	return CaptureID(value), captureID.MatchString(value)
}

func ValidProjectID(value string) bool { return projectID.MatchString(value) }

type Draft struct {
	ID         string `json:"id"`
	URL        string `json:"url"`
	Title      string `json:"title"`
	Content    string `json:"content"`
	Reason     string `json:"reason"`
	Question   string `json:"question"`
	Scope      string `json:"scope"`
	Truncated  bool   `json:"truncated"`
	CapturedAt uint64 `json:"capturedAt"`
}

type ReviewedWebSource struct {
	draft  Draft
	sha256 string
}

func Review(d Draft) (ReviewedWebSource, error) {
	if _, ok := ParseCaptureID(d.ID); !ok || d.CapturedAt == 0 || d.CapturedAt > 1<<53-1 ||
		d.Scope != "page" && d.Scope != "selection" {
		return ReviewedWebSource{}, fmt.Errorf("invalid browser capture identity")
	}
	u, err := url.Parse(d.URL)
	if err != nil || len(d.URL) > 4096 || u.Hostname() == "" || u.User != nil || u.Opaque != "" ||
		u.Scheme != "http" && u.Scheme != "https" ||
		strings.ContainsFunc(d.URL, func(c rune) bool { return unicode.IsSpace(c) || unicode.IsControl(c) }) {
		return ReviewedWebSource{}, fmt.Errorf("use an HTTP(S) source URL without credentials")
	}
	if strings.TrimSpace(d.Title) == "" || len(d.Title) > 160 || strings.ContainsFunc(d.Title, unicode.IsControl) {
		return ReviewedWebSource{}, fmt.Errorf("enter a source title of at most 160 UTF-8 bytes")
	}
	if strings.TrimSpace(d.Content) == "" {
		return ReviewedWebSource{}, fmt.Errorf("enter readable source text")
	}
	for _, value := range []string{d.Content, d.Reason, d.Question} {
		if strings.ContainsFunc(value, func(c rune) bool { return unicode.IsControl(c) && c != '\n' && c != '\r' && c != '\t' }) {
			return ReviewedWebSource{}, fmt.Errorf("source text contains control characters")
		}
	}
	markdown := d.markdown()
	if len(d.Reason) > 2048 || len(d.Question) > 2048 || len(markdown) > maxMarkdownBytes {
		return ReviewedWebSource{}, fmt.Errorf("the reviewed source exceeds its UTF-8 byte limit")
	}
	return ReviewedWebSource{draft: d, sha256: fmt.Sprintf("%x", sha256.Sum256([]byte(markdown)))}, nil
}

func (d Draft) markdown() string {
	capture := "Chrome " + d.Scope + " · " + strconv.FormatUint(d.CapturedAt, 10) + " (Unix ms)"
	if d.Truncated {
		capture += "\nCapture was truncated."
	}
	sections := []string{"# " + d.Title, d.URL, capture, d.Content}
	if d.Reason != "" {
		sections = append(sections, "## Why collect it?\n"+d.Reason)
	}
	if d.Question != "" {
		sections = append(sections, "## Question\n"+d.Question)
	}
	return strings.Join(sections, "\n\n")
}

func (s ReviewedWebSource) Draft() Draft   { return s.draft }
func (s ReviewedWebSource) SHA256() string { return s.sha256 }

type Snapshot struct {
	ProjectID string `json:"projectId"`
	Source    Draft  `json:"source"`
	SHA256    string `json:"sha256"`
	SavedAt   uint64 `json:"savedAt"`
}

type Summary struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Scope     string `json:"scope"`
	Truncated bool   `json:"truncated"`
	SHA256    string `json:"sha256"`
	SavedAt   uint64 `json:"savedAt"`
}

func (s Snapshot) Summary() Summary {
	d := s.Source
	return Summary{ID: d.ID, Title: d.Title, URL: d.URL, Scope: d.Scope,
		Truncated: d.Truncated, SHA256: s.SHA256, SavedAt: s.SavedAt}
}
