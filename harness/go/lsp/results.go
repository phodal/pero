package lsp

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf16"
)

type Operation string

const (
	Definition           Operation = "goToDefinition"
	References           Operation = "findReferences"
	Hover                Operation = "hover"
	DocumentSymbol       Operation = "documentSymbol"
	WorkspaceSymbol      Operation = "workspaceSymbol"
	Implementation       Operation = "goToImplementation"
	PrepareCallHierarchy Operation = "prepareCallHierarchy"
	IncomingCalls        Operation = "incomingCalls"
	OutgoingCalls        Operation = "outgoingCalls"
)

var operations = []Operation{Definition, References, Hover, DocumentSymbol, WorkspaceSymbol, Implementation, PrepareCallHierarchy, IncomingCalls, OutgoingCalls}

type Query struct {
	Operation       Operation
	FilePath        string
	Line, Character int
}
type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}
type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}
type Location struct {
	URI   string `json:"uri"`
	Range Range  `json:"range"`
}
type Symbol struct {
	Name     string
	Kind     int
	URI      string
	Range    *Range
	Children []Symbol
}
type Call struct {
	Item    Symbol
	SiteURI string
	Ranges  []Range
}
type Result struct {
	Operation Operation
	Locations []Location
	Hover     string
	Symbols   []Symbol
	Calls     []Call
	Truncated bool
}

func (q Query) position(text string) (Position, string, error) {
	known := false
	for _, operation := range operations {
		known = known || q.Operation == operation
	}
	if !known || q.FilePath == "" || strings.ContainsRune(q.FilePath, 0) || q.Line < 1 || q.Character < 1 {
		return Position{}, "", errors.New("lsp: operation, source file and positive one-based cursor coordinates are required")
	}
	lines := strings.Split(text, "\n")
	if q.Line > len(lines) {
		return Position{}, "", errors.New("lsp: cursor line is past the source file")
	}
	line := strings.TrimSuffix(lines[q.Line-1], "\r")
	units, index := 0, 0
	for offset, char := range line {
		if units == q.Character-1 {
			index = offset
			break
		}
		width := 1
		if char > 0xffff {
			width = 2
		}
		units += width
		index = offset + len(string(char))
		if units > q.Character-1 {
			return Position{}, "", errors.New("lsp: cursor splits a UTF-16 surrogate pair")
		}
	}
	if units != q.Character-1 && len(utf16.Encode([]rune(line))) != q.Character-1 {
		return Position{}, "", errors.New("lsp: cursor character is past the source line")
	}
	runes := []rune(line)
	cursor := len([]rune(line[:index]))
	if cursor == len(runes) && cursor > 0 {
		cursor--
	}
	identifier := func(char rune) bool {
		return unicode.IsLetter(char) || unicode.IsDigit(char) || char == '_' || char == '$'
	}
	start, end := cursor, cursor
	if cursor < len(runes) && identifier(runes[cursor]) {
		for start > 0 && identifier(runes[start-1]) {
			start--
		}
		end = cursor + 1
		for end < len(runes) && identifier(runes[end]) {
			end++
		}
	}
	return Position{q.Line - 1, q.Character - 1}, string(runes[start:end]), nil
}

type wireLocation struct {
	URI                  string `json:"uri"`
	Range                *Range `json:"range"`
	TargetURI            string `json:"targetUri"`
	TargetSelectionRange *Range `json:"targetSelectionRange"`
}

func decodeLocations(raw json.RawMessage) ([]Location, error) {
	raw = bytes.TrimSpace(raw)
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var entries []wireLocation
	if len(raw) > 0 && raw[0] == '[' {
		if json.Unmarshal(raw, &entries) != nil {
			return nil, errors.New("lsp: invalid locations response")
		}
	} else {
		var item wireLocation
		if json.Unmarshal(raw, &item) != nil {
			return nil, errors.New("lsp: invalid location response")
		}
		entries = []wireLocation{item}
	}
	result := make([]Location, 0, len(entries))
	for _, entry := range entries {
		uri, span := entry.URI, entry.Range
		if entry.TargetURI != "" {
			uri, span = entry.TargetURI, entry.TargetSelectionRange
		}
		if uri == "" || span == nil || !validRange(*span) {
			return nil, errors.New("lsp: invalid location response")
		}
		result = append(result, Location{URI: uri, Range: *span})
	}
	return result, nil
}
func validRange(value Range) bool {
	return value.Start.Line >= 0 && value.Start.Character >= 0 && value.End.Line >= value.Start.Line && value.End.Character >= 0 && (value.End.Line != value.Start.Line || value.End.Character >= value.Start.Character)
}

func decodeHover(raw json.RawMessage) (string, error) {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return "", nil
	}
	var wire struct {
		Contents json.RawMessage `json:"contents"`
	}
	if json.Unmarshal(raw, &wire) != nil || len(wire.Contents) == 0 {
		return "", errors.New("lsp: invalid hover response")
	}
	var parts []json.RawMessage
	if wire.Contents[0] == '[' {
		if json.Unmarshal(wire.Contents, &parts) != nil {
			return "", errors.New("lsp: invalid hover contents")
		}
	} else {
		parts = []json.RawMessage{wire.Contents}
	}
	text := []string{}
	for _, part := range parts {
		var value string
		if json.Unmarshal(part, &value) == nil {
			text = append(text, value)
			continue
		}
		var marked struct {
			Value    *string `json:"value"`
			Language string  `json:"language"`
			Kind     string  `json:"kind"`
		}
		if json.Unmarshal(part, &marked) != nil || marked.Value == nil {
			return "", errors.New("lsp: unsupported hover contents")
		}
		if marked.Language != "" {
			text = append(text, "```"+marked.Language+"\n"+*marked.Value+"\n```")
		} else {
			text = append(text, *marked.Value)
		}
	}
	return strings.Join(text, "\n\n"), nil
}

