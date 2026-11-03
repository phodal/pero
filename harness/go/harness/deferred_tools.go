package harness

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	point "github.com/phodal/pero/harness/go/runtime"
)

const deferredToolsEvent = "tools/deferred-activation"

// DeferredTools presents an initially small tool view over the existing
// registry. Discovery is durable session data; it never grants capability.
// Current authorization, schema and registration identity are rechecked on
// declaration and dispatch. Sessions reconstructed in a new process retain
// discovery only for byte-identical schemas that are still authorized.
type DeferredTools struct {
	base  ToolCatalogBase
	epoch string
	eager map[string]bool
}

type deferredToolVersion struct {
	Name         string `json:"name"`
	Digest       string `json:"schema_sha256"`
	Registration uint64 `json:"registration"`
	Catalog      uint64 `json:"catalog,omitempty"`
}

type deferredToolActivation struct {
	Session SessionID             `json:"session"`
	Epoch   string                `json:"epoch"`
	Reset   bool                  `json:"reset,omitempty"`
	Tools   []deferredToolVersion `json:"tools"`
}

// RegisterDeferredTools requires an exclusive presenter. In particular, PTC
// composition must be implemented explicitly instead of bypassing its view.
// Eager names normally contain just the tool-search entry point.
func (r *ToolRegistry) RegisterDeferredTools(run *point.Run, generation string, eager ...string) (*DeferredTools, point.Dispose, error) {
	if len(eager) == 0 {
		return nil, nil, errors.New("harness: deferred tools require an eager discovery tool")
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return nil, nil, err
	}
	r.mu.Lock()
	if r.deferredEpoch == "" {
		r.deferredEpoch = hex.EncodeToString(nonce[:])
	}
	epoch := r.deferredEpoch
	r.mu.Unlock()
	view := &DeferredTools{epoch: epoch, eager: make(map[string]bool, len(eager))}
	for _, name := range eager {
		if name == "" {
			return nil, nil, errors.New("harness: deferred eager tool name is empty")
		}
		view.eager[name] = true
	}
	dispose, err := r.RegisterCatalogProvider(run, generation, ToolCatalogProvider{
		Authoritative: true, Exclusive: true, deferred: view,
		Bind:    func(base ToolCatalogBase) { view.base = base },
		Schemas: view.schemas, Resolve: view.resolve, PrepareFinalContent: view.prepareFinalContent,
	})
	if err != nil {
		return nil, nil, err
	}
	return view, dispose, nil
}

// Candidates is the complete current caller-authorized pool, before deferred
// presentation. It is intentionally available only to the discovery owner.
func (d *DeferredTools) Candidates(ctx context.Context, agent *Agent) ([]ToolSchema, error) {
	return d.base.Schemas(ctx, agent)
}

