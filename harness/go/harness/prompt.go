package harness

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"

	point "github.com/phodal/pero/harness/go/runtime"
)

// PromptPresentation binds instructions and dynamic context from one assembly.
type PromptPresentation struct {
	System string
	// Guidance is rendered after request middleware and adapter preparation,
	// using the exact tools and model metadata admitted for this call.
	Guidance              func(context.Context, PromptCapabilities) (string, error)
	RuntimeContext        *RuntimeContextSnapshot
	RefreshRuntimeContext func(context.Context) (*RuntimeContextSnapshot, error)
	Release               func(context.Context) error
}

type PromptCapabilities struct {
	Tools []ToolSchema
	Model ModelInfo
}

func (c PromptCapabilities) HasTool(name string) bool {
	for _, tool := range c.Tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}

type PromptSection struct {
	ID    string
	Order int
	// Catalog sections share the model-facing catalog budget with tagged tool
	// descriptions; omission always names an available recovery operation.
	Catalog             bool
	CatalogContinuation string
	CatalogRecoveryTool string
	Content             func(context.Context, *Agent) (string, error)
	Guidance            func(context.Context, *Agent, PromptCapabilities) (string, error)
	// Presentation is an alternative to Content for providers of dynamic context.
	Presentation func(context.Context, *Agent) (PromptPresentation, error)
}

type promptEntry struct {
	id      uint64
	section PromptSection
	scope   *point.Scope
}

type PromptRegistry struct {
	mu      sync.RWMutex
	nextID  uint64
	entries []promptEntry
}

func NewPromptRegistry() *PromptRegistry { return &PromptRegistry{} }

func (r *PromptRegistry) Register(run *point.Run, section PromptSection) (point.Dispose, error) {
	if run == nil || !run.Active() {
		return nil, point.ErrInactiveRun
	}
	providers := 0
	if section.Content != nil {
		providers++
	}
	if section.Presentation != nil {
		providers++
	}
	if section.Guidance != nil {
		providers++
	}
	if section.ID == "" || providers != 1 {
		return nil, errors.New("harness: prompt section requires id and exactly one content provider")
	}
	r.mu.Lock()
	for _, entry := range r.entries {
		if entry.section.ID == section.ID {
			r.mu.Unlock()
			return nil, errors.New("harness: prompt section already registered: " + section.ID)
		}
	}
	r.nextID++
	entry := promptEntry{id: r.nextID, section: section, scope: run.Scope}
	r.entries = append(r.entries, entry)
	r.mu.Unlock()

	var once sync.Once
	dispose := point.Dispose(func(context.Context) error {
		once.Do(func() {
			r.mu.Lock()
			for index := range r.entries {
				if r.entries[index].id == entry.id {
					r.entries = append(r.entries[:index], r.entries[index+1:]...)
					break
				}
			}
			r.mu.Unlock()
		})
		return nil
	})
	if err := run.Defer("prompt:"+section.ID, dispose); err != nil {
		_ = dispose(context.Background())
		return nil, err
	}
	return dispose, nil
}

func (r *PromptRegistry) Assemble(ctx context.Context, agent *Agent) (string, error) {
	value, err := r.AssemblePresentation(ctx, agent)
	if err == nil && value.Guidance != nil {
		var tools []ToolSchema
		tools, err = agent.tools.SchemasForAgent(ctx, agent)
		if err == nil {
			var guidance string
			guidance, err = value.Guidance(ctx, PromptCapabilities{Tools: BoundToolCatalogs(tools)})
			value.System = strings.TrimSpace(value.System + "\n\n" + guidance)
		}
	}
	if value.Release != nil {
		err = errors.Join(err, value.Release(context.WithoutCancel(ctx)))
	}
	return value.System, err
}

