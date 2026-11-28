package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
)

type EntrySpec struct {
	ID         string          `json:"id"`
	Definition string          `json:"definition"`
	Config     json.RawMessage `json:"config,omitempty"`
	Enabled    *bool           `json:"enabled,omitempty"`
	Scope      *Scope          `json:"-"`
}

func (e EntrySpec) IsEnabled() bool { return e.Enabled == nil || *e.Enabled }

type ApplicationDocument struct {
	Entries []EntrySpec `json:"entries"`
}

func DecodeApplicationJSON(data []byte) (ApplicationDocument, error) {
	document, err := DecodeJSON[ApplicationDocument](data)
	if err != nil {
		return ApplicationDocument{}, fmt.Errorf("%w: %v", ErrInvalidApplication, err)
	}
	return document, nil
}

type managedEntry struct {
	spec     EntrySpec
	config   []byte
	instance *Instance
}

type EntrySnapshot struct {
	ID         string
	Definition string
	Enabled    bool
	Instance   *InstanceSnapshot
}

// Application reconciles a strict entry document into one Runtime. Apply is
// serialized; definitions and every config are validated before mutations.
type Application struct {
	runtime *Runtime
	catalog *DefinitionCatalog
	mu      sync.Mutex
	entries map[string]*managedEntry
}

func NewApplication(runtime *Runtime, catalog *DefinitionCatalog) *Application {
	if runtime == nil {
		runtime = New()
	}
	if catalog == nil {
		catalog = NewDefinitionCatalog()
	}
	return &Application{runtime: runtime, catalog: catalog, entries: make(map[string]*managedEntry)}
}

func (a *Application) Runtime() *Runtime           { return a.runtime }
func (a *Application) Catalog() *DefinitionCatalog { return a.catalog }

func (a *Application) ApplyJSON(ctx context.Context, data []byte) error {
	document, err := DecodeApplicationJSON(data)
	if err != nil {
		return err
	}
	return a.Apply(ctx, document.Entries)
}

