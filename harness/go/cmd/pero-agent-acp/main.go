// pero-agent-acp runs the extracted agent loop over ACP stdio, without product services.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/phodal/pero/harness/go/acp"
	"github.com/phodal/pero/harness/go/agentinstructions"
	"github.com/phodal/pero/harness/go/charts"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	"github.com/phodal/pero/harness/go/pluginruntime"
	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/providers/openai"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/skills"
	"github.com/phodal/pero/harness/go/subagents"
	"github.com/phodal/pero/harness/go/tasks"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() (resultErr error) {
	if len(os.Args) > 1 && os.Args[1] == "plugins" {
		return runPlugins(os.Args[2:], os.Stdout)
	}
	endpoint := flag.String("endpoint", "", "explicit OpenAI-compatible HTTPS endpoint (loopback HTTP allowed)")
	model := flag.String("model", "", "explicit provider model ID")
	chartPython := flag.String("chart-python", "python3", "Python 3.9+ executable for shared chart/data core")
	recoverTail := flag.Bool("recover-complete-session-tail", false, "opt in to lossless final JSONL delimiter recovery with a private backup")
	sessions := flag.String("session-dir", "", "private directory for durable JSONL sessions (required)")
	keyEnv := flag.String("api-key-env", "AGENT_PROVIDER_API_KEY", "environment variable containing the provider credential")
	auditPath := flag.String("http-attempt-audit", "", "optional absolute existing private file to durably record each provider HTTP attempt")
	workspace := flag.String("workspace", "", "explicit native file tool authority root; absent disables native tools")
	enableResearchClone := flag.Bool("enable-research-clone", false, "enable approved pinned GitHub acquisition without checkout; requires --workspace; Unix only")
	enableShell := flag.Bool("enable-shell", false, "enable approved shell execution (Unix unsandboxed unless --sandbox supplied; Windows requires windows-acl; requires --workspace)")
	shellPath := flag.String("shell", "", "absolute shell executable; defaults to /bin/bash on Unix; Windows requires explicit pwsh.exe")
	approval := flag.String("approval", "ask", "tool approval policy: never or ask via ACP client")
	budget := bindProviderBudget(flag.CommandLine)
	skillRoots := bindSkillRoots(flag.CommandLine)
	pluginConfig := bindPluginOptions(flag.CommandLine)
	compaction := bindCompaction(flag.CommandLine)
	sandboxOptions := bindSandbox(flag.CommandLine)
	selectable := bindSelectableModels(flag.CommandLine)
	coding := bindCodingOptions(flag.CommandLine)
	delegation := bindSubagents(flag.CommandLine)
	flag.Parse()
	if flag.NArg() != 0 || strings.TrimSpace(*model) == "" || strings.TrimSpace(*sessions) == "" {
		return errors.New("--model and --session-dir are required; positional arguments are unsupported")
	}
	if *approval != "never" && *approval != "ask" {
		return errors.New("--approval must be never or ask")
	}
	if (*enableShell || *enableResearchClone) && *workspace == "" {
		return errors.New("--enable-shell / --enable-research-clone requires --workspace")
	}
	if len(pluginConfig.Directories) > 0 && *workspace == "" {
		return errors.New("--plugin-dir requires an explicit --workspace")
	}
	packages, err := plugins.LoadPackages(context.Background(), pluginConfig.Directories)
	if err != nil {
		return err
	}
	selections, agentDefinitions := pluginSelections(packages)
	pluginShell := *shellPath
	if pluginShell == "" {
		pluginShell = "/bin/bash"
	}
	if err := coding.validate(*workspace); err != nil {
		return err
	}
	if err := delegation.validate(); err != nil {
		return err
	}
	sandboxConfig, err := sandboxOptions.config(*workspace, *enableShell, *approval)
	if err != nil {
		return err
	}
	credential, err := takeProviderCredential(*keyEnv)
	if err != nil {
		return err
	}
	pluginEnvironment := os.Environ()
	providerConfig, err := configuredProvider(*endpoint, *model, credential, *budget)
	if err != nil {
		return err
	}
	providerConfig.BeforeHTTPAttempt, err = httpAttemptAudit(*auditPath, budget.MaxRequests)
	if err != nil {
		return err
	}
	compactionConfig, err := configuredCompaction(&providerConfig, *compaction)
	if err != nil {
		return err
	}
	modelCatalog, err := additionalPluginModels(*model, *selectable, pluginConfig.Models)
	if err != nil {
		return err
	}
	if err := configureSelectableModels(&providerConfig, modelCatalog); err != nil {
		return err
	}
	adapter, err := openai.New(providerConfig)
	if err != nil {
		return err
	}
	persistence, err := harness.NewJSONLSessionPersistence(*sessions, harness.JSONLPersistenceOptions{RecoverCompleteTail: *recoverTail})
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	h, err := harness.Boot(ctx, harness.Options{EnableSubagents: delegation.Enabled || len(packages) > 0, Adapter: adapter, AdapterProviders: []string{"configured"}, ModelInfo: adapter, ApprovalPolicy: harness.ApprovalPolicy(*approval)})
	if err != nil {
		return err
	}
	var native *nativetools.App
	var skillCatalog *skills.Catalog
	var instructions *agentinstructions.App
	var pluginHooks *pluginruntime.HookApp
	var pluginAgents *subagents.ClaudeContribution
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		resultErr = errors.Join(resultErr, h.Dispose(cleanup), h.Drain(cleanup), native.Close(), skillCatalog.Close(), instructions.Close(), pluginHooks.Close())
	}()
	skillCatalog, err = skills.OpenSelected(ctx, *skillRoots, selections)
	if err != nil {
		return err
	}
	if *workspace != "" {
		nativeOptions := nativetools.Options{Workspace: *workspace, EnableShell: *enableShell, EnableResearchClone: *enableResearchClone, Shell: *shellPath, Sandbox: sandboxConfig, ClaudeTools: len(packages) > 0}
		if len(packages) > 0 {
			nativeOptions.ReadOnlyResource = pluginResourceReader(skillCatalog, selections)
			nativeOptions.PluginEnvironment = pluginEnvironment
		}
		native, err = nativetools.Mount(ctx, h, nativeOptions)
		if err != nil {
			return err
		}
	}
	if err := charts.Mount(ctx, h, *chartPython); err != nil {
		return err
	}
	instructions, err = mountCoding(ctx, h, *workspace, *coding)
	if err != nil {
		return err
	}
	if skillCatalog != nil {
		mountOptions := skills.MountOptions{Claude: len(packages) > 0}
		if len(packages) > 0 {
			mountOptions.ResolveModel = pluginModelResolver(pluginConfig.Models)
			mountOptions.Fork = func(ctx context.Context, parent *harness.Agent, definition skills.Definition) (harness.SubagentResult, error) {
				origin, _, _ := strings.Cut(definition.Name, ":")
				return pluginAgents.Invoke(ctx, parent, subagents.ClaudeInvocation{
					Definition: definition.Agent, Prompt: definition.Content, Description: "Run " + definition.Name, Model: definition.Model, Origin: origin,
					ConfigureChild: func(ctx context.Context, run *point.Run, child *harness.Agent) error {
						return skills.ConfigureFork(ctx, h, run, child, definition)
					},
				})
			}
			mountOptions.Expand = func(ctx context.Context, agent *harness.Agent, definition skills.Definition, args string) (skills.Definition, error) {
				return pluginruntime.ExpandSkill(ctx, h, agent, definition, args, pluginruntime.ExpansionOptions{Shell: pluginShell, Environment: pluginEnvironment, Sandbox: sandboxConfig})
			}
		}
		if err := skills.MountCatalog(ctx, h, skillCatalog, mountOptions); err != nil {
			return err
		}
	}
	if err := mountSubagents(ctx, h, persistence, *delegation, compactionConfig); err != nil {
		return err
	}
	if len(packages) > 0 {
		stateRoot, err := filepath.Abs(filepath.Join(*sessions, "plugin-hooks"))
		if err != nil {
			return err
		}
		if sandboxConfig != nil {
			for _, pkg := range packages {
				if len(pkg.Hooks) > 0 {
					return errors.New("plugin command hooks do not yet support the selected sandbox backend")
				}
			}
		}
		pluginHooks, err = pluginruntime.MountHooks(ctx, h, packages, pluginruntime.HookOptions{Shell: pluginShell, Environment: pluginEnvironment, StateDirectory: stateRoot})
		if err != nil {
			return err
		}
		if _, err := pluginruntime.MountMCP(ctx, h, packages, pluginEnvironment); err != nil {
			return err
		}
		if _, err := tasks.Mount(ctx, h); err != nil {
			return err
		}
		pluginAgents, err = subagents.MountClaude(ctx, h, agentDefinitions, subagents.ClaudeOptions{InvocationOrigin: skills.ActivePlugin, ModelRoutes: pluginConfig.Models, MaxDepth: 4, MaxActive: delegation.MaxActive, Persistence: persistence, Compaction: compactionConfig})
		if err != nil {
			return err
		}
	}
	serverOptions := acp.Options{UserQuestions: len(packages) > 0, ModelSelection: len(*selectable) != 0, Compaction: compactionConfig, Harness: h, Persistence: persistence, Provider: "configured", Model: *model, Name: "pero-agent-acp", Version: "0.1"}
	if native != nil {
		serverOptions.ValidateWorkingDirectory = native.CheckCWD
	}
	server, err := acp.NewServer(serverOptions)
	if err != nil {
		return err
	}
	// Closing stdin interrupts a blocked scanner when the process receives a signal.
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = os.Stdin.Close()
		case <-done:
		}
	}()
	err = server.Serve(ctx, os.Stdin, os.Stdout)
	return err
}

