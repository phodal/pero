package harness

import "context"

// ToolRegistration identifies one native definition, including when the exact
// definition is presented through a trusted authoritative Host proxy. Its fields
// are private; names, schemas and wire IDs cannot manufacture this identity.
type ToolRegistration struct {
	registry *ToolRegistry
	owner    *toolOwner
	name     string
}

// Visible resolves the Agent's actual executable catalog, including restrictions
// and scoped shadows. It invokes catalog providers outside registry locks and
// never falls back to same-name or same-schema equivalence.
func (r ToolRegistration) Visible(ctx context.Context, agent *Agent) (bool, error) {
	return r.available(ctx, agent, false)
}

// Available checks this exact authorized registration before deferred discovery.
// It does not activate or declare the tool, or bypass another presenter.
func (r ToolRegistration) Available(ctx context.Context, agent *Agent) (bool, error) {
	return r.available(ctx, agent, true)
}

func (r ToolRegistration) available(ctx context.Context, agent *Agent, beforeDiscovery bool) (bool, error) {
	if r.registry == nil || r.owner == nil || agent == nil || agent.retired.Load() || r.owner.admissionError() != nil {
		return false, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	resolve := r.registry.resolveForAgent
	if deferred := r.registry.deferredViewForAgent(agent); beforeDiscovery && deferred != nil {
		resolve = deferred.base.Resolve
	}
	tool, found, err := resolve(ctx, agent, r.name)
	if err != nil || !found {
		return false, err
	}
	// Catalog resolution may reenter Agent retirement or cancel this request.
	// Its returned owner identity alone cannot publish stale visibility.
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if agent.retired.Load() || tool.owner != r.owner || (tool.capturedAgent != nil && tool.capturedAgent != agent) || r.owner.admissionError() != nil {
		return false, nil
	}
	return tool.profileLease == nil || tool.profileLease.Active(), nil
}
