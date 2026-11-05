package pluginruntime

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/phodal/pero/harness/go/agentinstructions"
	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

// Observe the selected model request, after instruction rendering and guards.
// Never run on speculative preparePaths checks or from a Session event callback.
func (app *HookApp) noteInstructionLoads(agent *harness.Agent, messages []harness.Message) {
	if !app.hasHookEvent("InstructionsLoaded") {
		return
	}
	files, present := agentinstructions.LoadedBaseline(messages)
	if !present {
		return
	}
	var previous []agentinstructions.LoadedFile
	for _, event := range agent.Session().Events() {
		if event.Type == "claude-hook/instructions-loaded" {
			_ = json.Unmarshal(event.Data, &previous)
		}
	}
	if slices.Equal(previous, files) {
		return
	}
	if _, err := agent.Session().Append("claude-hook/instructions-loaded", files); err != nil {
		app.h.Runtime().Logger().Warn("InstructionsLoaded observation could not be recorded", "error", err)
		return
	}
	for _, file := range files {
		if slices.Contains(previous, file) {
			continue
		}
		app.mu.Lock()
		if app.closed {
			app.mu.Unlock()
			return
		}
		ctx, cancel := context.WithCancel(app.owner)
		app.asyncCancels = append(app.asyncCancels, cancel)
		app.calls.Add(1)
		app.mu.Unlock()
		go func(file agentinstructions.LoadedFile) {
			defer app.calls.Done()
			defer cancel()
			// All decision fields are ignored. The ordinary event runner still owns
			// deadlines, process reaping, HTTP/MCP execution and transcript identity.
			_, err := app.event(ctx, agent, claudehooks.Input{Event: "InstructionsLoaded", FilePath: file.Path, MemoryType: "Project", LoadReason: file.Reason})
			if err != nil && !app.closing() {
				app.h.Runtime().Logger().Warn("InstructionsLoaded hook failed", "error", err)
			}
		}(file)
	}
}