type wireSymbol struct {
	Name     string `json:"name"`
	Kind     int    `json:"kind"`
	URI      string `json:"uri"`
	Range    *Range `json:"range"`
	Location *struct {
		URI   string `json:"uri"`
		Range *Range `json:"range"`
	} `json:"location"`
	Children []wireSymbol `json:"children"`
}

func decodeSymbols(raw json.RawMessage, documentURI string) ([]Symbol, error) {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var entries []wireSymbol
	if json.Unmarshal(raw, &entries) != nil {
		return nil, errors.New("lsp: invalid symbols response")
	}
	return normalizeSymbols(entries, documentURI, 0)
}
func normalizeSymbols(entries []wireSymbol, documentURI string, depth int) ([]Symbol, error) {
	if depth > 64 {
		return nil, errors.New("lsp: symbol tree exceeds 64 levels")
	}
	result := make([]Symbol, 0, len(entries))
	for _, entry := range entries {
		if entry.Name == "" {
			return nil, errors.New("lsp: symbol response has no name")
		}
		item := Symbol{Name: entry.Name, Kind: entry.Kind, URI: documentURI, Range: entry.Range}
		if entry.Location != nil {
			item.URI, item.Range = entry.Location.URI, entry.Location.Range
		}
		if item.Range != nil && !validRange(*item.Range) {
			return nil, errors.New("lsp: invalid symbol range")
		}
		var err error
		item.Children, err = normalizeSymbols(entry.Children, documentURI, depth+1)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

type hierarchyItem struct {
	Name           string          `json:"name"`
	Kind           int             `json:"kind"`
	URI            string          `json:"uri"`
	Range          *Range          `json:"range"`
	SelectionRange *Range          `json:"selectionRange"`
	Tags           []int           `json:"tags,omitempty"`
	Detail         string          `json:"detail,omitempty"`
	Data           json.RawMessage `json:"data,omitempty"`
}

func decodeHierarchy(raw json.RawMessage) ([]hierarchyItem, error) {
	var items []hierarchyItem
	if json.Unmarshal(raw, &items) != nil {
		return nil, errors.New("lsp: invalid call hierarchy response")
	}
	for _, item := range items {
		if !validHierarchy(item) {
			return nil, errors.New("lsp: invalid call hierarchy item")
		}
	}
	return items, nil
}
func symbolFromHierarchy(item hierarchyItem) Symbol {
	selection := *item.SelectionRange
	return Symbol{Name: item.Name, Kind: item.Kind, URI: item.URI, Range: &selection}
}
func validHierarchy(item hierarchyItem) bool {
	return item.Name != "" && item.URI != "" && item.Range != nil && item.SelectionRange != nil && validRange(*item.Range) && validRange(*item.SelectionRange)
}
func decodeCalls(raw json.RawMessage, incoming bool, callerURI string) ([]Call, error) {
	var entries []struct {
		From   hierarchyItem `json:"from"`
		To     hierarchyItem `json:"to"`
		Ranges []Range       `json:"fromRanges"`
	}
	if json.Unmarshal(raw, &entries) != nil {
		return nil, errors.New("lsp: invalid call hierarchy edges")
	}
	calls := make([]Call, 0, len(entries))
	for _, entry := range entries {
		item := entry.To
		if incoming {
			item = entry.From
		}
		if !validHierarchy(item) {
			return nil, errors.New("lsp: invalid call hierarchy endpoint")
		}
		for _, r := range entry.Ranges {
			if !validRange(r) {
				return nil, errors.New("lsp: invalid call hierarchy range")
			}
		}
		siteURI := callerURI
		if incoming {
			siteURI = item.URI
		}
		calls = append(calls, Call{Item: symbolFromHierarchy(item), SiteURI: siteURI, Ranges: entry.Ranges})
	}
	return calls, nil
}

func (result Result) Format() (string, bool) {
	lines := []string{}
	remaining := 100
	appendLine := func(text string) {
		if remaining > 0 {
			lines = append(lines, text)
			remaining--
		} else {
			result.Truncated = true
		}
	}
	if result.Hover != "" {
		appendLine(result.Hover)
	}
	for _, location := range result.Locations {
		appendLine(fmt.Sprintf("%s:%d:%d", location.URI, location.Range.Start.Line+1, location.Range.Start.Character+1))
	}
	var symbols func([]Symbol, int)
	symbols = func(items []Symbol, depth int) {
		for _, item := range items {
			where := item.URI
			if item.Range != nil {
				where = fmt.Sprintf("%s:%d:%d", item.URI, item.Range.Start.Line+1, item.Range.Start.Character+1)
			}
			appendLine(strings.Repeat("  ", min(depth, 16)) + item.Name + " — " + where)
			symbols(item.Children, depth+1)
		}
	}
	symbols(result.Symbols, 0)
	for _, call := range result.Calls {
		symbols([]Symbol{call.Item}, 0)
		for _, span := range call.Ranges {
			appendLine(fmt.Sprintf("  call site: %s:%d:%d", call.SiteURI, span.Start.Line+1, span.Start.Character+1))
		}
	}
	if len(lines) == 0 {
		lines = append(lines, "No results returned by the initialized language server for this query.")
	}
	text := strings.Join(lines, "\n")
	runes := []rune(text)
	if len(runes) > 16000 {
		text = string(runes[:15900])
		result.Truncated = true
	}
	if result.Truncated {
		text += "\n[Result truncated; narrow the source position or symbol query.]"
	}
	return text, result.Truncated
}
