package acp

import (
	"context"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

const appToolLoadingCapability = "pero.appToolLoading"

type appToolLoadingRequest struct {
	App             string   `json:"app"`
	RequiredServers []string `json:"requiredServers,omitempty"`
}

// Session metadata only changes the presentation of current MCP grants.
// App tools are still admitted and authorized by their existing MCP owners.
func (s *Server) configureSessionTools(servers []harness.MCPServerConfig, loading *appToolLoadingRequest) (func(context.Context, *point.Run, *harness.Agent) error, error) {
	if loading != nil {
		s.mu.Lock()
		negotiated := s.appToolLoading
		s.mu.Unlock()
		if !negotiated {
			return nil, invalidError("App tool loading capability was not negotiated")
		}
		if err := loading.apply(servers); err != nil {
			return nil, err
		}
	}
	return func(ctx context.Context, run *point.Run, agent *harness.Agent) error {
		if err := s.registerUserQuestions(run, agent); err != nil {
			return err
		}
		if _, err := s.h.Approvals().Register(run, s.requestApproval); err != nil {
			return err
		}
		if loading != nil {
			if err := s.registerAppDeferredTools(run); err != nil {
				return err
			}
		}
		if s.goal && s.preparePrompt == nil && !agent.IsExternal() {
			if err := s.registerGoalTool(run, agent); err != nil {
				return err
			}
		}
		return harness.MountAgentMCPServers(ctx, run, s.h.Tools(), s.h.Prompts(), agent, servers)
	}, nil
}

func (r appToolLoadingRequest) apply(servers []harness.MCPServerConfig) error {
	if r.App == "" || len(r.App) > 64 || strings.HasPrefix(r.App, "-") || strings.HasSuffix(r.App, "-") ||
		strings.Contains(r.App, "--") || strings.IndexFunc(r.App, func(c rune) bool {
		return !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-')
	}) >= 0 {
		return invalidError("invalid App scope for tool loading")
	}
	required := make(map[string]bool, len(r.RequiredServers))
	for _, name := range r.RequiredServers {
		if name == "pero-app-use" || required[name] {
			return invalidError("invalid required MCP server for App tool loading")
		}
		required[name] = true
	}
	hasAppTools := false
	for index := range servers {
		server := &servers[index]
		if server.Name == "pero-app-use" && server.Transport == harness.MCPStreamableHTTP {
			server.AppToolScope = r.App
			hasAppTools = true
		}
		if required[server.Name] {
			server.AppToolEager = true
			delete(required, server.Name)
			hasAppTools = true
		}
	}
	if len(required) != 0 || !hasAppTools {
		return invalidError("App tool loading requires current App MCP bindings")
	}
	return nil
}
