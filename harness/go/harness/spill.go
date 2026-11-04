package harness

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	point "github.com/phodal/pero/harness/go/runtime"
)

type spillEntry struct {
	id      uint64
	scope   *point.Scope
	store   SpillStore
	options SpillPolicyOptions
}

type spillPolicyOverride struct {
	id             uint64
	maxInlineBytes *int
	active         bool
}

type SpillPolicySnapshot struct {
	Overridden     bool `json:"overridden"`
	Enabled        bool `json:"enabled"`
	MaxInlineBytes int  `json:"maxInlineBytes,omitempty"`
}

// SpillRegistry is the effect-owned, spatially scoped DSH tool-result spill
// policy. Storage errors preserve the original tool result.
type SpillRegistry struct {
	mu                   sync.RWMutex
	nextID               uint64
	entries              []spillEntry
	nextPolicyOverrideID uint64
	policyOverrides      []*spillPolicyOverride
	effectivePolicy      *int
	policyOverridden     bool
}

func NewSpillRegistry() *SpillRegistry { return &SpillRegistry{} }

func normalizeSpillPolicy(options SpillPolicyOptions) (SpillPolicyOptions, error) {
	if options.MaxInlineBytes == 0 {
		options.MaxInlineBytes = DefaultSpillMaxInlineBytes
	}
	if options.MaxInlineBytes < 0 {
		return SpillPolicyOptions{}, errors.New("spill-policy: max inline bytes must not be negative")
	}
	return options, nil
}

// OverridePolicy installs a root/profile policy layer. A disabled row or an
// omitted maxInlineBytes cap intentionally disables automatic projection while
// leaving direct SaveText/LookupText and scoped backend selection untouched.
func (r *SpillRegistry) OverridePolicy(config SpillPolicyConfig, enabled bool) (point.Dispose, error) {
	if r == nil {
		return nil, errors.New("spill-policy: registry is nil")
	}
	if enabled {
		if err := ValidateSpillPolicyConfig(config); err != nil {
			return nil, err
		}
	}
	var cap *int
	if enabled && config.MaxInlineBytes != nil {
		value := *config.MaxInlineBytes
		cap = &value
	}
	r.mu.Lock()
	r.nextPolicyOverrideID++
	override := &spillPolicyOverride{id: r.nextPolicyOverrideID, maxInlineBytes: cap, active: true}
	r.policyOverrides = append(r.policyOverrides, override)
	r.effectivePolicy = cap
	r.policyOverridden = true
	r.mu.Unlock()
	var once sync.Once
	return func(context.Context) error {
		once.Do(func() {
			r.mu.Lock()
			override.active = false
			for len(r.policyOverrides) > 0 && !r.policyOverrides[len(r.policyOverrides)-1].active {
				r.policyOverrides = r.policyOverrides[:len(r.policyOverrides)-1]
			}
			r.effectivePolicy = nil
			r.policyOverridden = false
			if len(r.policyOverrides) > 0 {
				r.effectivePolicy = r.policyOverrides[len(r.policyOverrides)-1].maxInlineBytes
				r.policyOverridden = true
			}
			r.mu.Unlock()
		})
		return nil
	}, nil
}

