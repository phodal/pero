package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	point "github.com/phodal/pero/harness/go/runtime"
)

// The private policy value belongs to one runtime service realm. Agents sample
// detached policy or a managed dispatcher at creation; neither can restart work.
// Only warning suppression is shared mutable state, scoped to this exact owner
// generation like the source BasicCompactionEngine service.
var basicCompactionDefaultsKey = point.NewKey[basicCompactionDefaults]("harness.basic-compaction-defaults")

type basicCompactionDefaults struct {
	managed        *ManagedCompactionDefaults
	headroomTokens int
	// fullPolicy is sampled only when AgentOptions.Compaction is nil. Typed
	// Point overrides retain their existing zero-sentinel semantics.
	fullPolicy       *BasicCompactionConfig
	pressureWarnings *compactionPressureWarnings
}

// MountBasicCompactionDefaults supplies an entrypoint-owned default headroom
// for future Agents in this runtime. Explicit per-Agent headroom and summary
// caps survive. Disposing the contribution only affects later samples; existing
// Agents retain their detached, Agent-owned compactor until their own disposal.
// A zero headroom remains available through AgentOptions.Compaction with an
// explicit positive summary cap; the default must support unconfigured Agents.
func MountBasicCompactionDefaults(ctx context.Context, h *Harness, headroomTokens int) (*point.Instance, error) {
	if h == nil || h.runtime == nil {
		return nil, errors.New("harness: compaction defaults require a running harness")
	}
	if headroomTokens <= 0 {
		return nil, errors.New("harness: default compaction headroom must be positive")
	}
	return mountBasicCompactionDefaults(ctx, h, basicCompactionDefaults{headroomTokens: headroomTokens})
}

// MountDSHBasicCompactionDefaults validates one complete DSH source policy and
// contributes it for future unconfigured Agents. Explicit typed per-Agent
// options keep existing Point semantics and the standard DSH headroom fallback;
// this API does not claim a presence-aware merge into those legacy options.
// Existing Agents keep their own detached samples. Profile lifecycle
// enrollment/transaction activation is a separate owner responsibility.
func MountDSHBasicCompactionDefaults(ctx context.Context, h *Harness, raw json.RawMessage) (*point.Instance, error) {
	if h == nil || h.runtime == nil {
		return nil, errors.New("harness: compaction defaults require a running harness")
	}
	config, err := DecodeDSHBasicCompactionConfig(raw)
	if err != nil {
		return nil, err
	}
	return mountBasicCompactionDefaults(ctx, h, basicCompactionDefaults{headroomTokens: 65536, fullPolicy: &config})
}

func mountBasicCompactionDefaults(ctx context.Context, h *Harness, defaults basicCompactionDefaults) (*point.Instance, error) {
	if defaults.fullPolicy != nil {
		config := cloneBasicCompactionConfig(*defaults.fullPolicy)
		defaults.fullPolicy = &config
	}
	definition := point.Define(
		point.Descriptor{ID: "harness/contribution/basic-compaction-defaults", Provides: []point.AnyKey{basicCompactionDefaultsKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			provided := defaults
			provided.pressureWarnings = &compactionPressureWarnings{}
			if defaults.fullPolicy != nil {
				config := cloneBasicCompactionConfig(*defaults.fullPolicy)
				provided.fullPolicy = &config
			}
			_, err := point.Provide(run, basicCompactionDefaultsKey, provided)
			return nil, err
		},
	)
	instance, err := h.runtime.Mount(h.runtime.Root(), "basic-compaction-defaults", definition, nil)
	if err != nil {
		return nil, err
	}
	if err = instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("harness: compaction defaults activation failed: %s", snapshot.LastError)
	}
	return instance, nil
}

func sampleBasicCompactionConfig(runtime *point.Runtime, scope *point.Scope, explicit *BasicCompactionConfig, disabled bool) *BasicCompactionConfig {
	if disabled {
		return nil
	}
	defaults, found := point.Lookup(runtime, scope, basicCompactionDefaultsKey)
	if !found {
		return explicit
	}
	if explicit == nil && defaults.managed != nil {
		return &BasicCompactionConfig{managed: defaults.managed}
	}
	config := BasicCompactionConfig{}
	if explicit != nil {
		config = cloneBasicCompactionConfig(*explicit)
	} else if defaults.fullPolicy != nil {
		config = cloneBasicCompactionConfig(*defaults.fullPolicy)
	}
	config.dshSourcePolicy = true
	config.dshPressureWarnings = defaults.pressureWarnings
	if config.HeadroomTokens == nil {
		config.HeadroomTokens = &defaults.headroomTokens
	}
	return &config
}

// CloneBasicCompactionConfig detaches trusted composition data while retaining
// native private policy semantics. It grants no model/tool configuration authority.
func CloneBasicCompactionConfig(config BasicCompactionConfig) BasicCompactionConfig {
	return cloneBasicCompactionConfig(config)
}

func cloneBasicCompactionConfig(config BasicCompactionConfig) BasicCompactionConfig {
	config.HeadroomTokens = cloneInt(config.HeadroomTokens)
	config.RetainRatio = cloneFloat(config.RetainRatio)
	config.RetainTokens = cloneInt(config.RetainTokens)
	config.CompactionRetries = cloneInt(config.CompactionRetries)
	config.MaxOverflowRetries = cloneInt(config.MaxOverflowRetries)
	if config.Auto != nil {
		value := *config.Auto
		config.Auto = &value
	}
	policies := config.ModelPolicies
	if policies != nil {
		config.ModelPolicies = make([]ModelCompactionPolicy, len(policies))
		for index, policy := range policies {
			config.ModelPolicies[index] = cloneModelCompactionPolicy(policy)
		}
	}
	return config
}
