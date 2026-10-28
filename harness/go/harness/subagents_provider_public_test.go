package harness

import (
	"context"
	"errors"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

type staticRouteSubagentProvider struct {
	retirementSubagentProvider
	route SubagentAgentRouteDefaults
}

func (p *staticRouteSubagentProvider) AgentRouteDefaults() *SubagentAgentRouteDefaults {
	return &p.route
}

func TestSubagentProviderRouteDescriptorsAreDetached(t *testing.T) {
	h := subagentTestHarness(t)
	p := &staticRouteSubagentProvider{route: SubagentAgentRouteDefaults{Provider: "static-provider", Model: "static-model"}}
	capacityRegister(t, h, p)
	rows := h.Subagents().ProviderDescriptors(h.Runtime().Root())
	var selected *SubagentProviderDescriptor
	for index := range rows {
		if rows[index].Name == p.Name() {
			selected = &rows[index]
		}
	}
	if selected == nil || selected.AgentRouteDefaults == nil || *selected.AgentRouteDefaults != p.route {
		t.Fatalf("route descriptors=%+v", rows)
	}
	selected.AgentRouteDefaults.Provider = "caller mutation"
	if p.route.Provider != "static-provider" {
		t.Fatal("descriptor acquired provider-owned storage")
	}
	next := h.Subagents().ProviderDescriptors(h.Runtime().Root())
	for _, row := range next {
		if row.Name == p.Name() && (row.AgentRouteDefaults == nil || row.AgentRouteDefaults.Provider != "static-provider") {
			t.Fatal("descriptor snapshots shared nested route storage")
		}
	}
}

type duplicatePublicProvider struct{ retirementSubagentProvider }

func (duplicatePublicProvider) Name() string { return "duplicate-public" }

func TestSubagentProviderCurrentErrorsPrecedePreparation(t *testing.T) {
	h := subagentTestHarness(t)
	parent := capacityParent(t, h, "provider-error-parent")
	ctx := activationTestContext(t)
	_, err := h.Subagents().StartActivation(ctx, "missing", SubagentRequest{Parent: parent, Prompt: "no resource"}, "caller")
	assertSubagentControlCode(t, err, "NO_PROVIDER")
	p := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		t.Error("unsupported input reached provider preparation")
		return SubagentProviderRun{}, errors.New("unexpected")
	}}
	capacityRegister(t, h, p)
	_, err = h.Subagents().StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "reserved", ChildID: "forbidden-external-reservation"}, "caller")
	assertSubagentControlCode(t, err, "UNSUPPORTED_CAPABILITY")
	var duplicate error
	q := duplicatePublicProvider{}
	definition := point.Define(point.Descriptor{ID: "test/duplicate-provider-public"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		off, err := h.Subagents().RegisterProvider(run, q)
		if err != nil {
			return nil, err
		}
		_, duplicate = h.Subagents().RegisterProvider(run, q)
		return off, nil
	})
	instance, err := h.Runtime().Mount(nil, "test/duplicate-provider-public", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer instance.Dispose(context.Background())
	if err = instance.WaitStable(ctx); err != nil {
		t.Fatal(err)
	}
	assertSubagentControlCode(t, duplicate, "DUPLICATE_PROVIDER")
}