// Remove the actual configured name before any MCP child can inherit it. This
// applies even to names not matched by generic secret-name filters.
func takeProviderCredential(name string) (string, error) {
	if name == "" {
		return "", errors.New("credential environment variable name must not be empty")
	}
	value := os.Getenv(name)
	if err := os.Unsetenv(name); err != nil {
		return "", errors.New("could not clear provider credential environment variable")
	}
	return value, nil
}

// Zero request/token caps preserve prior behavior. -1 is only the CLI sentinel
// for omitted retry policy; an explicit zero becomes a non-nil zero pointer.
type providerBudget struct {
	DisableThinking     bool
	UseEnvironmentProxy bool
	ImageInput          bool
	MaxRequests         int
	MaxTokens           int
	MaxRetries          int
	ReasoningEffort     string
}

func bindProviderBudget(flags *flag.FlagSet) *providerBudget {
	budget := &providerBudget{}
	flags.BoolVar(&budget.DisableThinking, "disable-thinking", false, "explicitly send thinking.type=disabled to a compatible provider")
	flags.BoolVar(&budget.UseEnvironmentProxy, "use-env-proxy", false, "opt in to standard HTTP(S)_PROXY/NO_PROXY routing; TLS verification remains enabled")
	flags.BoolVar(&budget.ImageInput, "image-input", false, "declare this model supports bounded in-memory PNG/JPEG input; never fetch remote image URLs or local paths")
	flags.IntVar(&budget.MaxRequests, "max-requests", 0, "hard provider HTTP attempt cap for this process (0 keeps unlimited)")
	flags.IntVar(&budget.MaxTokens, "max-tokens", 0, "hard per-request output token cap (0 keeps provider default)")
	flags.IntVar(&budget.MaxRetries, "max-retries", -1, "provider recovery retry count (0 disables; -1 preserves default)")
	flags.StringVar(&budget.ReasoningEffort, "reasoning-effort", "", "explicit provider reasoning effort/default; omitted preserves existing behavior")
	return budget
}
func configuredProvider(endpoint, model, credential string, budget providerBudget) (openai.Config, error) {
	if budget.MaxRequests < 0 || budget.MaxTokens < 0 || budget.MaxRetries < -1 {
		return openai.Config{}, errors.New("provider budgets must be nonnegative (max-retries may be -1 for default)")
	}
	if len(budget.ReasoningEffort) > 64 || strings.ContainsAny(budget.ReasoningEffort, " \t\r\n\x00") {
		return openai.Config{}, errors.New("reasoning effort must be a provider identifier of at most 64 bytes")
	}
	declared := openai.ModelConfig{ID: model, MaxTokens: budget.MaxTokens}
	if budget.ImageInput {
		declared.InputModalities = []string{"text", "image"}
	}
	if budget.ReasoningEffort != "" {
		effort := harness.ReasoningEffort(budget.ReasoningEffort)
		declared.Reasoning = &harness.ModelReasoningInfo{DefaultEffort: effort, Efforts: []harness.ReasoningEffortInfo{{ID: effort, Name: budget.ReasoningEffort}}}
	}
	config := openai.Config{Endpoint: endpoint, APIKey: credential, ProviderName: "configured", Models: []openai.ModelConfig{declared}, MaxRequests: budget.MaxRequests, MaxOutputTokens: budget.MaxTokens, UseEnvironmentProxy: budget.UseEnvironmentProxy, DisableThinking: budget.DisableThinking}
	if budget.MaxRetries >= 0 {
		count := budget.MaxRetries
		config.RetryPolicy = &harness.RetryPolicyConfig{Mode: harness.RetryNormal, MaxRetries: &count}
	}
	return config, nil
}

// A repeatable explicit flag is the only source of skill roots. ACP cwd and
// tool arguments cannot add roots or trigger automatic discovery.
func bindSkillRoots(flags *flag.FlagSet) *[]string {
	roots := new([]string)
	flags.Func("skills-root", "explicit read-only root containing <name>/SKILL.md (repeat up to 8 times; omitted disables skills)", func(value string) error {
		if strings.TrimSpace(value) == "" || len(*roots) >= skills.MaxRoots {
			return errors.New("skills-root requires a nonempty directory, at most 8 roots")
		}
		*roots = append(*roots, value)
		return nil
	})
	return roots
}
