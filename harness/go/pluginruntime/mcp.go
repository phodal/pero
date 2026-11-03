package pluginruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	harnessmcp "github.com/phodal/pero/harness/go/mcp"
	"github.com/phodal/pero/harness/go/plugins"
	point "github.com/phodal/pero/harness/go/runtime"
)

// MountMCP installs synchronous root-session activation composition. Cleanup is
// reserved against the exact Agent before mounting its scoped connection owner.
// Delegated Agents inherit the root scope's tools and do not reconnect servers.
func MountMCP(ctx context.Context, h *harness.Harness, packages []plugins.Package, environment []string, hooks *HookApp) (*point.Instance, error) {
	var snapshot []plugins.Package
	for _, pkg := range packages {
		if len(pkg.MCP) == 0 {
			continue
		}
		copyPackage := plugins.Package{Root: pkg.Root, Definition: plugins.Plugin{Name: pkg.Definition.Name}}
		for _, server := range pkg.MCP {
			copied := server
			copied.Args = append([]string(nil), server.Args...)
			copied.Env, copied.Headers = make(map[string]string), make(map[string]string)
			for name, value := range server.Env {
				copied.Env[name] = value
			}
			for name, value := range server.Headers {
				copied.Headers[name] = value
			}
			copyPackage.MCP = append(copyPackage.MCP, copied)
		}
		snapshot = append(snapshot, copyPackage)
	}
	if len(snapshot) == 0 {
		return nil, nil
	}
	if h == nil || h.Runtime() == nil {
		return nil, errors.New("pluginruntime: MCP mount requires a running harness")
	}
	environment = append([]string(nil), environment...)
	definition := point.Define(point.Descriptor{ID: "pluginruntime/mcp", Requires: []point.Requirement{point.Require(harness.AgentHooksKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		_, err := h.Hooks().Activated.On(run, func(ctx context.Context, agent *harness.Agent) error {
			if agent.Parent() != nil {
				return nil
			}
			servers, err := MCPServers(snapshot, agent.Session().WorkingDirectory(), environment)
			if err != nil {
				return err
			}
			var owner *point.Instance
			prepared, err := h.Agents().RegisterCleanup(agent, func(ctx context.Context) error {
				if owner != nil {
					return owner.Dispose(ctx)
				}
				return nil
			})
			if err != nil {
				return err
			}
			defer prepared()
			sessionDefinition := point.Define(point.Descriptor{ID: "pluginruntime/mcp/session"}, point.DecodeJSON[struct{}], func(ownerRun *point.Run, _ struct{}) (point.Dispose, error) {
				startup, cancelStartup := context.WithTimeout(ownerRun.Context, 15*time.Second)
				stopAdmission := context.AfterFunc(ctx, cancelStartup)
				defer stopAdmission()
				defer cancelStartup()
				if hooks != nil {
					for index := range servers {
						servers[index].Elicit = bindElicitation(hooks, servers[index].ElicitationName, servers[index].Name)
						servers[index].ElicitationCompleted = func(_ context.Context, id string, caller any) {
							hooks.noteElicitationComplete(caller, id)
						}
					}
				}
				if err := harness.MountMCPServers(startup, ownerRun, h.Tools(), h.Prompts(), servers); err != nil {
					return nil, harnessmcp.SafeError(err)
				}
				_, err := h.Prompts().Register(ownerRun, harness.PromptSection{
					ID: fmt.Sprintf("plugin-mcp-identities:%p", agent), Order: 3110,
					Content: func(ctx context.Context, target *harness.Agent) (string, error) {
						schemas, err := h.Tools().SchemasForAgent(ctx, target)
						if err != nil {
							return "", err
						}
						type identity struct {
							LogicalServer string   `json:"logicalServer"`
							RuntimeServer string   `json:"runtimeServer"`
							Tools         []string `json:"tools"`
						}
						var identities []identity
						for _, pkg := range snapshot {
							for _, server := range pkg.MCP {
								name := pluginMCPName(pkg.Definition.Name, server.Name)
								value := identity{LogicalServer: "plugin:" + pkg.Definition.Name + ":" + server.Name, RuntimeServer: name, Tools: []string{}}
								for _, schema := range schemas {
									if strings.HasPrefix(schema.Name, "mcp__"+name+"__") {
										value.Tools = append(value.Tools, schema.Name)
									}
								}
								identities = append(identities, value)
							}
						}
						encoded, err := json.Marshal(identities)
						return "## Plugin MCP identities\n\nUse the advertised tools below. Runtime server and tool names may be normalized and digest-suffixed to meet provider limits; they are not literal Claude names.\n" + string(encoded), err
					},
				})
				return nil, err
			})
			owner, err = h.Runtime().Mount(agent.Scope(), fmt.Sprintf("plugin-mcp:%p", agent), sessionDefinition, nil)
			if err == nil {
				err = owner.WaitStable(ctx)
			}
			if err == nil && owner.Snapshot().State == point.Failed {
				err = harnessmcp.SafeError(owner.LastError())
			}
			if err != nil && owner != nil {
				_ = owner.Dispose(context.Background())
			}
			return err
		})
		return nil, err
	})
	instance, err := h.Runtime().Mount(nil, "pluginruntime/mcp", definition, nil)
	if err == nil {
		err = instance.WaitStable(ctx)
	}
	if err == nil && instance.Snapshot().State == point.Failed {
		err = errors.New("pluginruntime: MCP activation listener failed")
	}
	if err != nil {
		if instance != nil {
			_ = instance.Dispose(context.Background())
		}
		return nil, err
	}
	return instance, nil
}

// MCPServers resolves already compiled package declarations. Values are expanded
// once using only the explicit environment and session/package bindings. It
// never starts a process or creates a connection.
func MCPServers(packages []plugins.Package, cwd string, environment []string) ([]harness.MCPServerConfig, error) {
	if !filepath.IsAbs(cwd) {
		return nil, errors.New("pluginruntime: MCP requires an absolute working directory")
	}
	cwd = filepath.Clean(cwd)
	base := make(map[string]string)
	for _, binding := range environment {
		name, value, ok := strings.Cut(binding, "=")
		if !ok || name == "" || strings.ContainsAny(name+value, "\x00") {
			return nil, errors.New("pluginruntime: invalid explicit MCP environment")
		}
		base[name] = value
	}
	servers := make([]harness.MCPServerConfig, 0)
	seen := make(map[string]bool)
	for _, pkg := range packages {
		if !filepath.IsAbs(pkg.Root) || pkg.Definition.Name == "" {
			return nil, errors.New("pluginruntime: MCP requires a named package with an absolute root")
		}
		bindings := make(map[string]string, len(base)+2)
		for name, value := range base {
			bindings[name] = value
		}
		bindings["CLAUDE_PLUGIN_ROOT"], bindings["CLAUDE_PROJECT_DIR"] = pkg.Root, cwd
		for _, declaration := range pkg.MCP {
			if declaration.Transport == "" || declaration.Transport == "stdio" {
				directory, err := plugins.EnsurePluginDataDirectory(pkg.Definition.Name)
				if err != nil {
					return nil, err
				}
				bindings["CLAUDE_PLUGIN_DATA"] = directory
				break
			}
		}
	nextServer:
		for _, declaration := range pkg.MCP {
			if declaration.Name == "" {
				return nil, errors.New("pluginruntime: MCP declaration requires a server name")
			}
			name := pluginMCPName(pkg.Definition.Name, declaration.Name)
			if seen[name] {
				return nil, errors.New("pluginruntime: plugin MCP server identities collide")
			}
			serverBindings := bindings
			if declaration.Transport == "http" || declaration.Transport == "streamable-http" || declaration.Transport == "sse" {
				serverBindings = make(map[string]string, len(bindings))
				for key, value := range bindings {
					if key != "CLAUDE_PLUGIN_DATA" {
						serverBindings[key] = value
					}
				}
			}
			config := harness.MCPServerConfig{Name: name, ElicitationName: declaration.Name, CWD: cwd, Env: make(map[string]string), Headers: make(map[string]string)}
			if path, present := base["PATH"]; present {
				config.Env["PATH"] = path
			}
			for key, value := range declaration.Env {
				if key == "" || strings.ContainsAny(key, "=\x00") {
					return nil, errors.New("pluginruntime: invalid MCP environment binding")
				}
				expanded, err := expandMCPValue(value, serverBindings)
				if errors.Is(err, errMCPDependencyMissing) {
					continue nextServer
				}
				if err != nil {
					return nil, err
				}
				config.Env[key] = expanded
			}
			config.Env["CLAUDE_PLUGIN_ROOT"], config.Env["CLAUDE_PROJECT_DIR"] = pkg.Root, cwd
			if declaration.Transport == "" || declaration.Transport == "stdio" {
				config.Env["CLAUDE_PLUGIN_DATA"] = bindings["CLAUDE_PLUGIN_DATA"]
			}
			if declaration.TimeoutMilliseconds >= 1000 {
				if declaration.TimeoutMilliseconds > 2_147_483_647 {
					return nil, errors.New("pluginruntime: MCP timeout exceeds the supported timer range")
				}
				config.ToolCallTimeoutMS = declaration.TimeoutMilliseconds
			} else if declaration.TimeoutMilliseconds < 0 {
				return nil, errors.New("pluginruntime: MCP timeout cannot be negative")
			}
			switch declaration.Transport {
			case "stdio", "":
				config.Transport = harness.MCPStdio
				command, err := expandMCPValue(declaration.Command, bindings)
				if errors.Is(err, errMCPDependencyMissing) {
					continue
				}
				if err != nil {
					return nil, err
				}
				config.Command, err = resolveMCPExecutable(command, cwd, config.Env["PATH"])
				if errors.Is(err, errMCPDependencyMissing) {
					continue
				}
				if err != nil {
					return nil, err
				}
				for _, argument := range declaration.Args {
					expanded, err := expandMCPValue(argument, bindings)
					if errors.Is(err, errMCPDependencyMissing) {
						config.Command = ""
						break
					}
					if err != nil {
						return nil, err
					}
					config.Args = append(config.Args, expanded)
				}
				if config.Command == "" {
					continue
				}
			case "http", "streamable-http", "sse":
				config.Transport = harness.MCPStreamableHTTP
				if declaration.Transport == "sse" {
					config.Transport = harness.MCPSSE
				}
				endpoint, err := expandMCPValue(declaration.URL, serverBindings)
				if errors.Is(err, errMCPDependencyMissing) {
					continue
				}
				if err != nil {
					return nil, err
				}
				parsed, err := url.Parse(endpoint)
				if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
					return nil, errors.New("pluginruntime: MCP endpoint must be absolute HTTP(S)")
				}
				config.URL = endpoint
				for key, value := range declaration.Headers {
					expanded, err := expandMCPValue(value, serverBindings)
					if errors.Is(err, errMCPDependencyMissing) {
						config.URL = ""
						break
					}
					if err != nil {
						return nil, err
					}
					config.Headers[key] = expanded
				}
			default:
				return nil, errors.New("pluginruntime: unsupported MCP transport")
			}
			if config.URL == "" && (declaration.Transport == "http" || declaration.Transport == "streamable-http" || declaration.Transport == "sse") {
				continue
			}
			seen[name] = true
			servers = append(servers, config)
		}
	}
	return servers, nil
}

func pluginMCPName(plugin, server string) string {
	return harnessmcp.NormalizeServerName("plugin_" + plugin + "_" + server)
}

func expandMCPValue(input string, bindings map[string]string) (string, error) {
	var output strings.Builder
	for {
		start := strings.Index(input, "${")
		if start < 0 {
			output.WriteString(input)
			break
		}
		output.WriteString(input[:start])
		remaining := input[start+2:]
		end := strings.IndexByte(remaining, '}')
		if end < 0 {
			return "", errors.New("pluginruntime: unclosed MCP variable expression")
		}
		expression := remaining[:end]
		name, fallback, hasDefault := strings.Cut(expression, ":-")
		if name == "" || strings.ContainsAny(name, "${}:= \t\r\n\x00") || strings.Contains(fallback, "${") {
			return "", errors.New("pluginruntime: unsupported MCP variable expression")
		}
		value, exists := bindings[name]
		if !exists {
			if !hasDefault {
				return "", fmt.Errorf("%w: required MCP environment variable is unset", errMCPDependencyMissing)
			}
			value = fallback
		}
		output.WriteString(value)
		input = remaining[end+1:]
	}
	value := output.String()
	if strings.ContainsRune(value, '\x00') {
		return "", errors.New("pluginruntime: MCP binding contains an invalid character")
	}
	return value, nil
}

func resolveMCPExecutable(command, cwd, pathValue string) (string, error) {
	if command == "" || strings.ContainsRune(command, '\x00') {
		return "", errors.New("pluginruntime: MCP executable is required")
	}
	var candidates []string
	if filepath.IsAbs(command) {
		candidates = []string{command}
	} else if strings.ContainsAny(command, "/\\") {
		candidates = []string{filepath.Join(cwd, command)}
	} else {
		for _, directory := range filepath.SplitList(pathValue) {
			if filepath.IsAbs(directory) {
				candidates = append(candidates, filepath.Join(directory, command))
			}
		}
	}
	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err == nil && info.Mode().IsRegular() && (runtime.GOOS == "windows" || info.Mode().Perm()&0111 != 0) {
			return filepath.Clean(candidate), nil
		}
	}
	return "", fmt.Errorf("%w: MCP executable is unavailable in the explicit environment", errMCPDependencyMissing)
}

var errMCPDependencyMissing = errors.New("pluginruntime: MCP server dependency is missing")
