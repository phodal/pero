package pluginruntime

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/shell"
)

// Explicit plugin selection authorizes its connection helper, just as it
// authorizes its stdio server. Configuration inspection never calls this closure.
func mcpHeadersProvider(pkg plugins.Package, declaration plugins.MCPServerDefinition, config harness.MCPServerConfig, environment []string, data string) func(context.Context) (map[string]string, error) {
	env := append([]string(nil), environment...)
	env = append(env, "CLAUDE_PLUGIN_ROOT="+pkg.Root, "CLAUDE_PLUGIN_DATA="+data, "CLAUDE_PROJECT_DIR="+config.CWD, "CLAUDE_CODE_MCP_SERVER_NAME="+declaration.Name, "CLAUDE_CODE_MCP_SERVER_URL="+config.URL)
	return func(ctx context.Context) (map[string]string, error) {
		executor, err := shell.NewLocalExecutor(shell.LocalOptions{Shell: "/bin/bash", CWD: config.CWD, Timeout: 10 * time.Second, MaxTimeout: 10 * time.Second, MaxOutputBytes: 64 << 10, BaseEnv: env, TrustedBaseEnvironment: true})
		if err != nil {
			return nil, errors.New("pluginruntime: MCP headers helper cannot start on this host")
		}
		spec, err := executor.Resolve(shell.ExecRequest{Command: declaration.HeadersHelper})
		if err != nil {
			return nil, errors.New("pluginruntime: invalid MCP headers helper command")
		}
		result, err := executor.Run(ctx, spec)
		if err != nil || result.ExitCode == nil || *result.ExitCode != 0 || result.TimedOut || result.Aborted || result.CleanupUncertain || result.Stdout.Truncated {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, errors.New("pluginruntime: MCP headers helper failed or exceeded its limits")
		}
		var headers map[string]string
		if json.Unmarshal([]byte(result.Stdout.Text), &headers) != nil || headers == nil {
			return nil, errors.New("pluginruntime: MCP headers helper must return a JSON object of string headers")
		}
		return headers, nil
	}
}
