package github

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	taskast "github.com/yuin/goldmark/extension/ast"
	gmtext "github.com/yuin/goldmark/text"
)

// RoadmapItem is a goal observed in a Markdown checklist. Checked is provider
// state, not execution, verification or acceptance in Pero.
type RoadmapItem struct {
	ID, ParentID string
	Title, Text  string
	Checked      bool
	Line         int
	Headings     []string
	Tags         []string
}

type RoadmapParse struct {
	Items   []RoadmapItem
	Partial bool
	Errors  []string
}

type roadmapCandidate struct {
	item   RoadmapItem
	parent int
	valid  bool
}

var roadmapID = regexp.MustCompile(`<!--\s*pero:id:\s*([A-Za-z0-9][A-Za-z0-9._:-]*)\s*-->`)
var roadmapTag = regexp.MustCompile(`(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_./:-]*)`)
var roadmapCheckbox = regexp.MustCompile(`^\[[ xX]\]\s*`)

// ParseRoadmap is a pure Markdown-to-source transformation. An incomplete parse
// must never authorize closing absent items. Explicit IDs preserve identity
// across edits; implicit IDs preserve line/commit shifts and body-only edits.
func ParseRoadmap(source []byte) RoadmapParse {
	result := RoadmapParse{Items: []RoadmapItem{}, Errors: []string{}}
	reject := func(message string) {
		result.Partial = true
		if len(result.Errors) < 32 {
			result.Errors = append(result.Errors, message)
		}
	}
	if len(source) > 512*1024 || !utf8.Valid(source) || bytes.ContainsRune(source, 0) {
		reject("ROADMAP must be valid UTF-8 without NUL and at most 512 KiB")
		return result
	}
	document := goldmark.New(goldmark.WithExtensions(extension.TaskList)).Parser().Parse(gmtext.NewReader(source))
	var headings [6]string
	candidates := []roadmapCandidate{}
	positions := map[ast.Node]int{}
	_ = ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		if heading, ok := node.(*ast.Heading); ok {
			headings[heading.Level-1] = strings.TrimSpace(string(heading.Text(source)))
			for i := heading.Level; i < len(headings); i++ {
				headings[i] = ""
			}
			return ast.WalkContinue, nil
		}
		checkbox := roadmapTaskCheckbox(node)
		if checkbox == nil {
			return ast.WalkContinue, nil
		}
		if len(candidates) >= 2000 {
			reject("ROADMAP exceeds 2000 checklist items")
			return ast.WalkStop, nil
		}
		parent := -1
		for ancestor := node.Parent(); ancestor != nil; ancestor = ancestor.Parent() {
			if index, found := positions[ancestor]; found {
				parent = index
				break
			}
		}
		item := RoadmapItem{Checked: checkbox.IsChecked, Headings: []string{}, Tags: []string{}}
		for _, heading := range headings {
			if heading != "" {
				item.Headings = append(item.Headings, heading)
			}
		}
		block := node.FirstChild()
		item.Line = bytes.Count(source[:block.Lines().At(0).Start], []byte("\n")) + 1
		body := roadmapTaskText(node, source)
		annotations := roadmapTaskAnnotations(node, source)
		matches := roadmapID.FindAllStringSubmatch(strings.Join(annotations, "\n"), -1)
		valid := true
		if len(matches) > 1 || len(annotations) != len(matches) {
			reject(fmt.Sprintf("line %d has an invalid or ambiguous pero:id annotation", item.Line))
			valid = false
		}
		if len(matches) == 1 {
			item.ID = matches[0][1]
			if len(item.ID) > 128 {
				reject(fmt.Sprintf("line %d has a pero:id longer than 128 bytes", item.Line))
				valid = false
			}
		}
		for _, annotation := range annotations {
			body = strings.Replace(body, annotation, "", 1)
		}
		item.Text = strings.TrimSpace(body)
		item.Title, _, _ = strings.Cut(item.Text, "\n")
		item.Title, _, _ = strings.Cut(item.Title, ". ")
		item.Title = strings.TrimSpace(item.Title)
		item.Tags = roadmapTaskTags(node, source)
		if !text(item.Title, 240) || !text(item.Text, 64000) || len(item.Tags) > 64 {
			reject(fmt.Sprintf("line %d has an empty or oversized checklist goal", item.Line))
			valid = false
		}
		for _, tag := range item.Tags {
			if utf8.RuneCountInString(tag) > 128 {
				reject(fmt.Sprintf("line %d has a tag longer than 128 characters", item.Line))
				valid = false
			}
		}
		if parent >= 0 {
			item.ParentID = candidates[parent].item.ID
		}
		if item.ID == "" {
			identity := strings.Join(item.Headings, "\x1f") + "\x1e" + item.ParentID + "\x1e" + strings.Join(strings.Fields(item.Title), " ")
			digest := sha256.Sum256([]byte(identity))
			item.ID = "auto_" + hex.EncodeToString(digest[:])
		}
		positions[node] = len(candidates)
		candidates = append(candidates, roadmapCandidate{item: item, parent: parent, valid: valid})
		return ast.WalkContinue, nil
	})
	counts := map[string]int{}
	for _, candidate := range candidates {
		counts[candidate.item.ID]++
	}
	for i := range candidates {
		candidate := &candidates[i]
		if counts[candidate.item.ID] > 1 {
			reject(fmt.Sprintf("line %d has duplicate checklist identity %q", candidate.item.Line, candidate.item.ID))
			candidate.valid = false
		}
		if candidate.parent >= 0 && !candidates[candidate.parent].valid {
			reject(fmt.Sprintf("line %d has an ambiguous parent checklist", candidate.item.Line))
			candidate.valid = false
		}
		if candidate.valid {
			result.Items = append(result.Items, candidate.item)
		}
	}
	return result
}