// ToolSchemaDigest identifies the canonical declaration and trusted output
// contract. Runtime catalog text metadata is excluded.
func ToolSchemaDigest(schema ToolSchema) string {
	raw, _ := json.Marshal(struct {
		Declaration      ToolSchema      `json:"declaration"`
		OutputSchema     json.RawMessage `json:"output_schema,omitempty"`
		OutputProjection string          `json:"output_projection,omitempty"`
		OutputConfig     json.RawMessage `json:"output_config,omitempty"`
	}{schema, schema.OutputSchema, schema.OutputProjection, schema.OutputProjectionConfig})
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

// Activate records exactly the returned search definitions. A concurrent
// replacement fails discovery rather than activating a different contract.
func (d *DeferredTools) Activate(ctx context.Context, agent *Agent, schemas []ToolSchema) error {
	if agent == nil {
		return errors.New("harness: deferred discovery requires an agent")
	}
	if _, err := d.load(ctx, agent); err != nil {
		return err
	}
	fact := deferredToolActivation{Session: agent.ID(), Epoch: d.epoch}
	for _, schema := range schemas {
		tool, found, err := d.base.Resolve(ctx, agent, schema.Name)
		if err != nil {
			return err
		}
		if !found || ToolSchemaDigest(tool.Schema) != ToolSchemaDigest(schema) {
			return fmt.Errorf("harness: tool %q changed during discovery; search again", schema.Name)
		}
		fact.Tools = append(fact.Tools, deferredToolVersion{
			Name: schema.Name, Digest: ToolSchemaDigest(schema), Registration: tool.registrationID, Catalog: tool.catalogID,
		})
	}
	if len(fact.Tools) == 0 {
		return nil
	}
	if _, err := agent.Session().Append(deferredToolsEvent, fact); err != nil {
		return err
	}
	return agent.Session().Flush(ctx)
}

type deferredToolState struct {
	Epoch string
	Tools map[string]deferredToolVersion
}

func deferredActivations(events []Event, session SessionID) (deferredToolState, error) {
	state := deferredToolState{Tools: make(map[string]deferredToolVersion)}
	for _, event := range events {
		if event.Type != deferredToolsEvent {
			continue
		}
		var fact deferredToolActivation
		if err := json.Unmarshal(event.Data, &fact); err != nil {
			return state, fmt.Errorf("harness: invalid deferred discovery at event %d: %w", event.Seq, err)
		}
		if fact.Session != session {
			continue // Fork seeds do not convey a parent's discovery to the child.
		}
		if fact.Epoch == "" || len(fact.Tools) == 0 && !fact.Reset || state.Epoch != "" && fact.Epoch != state.Epoch && !fact.Reset {
			return state, errors.New("harness: incomplete deferred discovery fact")
		}
		if fact.Reset {
			clear(state.Tools)
		}
		state.Epoch = fact.Epoch
		for _, tool := range fact.Tools {
			if tool.Name == "" || len(tool.Digest) != 64 || tool.Registration == 0 && tool.Catalog == 0 {
				return state, errors.New("harness: invalid deferred tool version")
			}
			state.Tools[tool.Name] = tool
		}
	}
	return state, nil
}

// load reconstructs discovery from the unabridged session log. On a new
// runtime, one durable checkpoint rebinds byte-identical, still-authorized
// schemas to current registration IDs. Subsequent reloads in that runtime
// cannot revive an old activation. CAS preserves simultaneous discovery.
func (d *DeferredTools) load(ctx context.Context, agent *Agent) (deferredToolState, error) {
	for {
		if err := ctx.Err(); err != nil {
			return deferredToolState{}, err
		}
		events := agent.Session().Events()
		state, err := deferredActivations(events, agent.ID())
		if err != nil || state.Epoch == "" {
			return state, err
		}
		if state.Epoch == d.epoch {
			return state, agent.Session().Flush(ctx)
		}
		fact := deferredToolActivation{Session: agent.ID(), Epoch: d.epoch, Reset: true}
		for name, version := range state.Tools {
			tool, found, err := d.base.Resolve(ctx, agent, name)
			if err != nil {
				return state, err
			}
			if found && ToolSchemaDigest(tool.Schema) == version.Digest {
				version.Registration, version.Catalog = tool.registrationID, tool.catalogID
				fact.Tools = append(fact.Tools, version)
			}
		}
		lastSeq := uint64(0)
		if len(events) > 0 {
			lastSeq = events[len(events)-1].Seq
		}
		if _, err = agent.Session().AppendIfLastSeq(lastSeq, deferredToolsEvent, fact); errors.Is(err, ErrSessionChanged) {
			continue
		}
		if err != nil {
			return state, err
		}
		if err := agent.Session().Flush(ctx); err != nil {
			return state, err
		}
	}
}

func (d *DeferredTools) admitted(tool Tool, state deferredToolState) bool {
	if d.eager[tool.Schema.Name] {
		return true
	}
	version, found := state.Tools[tool.Schema.Name]
	return found && version.Digest == ToolSchemaDigest(tool.Schema) && version.Registration == tool.registrationID && version.Catalog == tool.catalogID
}

func (d *DeferredTools) schemas(ctx context.Context, agent *Agent) ([]ToolSchema, error) {
	candidates, err := d.Candidates(ctx, agent)
	if err != nil {
		return nil, err
	}
	active, err := d.load(ctx, agent)
	if err != nil {
		return nil, err
	}
	result := make([]ToolSchema, 0, len(candidates))
	for _, schema := range candidates {
		if _, found := active.Tools[schema.Name]; !d.eager[schema.Name] && !found {
			continue
		}
		tool, found, err := d.base.Resolve(ctx, agent, schema.Name)
		if err != nil {
			return nil, err
		}
		if found && ToolSchemaDigest(tool.Schema) == ToolSchemaDigest(schema) && d.admitted(tool, active) {
			result = append(result, schema)
		}
	}
	return result, nil
}

func (d *DeferredTools) resolve(ctx context.Context, agent *Agent, name string) (Tool, bool, error) {
	active, err := d.load(ctx, agent)
	if err != nil {
		return Tool{}, false, err
	}
	if _, found := active.Tools[name]; !d.eager[name] && !found {
		return Tool{}, false, nil
	}
	tool, found, err := d.base.Resolve(ctx, agent, name)
	if err != nil || !found {
		return tool, found, err
	}
	if !d.admitted(tool, active) {
		return Tool{}, false, nil
	}
	declared, err := deferredToolDeclared(agent.Session(), tool.Schema)
	return tool, declared, err
}

func deferredToolDeclared(session *Session, current ToolSchema) (bool, error) {
	header, found, err := session.RequestHeader()
	if err != nil {
		return false, err
	}
	if found {
		declared := false
		for _, schema := range header.Tools {
			// Catalog descriptions are bounded at the final request boundary.
			// Declaration membership and executable contracts stay exact.
			schema.Description, current.Description = "", ""
			schema.DeferLoading, current.DeferLoading = false, false
			expectedJSON, _ := json.Marshal(schema)
			currentJSON, _ := json.Marshal(current)
			declared = declared || string(expectedJSON) == string(currentJSON)
		}
		return declared, nil
	}
	return true, nil
}

func (d *DeferredTools) prepareFinalContent(ctx context.Context, agent *Agent, name string) (Tool, bool, error) {
	active, err := d.load(ctx, agent)
	if err != nil {
		return Tool{}, false, err
	}
	if _, found := active.Tools[name]; !d.eager[name] && !found {
		return Tool{}, false, nil
	}
	// Preserve the base's narrow opt-in preparation. A false result must not
	// resolve a legacy definition before its ordinary dispatch path.
	tool, prepared, err := d.base.registry.prepareFinalContentView(ctx, agent, name, d.base.scope, d.base.generation, true)
	if err != nil || !prepared {
		return tool, prepared, err
	}
	declared, err := deferredToolDeclared(agent.Session(), tool.Schema)
	if err != nil {
		return Tool{}, false, err
	}
	if !d.admitted(tool, active) || !declared {
		return Tool{}, false, errors.New("harness: native tool is undiscovered or absent from the current request")
	}
	return tool, true, nil
}

// boundDeferredRequest runs after request middleware and adapter preparation.
// Only the final declared subset survives; middleware cannot reintroduce an
// undiscovered, withdrawn or denied definition. Canonical current contracts
// replace stale copies. Tool-history presenters are explicitly incompatible.
func (r *ToolRegistry) boundDeferredRequest(ctx context.Context, agent *Agent, request []ToolSchema, prepared PreparedAdapterCall) ([]ToolSchema, error) {
	if !r.deferredForAgent(agent) {
		return request, nil
	}
	if prepared.ProjectsToolHistory || prepared.ModelInfo.ToolUpdate != "" {
		return nil, errors.New("harness: deferred tools require immediate tool declarations; tool-history presentation is incompatible")
	}
	current, err := r.SchemasForAgent(ctx, agent)
	if err != nil {
		return nil, err
	}
	allowed := make(map[string]ToolSchema, len(current))
	for _, schema := range current {
		allowed[schema.Name] = schema
	}
	result := make([]ToolSchema, 0, len(request))
	for _, schema := range request {
		if canonical, found := allowed[schema.Name]; found {
			result = append(result, canonical)
			delete(allowed, schema.Name)
		}
	}
	return result, nil
}

func (r *ToolRegistry) deferredForAgent(agent *Agent) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	enabled := false
	for _, catalog := range r.catalogs {
		enabled = enabled || catalog.provider.deferred != nil && catalog.scope.Contains(agent.Scope())
	}
	return enabled
}
