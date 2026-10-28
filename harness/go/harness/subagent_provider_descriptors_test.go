package harness

import (
	"context"
	"errors"
	"sync"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

type descriptorTestAdapter struct{}

func (descriptorTestAdapter) Generate(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
	return Completion{}, errors.New("descriptor test adapter must not be called")
}

type descriptorTestProvider struct {
	name        string
	capability  SubagentCapabilities
	inherits    bool
	continuable bool
}

func (p descriptorTestProvider) Name() string                       { return p.name }
func (p descriptorTestProvider) Capabilities() SubagentCapabilities { return p.capability }
func (p descriptorTestProvider) InheritsParentContext() bool        { return p.inherits }
func (p descriptorTestProvider) Prepare(context.Context, SubagentRequest) (SubagentProviderRun, error) {
	return SubagentProviderRun{}, errors.New("descriptor test provider must not start")
}

type descriptorTestContinuableProvider struct{ descriptorTestProvider }

func (p descriptorTestContinuableProvider) PrepareContinuable(context.Context, SubagentRequest) (SubagentContinuationProviderRun, error) {
	return SubagentContinuationProviderRun{}, errors.New("descriptor test provider must not start")
}

func mountDescriptorTestProvider(t *testing.T, h *Harness, scope *point.Scope, entryID string, provider SubagentProvider) *point.Instance {
	t.Helper()
	definition := point.Define(
		point.Descriptor{ID: entryID, Requires: []point.Requirement{point.Require(SubagentRegistryKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			registry, err := point.Resolve(run, SubagentRegistryKey)
			if err != nil {
				return nil, err
			}
			_, err = registry.RegisterProvider(run, provider)
			return nil, err
		},
	)
	instance, err := h.Runtime().Mount(scope, entryID, definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := instance.WaitStable(context.Background()); err != nil {
		t.Fatal(err)
	}
	return instance
}

func TestSubagentProviderDescriptorsTrackScopedTopology(t *testing.T) {
	ctx := context.Background()
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: descriptorTestAdapter{}})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(ctx)

	childScope := h.Runtime().Root().Child()
	var mu sync.Mutex
	var snapshots [][]SubagentProviderDescriptor
	unwatch := h.Subagents().WatchProviderDescriptors(childScope, func(value []SubagentProviderDescriptor) {
		mu.Lock()
		snapshots = append(snapshots, append([]SubagentProviderDescriptor(nil), value...))
		mu.Unlock()
	})

	rootAlpha := mountDescriptorTestProvider(t, h, nil, "test/subagent-descriptor-root-alpha", descriptorTestProvider{
		name: "alpha", capability: SubagentCapabilities{AgentOptions: true},
	})
	defer rootAlpha.Dispose(ctx)
	rootBeta := mountDescriptorTestProvider(t, h, nil, "test/subagent-descriptor-root-beta", descriptorTestContinuableProvider{
		descriptorTestProvider: descriptorTestProvider{name: "beta", inherits: true},
	})
	defer rootBeta.Dispose(ctx)
	childAlpha := mountDescriptorTestProvider(t, h, childScope, "test/subagent-descriptor-child-alpha", descriptorTestProvider{
		name: "alpha", capability: SubagentCapabilities{Persona: true}, inherits: true,
	})

	visible := h.Subagents().ProviderDescriptors(childScope)
	if len(visible) != 2 || visible[0].Name != "alpha" || !visible[0].Capabilities.Persona ||
		!visible[0].InheritsParentContext || visible[0].Continuable || visible[1].Name != "beta" ||
		!visible[1].InheritsParentContext || !visible[1].Continuable {
		t.Fatalf("scoped descriptors=%+v", visible)
	}
	if err := childAlpha.Dispose(ctx); err != nil {
		t.Fatal(err)
	}
	visible = h.Subagents().ProviderDescriptors(childScope)
	if len(visible) != 2 || !visible[0].Capabilities.AgentOptions || visible[0].Capabilities.Persona ||
		visible[0].InheritsParentContext {
		t.Fatalf("ancestor descriptor was not restored after scoped disposal: %+v", visible)
	}

	mu.Lock()
	count := len(snapshots)
	mu.Unlock()
	if count != 5 {
		t.Fatalf("watch snapshots=%d, want initial plus four topology changes: %+v", count, snapshots)
	}
	unwatch()
	if err := rootBeta.Dispose(ctx); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	afterUnwatch := len(snapshots)
	mu.Unlock()
	if afterUnwatch != count {
		t.Fatalf("watcher fired after disposal: before=%d after=%d", count, afterUnwatch)
	}
}