func roadmapTaskCheckbox(node ast.Node) *taskast.TaskCheckBox {
	if _, ok := node.(*ast.ListItem); !ok {
		return nil
	}
	first := node.FirstChild()
	if first == nil || first.Lines().Len() == 0 {
		return nil
	}
	checkbox, _ := first.FirstChild().(*taskast.TaskCheckBox)
	return checkbox
}

// Text belongs only to this checkbox. Nested checkbox goals are separate items;
// ordinary nested list descriptions and fenced examples remain input context.
func roadmapTaskText(item ast.Node, source []byte) string {
	blocks := []string{}
	var collect func(ast.Node)
	collect = func(node ast.Node) {
		if node != item && roadmapTaskCheckbox(node) != nil {
			return
		}
		if _, heading := node.(*ast.Heading); heading {
			return
		}
		if node.Type() == ast.TypeBlock && node.Lines().Len() > 0 {
			value := string(node.Lines().Value(source))
			if node == item.FirstChild() {
				value = roadmapCheckbox.ReplaceAllString(strings.TrimSpace(value), "")
			}
			switch block := node.(type) {
			case *ast.FencedCodeBlock:
				info := ""
				if block.Info != nil {
					info = string(block.Info.Value(source))
				}
				value = "```" + info + "\n" + strings.TrimRight(value, "\r\n") + "\n```"
			case *ast.CodeBlock:
				value = "```\n" + strings.TrimRight(value, "\r\n") + "\n```"
			}
			blocks = append(blocks, strings.TrimSpace(value))
			return
		}
		for child := node.FirstChild(); child != nil; child = child.NextSibling() {
			collect(child)
		}
	}
	collect(item)
	return strings.Join(blocks, "\n\n")
}

func roadmapTaskTags(item ast.Node, source []byte) []string {
	tags := []string{}
	seen := map[string]bool{}
	_ = ast.Walk(item, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		if node != item && roadmapTaskCheckbox(node) != nil {
			return ast.WalkSkipChildren, nil
		}
		switch node.(type) {
		case *ast.CodeSpan, *ast.CodeBlock, *ast.FencedCodeBlock, *ast.RawHTML, *ast.Heading:
			return ast.WalkSkipChildren, nil
		}
		if value, ok := node.(*ast.Text); ok {
			for _, match := range roadmapTag.FindAllStringSubmatch(string(value.Value(source)), -1) {
				if tag := match[2]; !seen[tag] {
					seen[tag] = true
					tags = append(tags, tag)
				}
			}
		}
		return ast.WalkContinue, nil
	})
	return tags
}

func roadmapTaskAnnotations(item ast.Node, source []byte) []string {
	annotations := []string{}
	_ = ast.Walk(item, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		if node != item && roadmapTaskCheckbox(node) != nil {
			return ast.WalkSkipChildren, nil
		}
		switch node.(type) {
		case *ast.CodeSpan, *ast.CodeBlock, *ast.FencedCodeBlock:
			return ast.WalkSkipChildren, nil
		case *ast.RawHTML, *ast.HTMLBlock:
			value := string(node.Text(source))
			if strings.HasPrefix(strings.TrimSpace(value), "<!--") && strings.Contains(value, "pero:id") {
				annotations = append(annotations, value)
			}
		}
		return ast.WalkContinue, nil
	})
	return annotations
}