func (a *Application) Apply(ctx context.Context, specs []EntrySpec) error {
	if a == nil || a.runtime == nil || a.catalog == nil {
		return errors.New("runtime: application is not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	desired, err := a.preflight(specs)
	if err != nil {
		return err
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	ids := make([]string, 0, len(a.entries))
	for id := range a.entries {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		current := a.entries[id]
		next, exists := desired[id]
		scopeChanged := exists && effectiveScope(a.runtime, current.spec.Scope) != effectiveScope(a.runtime, next.spec.Scope)
		mustStop := !exists || !next.spec.IsEnabled() || current.spec.Definition != next.spec.Definition || scopeChanged
		if current.instance != nil && mustStop {
			if err := current.instance.Dispose(ctx); err != nil {
				// Includes context.Canceled after a dispose that already finished.
				// Stop this pass; do not start the entry again.
				return fmt.Errorf("runtime: dispose entry %q: %w", id, err)
			}
			current.instance = nil
		}
		if !exists {
			delete(a.entries, id)
			continue
		}
		if current.spec.Definition != next.spec.Definition || scopeChanged {
			current.spec = next.spec
			current.config = next.config
		}
	}

	ids = ids[:0]
	for id := range desired {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		next := desired[id]
		current := a.entries[id]
		if current == nil {
			current = &managedEntry{spec: next.spec, config: next.config}
			a.entries[id] = current
		}
		if !next.spec.IsEnabled() {
			current.spec, current.config = next.spec, next.config
			continue
		}
		if current.instance == nil {
			definition, _ := a.catalog.Lookup(next.spec.Definition)
			scope := next.spec.Scope
			if scope == nil {
				scope = a.runtime.Root()
			}
			instance, err := a.runtime.Mount(scope, id, definition, next.config)
			if err != nil {
				return fmt.Errorf("runtime: mount entry %q: %w", id, err)
			}
			current.instance = instance
		} else if !bytes.Equal(current.config, next.config) {
			if err := current.instance.Update(ctx, next.config); err != nil {
				return fmt.Errorf("runtime: update entry %q: %w", id, err)
			}
		}
		current.spec, current.config = next.spec, next.config
	}

	return a.waitStableSet(ctx, ids)
}

func (a *Application) waitStableSet(ctx context.Context, ids []string) error {
	for {
		for _, id := range ids {
			if instance := a.entries[id].instance; instance != nil {
				if err := instance.WaitStable(ctx); err != nil {
					return fmt.Errorf("runtime: wait entry %q: %w", id, err)
				}
				if snapshot := instance.Snapshot(); snapshot.State == Failed {
					if failure := instance.LastError(); failure != nil {
						return fmt.Errorf("runtime: entry %q failed: %w", id, failure)
					}
					return fmt.Errorf("runtime: entry %q failed: %s", id, snapshot.LastError)
				}
			}
		}
		settled := true
		for _, id := range ids {
			instance := a.entries[id].instance
			if instance == nil {
				continue
			}
			snapshot := instance.Snapshot()
			if !snapshot.Stable || snapshot.dependencyEpoch != instance.dependencyEpoch.Load() {
				settled = false
				break
			}
		}
		if settled {
			return nil
		}
	}
}

func (a *Application) preflight(specs []EntrySpec) (map[string]*managedEntry, error) {
	desired := make(map[string]*managedEntry, len(specs))
	for index, spec := range specs {
		if spec.ID == "" || spec.Definition == "" {
			return nil, fmt.Errorf("%w: entry %d requires id and definition", ErrInvalidApplication, index)
		}
		if _, exists := desired[spec.ID]; exists {
			return nil, fmt.Errorf("%w: duplicate entry ID %q", ErrInvalidApplication, spec.ID)
		}
		definition, ok := a.catalog.Lookup(spec.Definition)
		if !ok {
			return nil, fmt.Errorf("%w: %q", ErrUnknownDefinition, spec.Definition)
		}
		if spec.Scope != nil && spec.Scope.runtime != a.runtime {
			return nil, fmt.Errorf("%w: entry %q scope belongs to another runtime", ErrInvalidApplication, spec.ID)
		}
		config, err := normalizeJSON(spec.Config)
		if err != nil {
			return nil, fmt.Errorf("%w: entry %q config: %v", ErrInvalidApplication, spec.ID, err)
		}
		if _, err := definition.decode(config); err != nil {
			return nil, fmt.Errorf("%w: entry %q config for %q: %v", ErrInvalidApplication, spec.ID, spec.Definition, err)
		}
		spec.Config = append(json.RawMessage(nil), config...)
		desired[spec.ID] = &managedEntry{spec: spec, config: config}
	}
	return desired, nil
}

func effectiveScope(runtime *Runtime, scope *Scope) *Scope {
	if scope == nil {
		return runtime.Root()
	}
	return scope
}

func normalizeJSON(raw json.RawMessage) ([]byte, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return []byte("{}"), nil
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return nil, err
	}
	return compact.Bytes(), nil
}

func (a *Application) Snapshot() []EntrySnapshot {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	result := make([]EntrySnapshot, 0, len(a.entries))
	for _, entry := range a.entries {
		snapshot := EntrySnapshot{ID: entry.spec.ID, Definition: entry.spec.Definition, Enabled: entry.spec.IsEnabled()}
		if entry.instance != nil {
			instance := entry.instance.Snapshot()
			snapshot.Instance = &instance
		}
		result = append(result, snapshot)
	}
	a.mu.Unlock()
	sort.Slice(result, func(left, right int) bool { return result[left].ID < result[right].ID })
	return result
}

func (a *Application) Dispose(ctx context.Context) error {
	if a == nil || a.runtime == nil {
		return nil
	}
	return a.runtime.Dispose(ctx)
}
