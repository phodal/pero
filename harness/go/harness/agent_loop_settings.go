package harness

import (
	"encoding/json"
	"errors"
	"sync/atomic"

	point "github.com/phodal/pero/harness/go/runtime"
)

const AgentLoopSettingsNamespace = "agent-loop"

var agentLoopSettingsSchema = json.RawMessage(`{
  "type":"object",
  "properties":{
    "maxParallelToolCalls":{"type":"integer","minimum":1,"default":10},
    "toolOutputBatchBytes":{"type":"integer","minimum":0,"default":65536}
  },
  "additionalProperties":false
}`)

// AgentLoopSettings is the DSH-compatible live settings section for the
// model/tool continuation scheduler.
type AgentLoopSettings struct {
	MaxParallelToolCalls int `json:"maxParallelToolCalls,omitempty"`
	ToolOutputBatchBytes int `json:"toolOutputBatchBytes"`
}

// AgentLoopConfig publishes the latest validated scheduler generation. Agents
// with no explicit per-Agent override consult it when each parallel group is
// dispatched, so a settings commit applies without recreating the Session.
type AgentLoopConfig struct {
	maxParallelToolCalls atomic.Int64
	toolOutputBatchBytes atomic.Int64
	settings             *SettingsScope[AgentLoopSettings]
}

func (c *AgentLoopConfig) MaxParallelToolCalls() int {
	if c == nil {
		return DefaultMaxParallelToolCalls
	}
	value := int(c.maxParallelToolCalls.Load())
	if value <= 0 {
		return DefaultMaxParallelToolCalls
	}
	return value
}

const DefaultToolOutputBatchBytes = 64 * 1024

func (c *AgentLoopConfig) ToolOutputBatchBytes() int {
	if c == nil {
		return DefaultToolOutputBatchBytes
	}
	return int(c.toolOutputBatchBytes.Load())
}

func (c *AgentLoopConfig) Settings() *SettingsScope[AgentLoopSettings] {
	if c == nil {
		return nil
	}
	return c.settings
}

func agentLoopSettingsDefinition() point.Definition {
	return point.Define(
		point.Descriptor{
			ID:       "harness/core/agent-loop-settings",
			Requires: []point.Requirement{point.Require(SettingsProviderKey)},
			Provides: []point.AnyKey{AgentLoopConfigKey.Any()},
		},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			provider, err := point.Resolve(run, SettingsProviderKey)
			if err != nil {
				return nil, err
			}
			scope, err := RegisterSettingsSection(provider, run, AgentLoopSettingsNamespace, SettingsSectionSpec[AgentLoopSettings]{
				Defaults: AgentLoopSettings{MaxParallelToolCalls: DefaultMaxParallelToolCalls, ToolOutputBatchBytes: DefaultToolOutputBatchBytes},
				Schema:   agentLoopSettingsSchema,
				Applies:  SettingsLive,
				Validate: func(value AgentLoopSettings) error {
					if value.MaxParallelToolCalls < 1 {
						return errors.New("maxParallelToolCalls must be a positive integer")
					}
					if value.ToolOutputBatchBytes < 0 {
						return errors.New("toolOutputBatchBytes must be non-negative")
					}
					return nil
				},
			})
			if err != nil {
				return nil, err
			}
			initial, err := scope.Get()
			if err != nil {
				return nil, err
			}
			config := &AgentLoopConfig{settings: scope}
			config.maxParallelToolCalls.Store(int64(initial.MaxParallelToolCalls))
			config.toolOutputBatchBytes.Store(int64(initial.ToolOutputBatchBytes))
			if _, err := scope.Watch(run, func(next, _ AgentLoopSettings) {
				config.maxParallelToolCalls.Store(int64(next.MaxParallelToolCalls))
				config.toolOutputBatchBytes.Store(int64(next.ToolOutputBatchBytes))
			}); err != nil {
				return nil, err
			}
			_, err = point.Provide(run, AgentLoopConfigKey, config)
			return nil, err
		},
	)
}