func (r *PromptRegistry) AssemblePresentation(ctx context.Context, agent *Agent) (PromptPresentation, error) {
	r.mu.RLock()
	entries := append([]promptEntry(nil), r.entries...)
	r.mu.RUnlock()
	sort.SliceStable(entries, func(left, right int) bool {
		if entries[left].section.Order != entries[right].section.Order {
			return entries[left].section.Order < entries[right].section.Order
		}
		return entries[left].id < entries[right].id
	})
	sections := make([]string, 0, len(entries))
	var runtime *RuntimeContextSnapshot
	var runtimeTexts []string
	var providers []PromptPresentation
	var guidanceSections []PromptSection
	release := func(ctx context.Context) error {
		var errs []error
		for _, p := range providers {
			if p.Release != nil {
				errs = append(errs, p.Release(ctx))
			}
		}
		return errors.Join(errs...)
	}
	for _, entry := range entries {
		if !entry.scope.Contains(agent.Scope()) {
			continue
		}
		var content string
		var err error
		if entry.section.Guidance != nil {
			guidanceSections = append(guidanceSections, entry.section)
			continue
		} else if entry.section.Presentation != nil {
			var value PromptPresentation
			value, err = entry.section.Presentation(ctx, agent)
			providers = append(providers, value)
			content = value.System
			if value.RuntimeContext != nil {
				if runtime == nil {
					runtime = &RuntimeContextSnapshot{}
				}
				runtime.Sections = append(runtime.Sections, value.RuntimeContext.Sections...)
				if value.RuntimeContext.Text != "" {
					runtimeTexts = append(runtimeTexts, value.RuntimeContext.Text)
				}
			}
		} else {
			content, err = entry.section.Content(ctx, agent)
		}
		if err != nil {
			return PromptPresentation{}, errors.Join(err, release(context.WithoutCancel(ctx)))
		}
		if content = strings.TrimSpace(content); content != "" {
			sections = append(sections, content)
		}
	}
	if runtime != nil {
		runtime.Text = strings.Join(runtimeTexts, "\n\n")
	}
	value := PromptPresentation{System: strings.Join(sections, "\n\n"), RuntimeContext: runtime, Release: release}
	if len(guidanceSections) > 0 {
		value.Guidance = func(ctx context.Context, capabilities PromptCapabilities) (string, error) {
			var parts []string
			budget := CatalogBudget{Remaining: DefaultCatalogBytes}
			for _, tool := range capabilities.Tools {
				if tool.Catalog != nil {
					budget.Remaining -= len(tool.Description)
				}
			}
			for _, section := range guidanceSections {
				// Contributions receive values, never mutable request slices.
				captured := PromptCapabilities{Model: cloneModelInfo(capabilities.Model)}
				for _, schema := range capabilities.Tools {
					captured.Tools = append(captured.Tools, cloneToolSchema(schema))
				}
				text, err := section.Guidance(ctx, agent, captured)
				if err != nil {
					return "", err
				}
				if text = strings.TrimSpace(text); text != "" {
					if section.Catalog {
						if len(parts) > 0 {
							budget.Remaining -= 2
						}
						continuation := section.CatalogContinuation
						if section.CatalogRecoveryTool != "" && !capabilities.HasTool(section.CatalogRecoveryTool) {
							continuation = "Additional entries are omitted from this request."
						}
						text = budget.Render(CatalogText{Rows: []string{text}, Continuation: continuation})
					}
					parts = append(parts, text)
				}
			}
			return strings.Join(parts, "\n\n"), nil
		}
	}
	for _, provider := range providers {
		if provider.RefreshRuntimeContext != nil {
			value.RefreshRuntimeContext = func(ctx context.Context) (*RuntimeContextSnapshot, error) {
				var result *RuntimeContextSnapshot
				var texts []string
				for _, p := range providers {
					current := p.RuntimeContext
					if p.RefreshRuntimeContext != nil {
						var err error
						current, err = p.RefreshRuntimeContext(ctx)
						if err != nil {
							return nil, err
						}
					}
					if current != nil {
						if result == nil {
							result = &RuntimeContextSnapshot{}
						}
						result.Sections = append(result.Sections, current.Sections...)
						if current.Text != "" {
							texts = append(texts, current.Text)
						}
					}
				}
				if result != nil {
					result.Text = strings.Join(texts, "\n\n")
				}
				return result, nil
			}
			break
		}
	}
	return value, nil
}