func (r *SpillRegistry) PolicySnapshot() SpillPolicySnapshot {
	if r == nil {
		return SpillPolicySnapshot{}
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	snapshot := SpillPolicySnapshot{Overridden: r.policyOverridden, Enabled: r.policyOverridden && r.effectivePolicy != nil}
	if r.effectivePolicy != nil {
		snapshot.MaxInlineBytes = *r.effectivePolicy
	}
	return snapshot
}

func (r *SpillRegistry) Register(run *point.Run, store SpillStore, options SpillPolicyOptions) (point.Dispose, error) {
	if r == nil || run == nil || !run.Active() || run.Scope == nil || store == nil {
		return nil, errors.New("spill: registration requires an active run, scope, and store")
	}
	options, err := normalizeSpillPolicy(options)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	for _, existing := range r.entries {
		if existing.scope == run.Scope {
			r.mu.RUnlock()
			return nil, errors.New("spill: backend already registered in this scope")
		}
	}
	r.mu.RUnlock()
	var lifecycle point.Dispose
	if managed, ok := store.(SpillStoreLifecycle); ok {
		lifecycle, err = managed.StartSpillLifecycle(run.Context)
		if err != nil {
			return nil, err
		}
	}
	r.mu.Lock()
	for _, existing := range r.entries {
		if existing.scope == run.Scope {
			r.mu.Unlock()
			if lifecycle != nil {
				_ = lifecycle(context.Background())
			}
			return nil, errors.New("spill: backend already registered in this scope")
		}
	}
	r.nextID++
	entry := spillEntry{id: r.nextID, scope: run.Scope, store: store, options: options}
	r.entries = append(r.entries, entry)
	r.mu.Unlock()
	var once sync.Once
	dispose := point.Dispose(func(context.Context) error {
		var lifecycleErr error
		once.Do(func() {
			r.mu.Lock()
			for index := range r.entries {
				if r.entries[index].id == entry.id {
					r.entries = append(r.entries[:index], r.entries[index+1:]...)
					break
				}
			}
			r.mu.Unlock()
			if lifecycle != nil {
				lifecycleErr = lifecycle(context.Background())
			}
		})
		return lifecycleErr
	})
	if err := run.Defer("spill:policy", dispose); err != nil {
		_ = dispose(context.Background())
		return nil, err
	}
	return dispose, nil
}

func (r *SpillRegistry) visible(scope *point.Scope) (spillEntry, bool, error) {
	if r == nil || scope == nil {
		return spillEntry{}, false, nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.visibleLocked(scope)
}

func (r *SpillRegistry) visibleLocked(scope *point.Scope) (spillEntry, bool, error) {
	var selected spillEntry
	found := false
	for _, entry := range r.entries {
		if !entry.scope.Contains(scope) {
			continue
		}
		switch {
		case !found:
			selected, found = entry, true
		case selected.scope == entry.scope:
			return spillEntry{}, false, errors.New("spill: duplicate backend in one scope")
		case selected.scope.Contains(entry.scope):
			selected = entry
		case entry.scope.Contains(selected.scope):
		default:
			return spillEntry{}, false, errors.New("spill: visible backends have incomparable scopes")
		}
	}
	return selected, found, nil
}

func (r *SpillRegistry) projection(scope *point.Scope) (spillEntry, bool, error) {
	if r == nil || scope == nil {
		return spillEntry{}, false, nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	entry, found, err := r.visibleLocked(scope)
	if err != nil || !found {
		return entry, found, err
	}
	if !r.policyOverridden {
		return entry, true, nil
	}
	if r.effectivePolicy == nil {
		return spillEntry{}, false, nil
	}
	entry.options.MaxInlineBytes = *r.effectivePolicy
	return entry, true, nil
}

func (r *SpillRegistry) LookupText(ctx context.Context, agent *Agent, locator string, maxBytes int) (SpillTextLookup, error) {
	if agent == nil || maxBytes <= 0 {
		return SpillTextLookup{}, errors.New("spill: lookup requires an agent and positive read limit")
	}
	entry, found, err := r.visible(agent.Scope())
	if err != nil || !found {
		return SpillTextLookup{}, err
	}
	reader, ok := entry.store.(SpillTextReader)
	if !ok {
		return SpillTextLookup{}, nil
	}
	return reader.LookupText(ctx, SpillOwner{SessionID: agent.ID()}, locator, maxBytes)
}

// SaveText lets a tool preserve its complete, tool-specific representation
// before returning a bounded inline page. It is the DSH search-tool spill seam;
// absence or an invalid backend response is reported as saved=false.
func (r *SpillRegistry) SaveText(ctx context.Context, agent *Agent, source SpillSource, suggestedName, content string) (SpillRef, bool, error) {
	if agent == nil || source.ToolName == "" || source.CallID == "" || suggestedName == "" {
		return SpillRef{}, false, errors.New("spill: direct save requires an agent, tool name, call id, and suggested name")
	}
	entry, found, err := r.visible(agent.Scope())
	if err != nil || !found {
		return SpillRef{}, false, err
	}
	ref, err := entry.store.SaveText(ctx, SaveTextSpill{
		Owner: SpillOwner{SessionID: agent.ID()}, Source: source,
		SuggestedName: suggestedName, Content: content,
	})
	if err != nil {
		return SpillRef{}, false, err
	}
	if ref.Locator == "" || ref.RetrievalHint == "" || ref.Bytes != int64(len(content)) {
		return SpillRef{}, false, nil
	}
	return ref, true, nil
}

func (r *SpillRegistry) Project(ctx context.Context, request ToolRequest, result ToolResult, nested bool) (ToolResult, error) {
	if nested {
		return result, nil
	}
	return r.project(ctx, request, result, "result", request.Name+".txt")
}

// InlineLimit reports the actual scoped projection limit, including profile
// overrides. Structured tools can fit a complete response before granting
// authority to refs, instead of granting refs later hidden in a spill.
func (r *SpillRegistry) InlineLimit(agent *Agent) (int, bool, error) {
	if agent == nil {
		return 0, false, nil
	}
	entry, enabled, err := r.projection(agent.Scope())
	return entry.options.MaxInlineBytes, enabled, err
}

// ProjectDispatch bounds only the durable tool/code-dispatch copy of a nested
// result. The caller's program value has already settled and remains whole.
func (r *SpillRegistry) ProjectDispatch(ctx context.Context, agent *Agent, toolName string, callID ToolCallID, content []ContentBlock) ([]ContentBlock, error) {
	if agent == nil || toolName == "" || callID == "" {
		return nil, errors.New("spill: dispatch projection requires an agent, tool name, and call id")
	}
	entry, found, err := r.projection(agent.Scope())
	if err != nil || !found {
		return content, err
	}
	text, ok := flattenToolText(content)
	if !ok || len(text) <= entry.options.MaxInlineBytes {
		return content, nil
	}
	ref, err := entry.store.SaveText(ctx, SaveTextSpill{
		Owner:         SpillOwner{SessionID: agent.ID()},
		Source:        SpillSource{ToolName: toolName, CallID: callID, Label: "dispatch"},
		SuggestedName: toolName + ".txt", Content: text,
	})
	if err != nil {
		if ctx != nil && ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return content, nil
	}
	if ref.Locator == "" || ref.RetrievalHint == "" || ref.Bytes != int64(len(text)) {
		return content, nil
	}
	worstNotice := spillNotice(len(text), ref)
	previewBudget := entry.options.MaxInlineBytes - len(worstNotice) - 2
	if previewBudget < 0 {
		previewBudget = 0
	}
	preview := utf8HeadTail(text, previewBudget)
	notice := spillNotice(len(text)-len(preview), ref)
	replacement := notice
	if preview != "" {
		replacement = preview + "\n\n" + notice
	}
	if len(replacement) > entry.options.MaxInlineBytes {
		return content, nil
	}
	return []ContentBlock{{Type: BlockText, Text: replacement}}, nil
}

// ProjectDispatchLog projects only the durable tool/code-dispatch copy of a
// nested PTC result. The caller must keep returning the original result to the
// program. Like DSH's tools/ptc-dispatch-log waterfall, all projection and
// storage failures are contained so logging can never fail or delay the tool
// call itself.
func (r *SpillRegistry) ProjectDispatchLog(ctx context.Context, request ToolRequest, result ToolResult) (ToolResult, bool) {
	projectedContent, err := r.ProjectDispatch(ctx, request.Agent, request.Name, request.CallID, result.Content)
	if err != nil {
		return result, false
	}
	projected := result
	projected.Content = projectedContent
	return projected, !sameContent(projectedContent, result.Content)
}

func (r *SpillRegistry) project(ctx context.Context, request ToolRequest, result ToolResult, label, suggestedName string) (ToolResult, error) {
	if request.Agent == nil || request.Name == "read" || request.Name == "read_file" {
		return result, nil
	}
	entry, found, err := r.projection(request.Agent.Scope())
	if err != nil || !found {
		return result, err
	}
	return projectToolResult(ctx, request, result, label, suggestedName, entry)
}

func projectToolResult(ctx context.Context, request ToolRequest, result ToolResult, label, suggestedName string, entry spillEntry) (ToolResult, error) {
	text, ok := flattenToolText(result.Content)
	if !ok || len(text) <= entry.options.MaxInlineBytes {
		return result, nil
	}
	ref, err := entry.store.SaveText(ctx, SaveTextSpill{
		Owner:         SpillOwner{SessionID: request.Agent.ID()},
		Source:        SpillSource{ToolName: request.Name, CallID: request.CallID, Label: label},
		SuggestedName: suggestedName, Content: text,
	})
	if err != nil {
		if ctx != nil && ctx.Err() != nil {
			return ToolResult{}, ctx.Err()
		}
		return result, nil
	}
	totalBytes := len(text)
	if ref.Locator == "" || ref.RetrievalHint == "" || ref.Bytes != int64(totalBytes) {
		return result, nil
	}
	worstNotice := spillNotice(totalBytes, ref)
	previewBudget := entry.options.MaxInlineBytes - len(worstNotice) - 2
	if previewBudget < 0 {
		previewBudget = 0
	}
	preview := utf8HeadTail(text, previewBudget)
	omitted := totalBytes - len(preview)
	notice := spillNotice(omitted, ref)
	replacement := notice
	if preview != "" {
		replacement = preview + "\n\n" + notice
	}
	if len(replacement) > entry.options.MaxInlineBytes {
		return result, nil
	}
	result.Content = []ContentBlock{{Type: BlockText, Text: replacement}}
	return result, nil
}

func sameContent(left, right []ContentBlock) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index].Type != right[index].Type || left[index].Text != right[index].Text || left[index].MIMEType != right[index].MIMEType ||
			left[index].Attachment != right[index].Attachment || string(left[index].Data) != string(right[index].Data) {
			return false
		}
	}
	return true
}

func flattenToolText(content []ContentBlock) (string, bool) {
	var result strings.Builder
	for _, block := range content {
		if block.Type != BlockText {
			return "", false
		}
		result.WriteString(block.Text)
	}
	return result.String(), true
}

func spillNotice(omitted int, ref SpillRef) string {
	return fmt.Sprintf("(Omitted %d bytes. Full formatted result stored at: %s. %s)", omitted, ref.Locator, ref.RetrievalHint)
}

func utf8HeadTail(text string, budget int) string {
	if budget <= 0 || text == "" || !utf8.ValidString(text) {
		return ""
	}
	data := []byte(text)
	if len(data) <= budget {
		return text
	}
	headBudget, tailBudget := (budget+1)/2, budget/2
	headEnd := 0
	for headEnd < len(data) {
		_, size := utf8.DecodeRune(data[headEnd:])
		if size == 0 || headEnd+size > headBudget {
			break
		}
		headEnd += size
	}
	tailStart := len(data)
	used := 0
	for tailStart > headEnd {
		_, size := utf8.DecodeLastRune(data[:tailStart])
		if size == 0 || used+size > tailBudget {
			break
		}
		tailStart -= size
		used += size
	}
	return string(data[:headEnd]) + string(data[tailStart:])
}
