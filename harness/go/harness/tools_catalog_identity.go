package harness

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"

	point "github.com/phodal/pero/harness/go/runtime"
)

type toolCatalogIdentityKey struct {
	scope      *point.Scope
	generation string
}

// Identity is allocated before Bind but is not admission authority. Only new
// source presentation preparation consults its published/live owner fence;
// ordinary catalog selection and captured pure receipts keep their contracts.
type toolCatalogIdentity struct {
	id            uint64
	run           *point.Run
	authoritative bool
	exclusive     bool
	published     atomic.Bool
	sealed        atomic.Bool
}

func (identity *toolCatalogIdentity) active() bool {
	return identity != nil && identity.published.Load() && !identity.sealed.Load() && identity.run != nil && identity.run.Active() && identity.run.Context.Err() == nil
}

func (r *ToolRegistry) registerCatalogWithIdentity(run *point.Run, generation string, provider ToolCatalogProvider) (point.Dispose, error) {
	if run == nil || !run.Active() {
		return nil, point.ErrInactiveRun
	}
	if generation == "" || provider.Schemas == nil || provider.Resolve == nil {
		return nil, errors.New("harness: tool catalog provider requires generation, schemas, and resolver")
	}
	key := toolCatalogIdentityKey{scope: run.Scope, generation: generation}
	r.mu.Lock()
	if r.closed.Load() {
		r.mu.Unlock()
		return nil, ErrToolOwnerRetired
	}
	for _, existing := range r.catalogs {
		if provider.Authoritative && existing.provider.Authoritative && (provider.Exclusive || existing.provider.Exclusive) &&
			(run.Scope.Contains(existing.scope) || existing.scope.Contains(run.Scope)) {
			r.mu.Unlock()
			return nil, fmt.Errorf("harness: exclusive authoritative tool catalog %q cannot compose with %q", generation, existing.generation)
		}
		if existing.scope == run.Scope && existing.generation == generation {
			r.mu.Unlock()
			return nil, fmt.Errorf("harness: tool catalog generation %q already registered in this scope", generation)
		}
	}
	for pendingKey, existing := range r.catalogPending {
		if provider.Authoritative && existing.authoritative && (provider.Exclusive || existing.exclusive) &&
			(run.Scope.Contains(pendingKey.scope) || pendingKey.scope.Contains(run.Scope)) {
			r.mu.Unlock()
			return nil, fmt.Errorf("harness: exclusive authoritative tool catalog %q cannot compose with binding catalog %q", generation, pendingKey.generation)
		}
	}
	if r.catalogPending[key] != nil {
		r.mu.Unlock()
		return nil, fmt.Errorf("harness: tool catalog generation %q is already binding in this scope", generation)
	}
	r.nextID++
	identity := &toolCatalogIdentity{id: r.nextID, run: run, authoritative: provider.Authoritative, exclusive: provider.Exclusive}
	if r.catalogPending == nil {
		r.catalogPending = make(map[toolCatalogIdentityKey]*toolCatalogIdentity)
	}
	r.catalogPending[key] = identity
	r.mu.Unlock()
	var once sync.Once
	dispose := point.Dispose(func(context.Context) error {
		once.Do(func() {
			identity.sealed.Store(true)
			r.mu.Lock()
			defer r.mu.Unlock()
			if r.catalogPending[key] == identity {
				delete(r.catalogPending, key)
			}
			for index := range r.catalogs {
				if r.catalogs[index].id == identity.id {
					r.catalogs = append(r.catalogs[:index], r.catalogs[index+1:]...)
					break
				}
			}
		})
		return nil
	})
	if err := run.Defer("tool-catalog:"+generation, dispose); err != nil {
		_ = dispose(context.Background())
		return nil, err
	}
	base := ToolCatalogBase{registry: r, scope: run.Scope, generation: generation, catalogIdentity: identity}
	if err := callToolCatalogBind(provider.Bind, base); err != nil {
		_ = dispose(context.Background())
		return nil, err
	}
	r.mu.Lock()
	if identity.sealed.Load() || !run.Active() || run.Context.Err() != nil || r.closed.Load() {
		r.mu.Unlock()
		_ = dispose(context.Background())
		return nil, point.ErrInactiveRun
	}
	delete(r.catalogPending, key)
	r.catalogs = append(r.catalogs, toolCatalogEntry{id: identity.id, provider: provider, scope: run.Scope, generation: generation})
	identity.published.Store(true)
	r.mu.Unlock()
	return dispose, nil
}
func callToolCatalogBind(bind func(ToolCatalogBase), base ToolCatalogBase) (err error) {
	if bind == nil {
		return nil
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("harness: tool catalog Bind panicked: %v", recovered)
		}
	}()
	bind(base)
	return nil
}
