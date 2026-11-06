// pero-agent-acp runs the extracted agent loop over ACP stdio, without product services.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/phodal/pero/harness/go/acp"
	"github.com/phodal/pero/harness/go/agentinstructions"
	"github.com/phodal/pero/harness/go/charts"
	"github.com/phodal/pero/harness/go/environmentservice"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/lsp"
	"github.com/phodal/pero/harness/go/nativetools"
	"github.com/phodal/pero/harness/go/pluginruntime"
	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/providers/openai"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/scienceenv"
	"github.com/phodal/pero/harness/go/skills"
	"github.com/phodal/pero/harness/go/subagents"
	"github.com/phodal/pero/harness/go/tasks"
	"github.com/phodal/pero/harness/go/webtools"
	"github.com/phodal/pero/harness/go/workflow"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() (resultErr error) {
	if len(os.Args) == 3 && os.Args[1] == "service-host" {
		return environmentservice.Supervise(os.Args[2])
	}
	if len(os.Args) > 1 && os.Args[1] == "services" {
		return runServices(os.Args[2:])
	}
	if len(os.Args) > 1 && os.Args[1] == "plugins" {
		return runPlugins(os.Args[2:], os.Stdout)
	}
	endpoint := flag.String("endpoint", "", "explicit OpenAI-compatible HTTPS endpoint (loopback HTTP allowed)")
	model := flag.String("model", "", "explicit provider model ID")
	modelProfilePath := flag.String("model-profile", "", "explicit versioned JSON launch defaults for one matching model; CLI flags override defaults")
	toolFormatFlag := flag.String("tool-format", "auto", "native or claude tool names; auto preserves package-selected behavior")
	chartPython := flag.String("chart-python", "python3", "Python 3.9+ executable for shared chart/data core")
	workflowNode := flag.String("workflow-node", "node", "Node executable for explicitly selected plugin workflows")
	recoverTail := flag.Bool("recover-complete-session-tail", false, "opt in to lossless final JSONL delimiter recovery with a private backup")
	initOnly := flag.Bool("init-only", false, "run Setup init and SessionStart startup, then exit without a conversation")
	printMode := flag.Bool("print", false, "run one non-interactive prompt, using a SessionStart initialUserMessage as the first turn")
	maintenance := flag.Bool("maintenance", false, "run Setup maintenance, then exit without a conversation")
	sessions := flag.String("session-dir", "", "private directory for durable JSONL sessions (required)")
	keyEnv := flag.String("api-key-env", "AGENT_PROVIDER_API_KEY", "environment variable containing the provider credential")
	auditPath := flag.String("http-attempt-audit", "", "optional absolute existing private file to durably record each provider HTTP attempt")
	workspace := flag.String("workspace", "", "explicit native file tool authority root; absent disables native tools")
	enableResearchClone := flag.Bool("enable-research-clone", false, "enable approved pinned GitHub acquisition without checkout; requires --workspace; Unix only")
	enableShell := flag.Bool("enable-shell", false, "enable approved shell execution (Unix unsandboxed unless --sandbox supplied; Windows requires windows-acl; requires --workspace)")
	scienceEnv := flag.Bool("science-env", false, "enable persistent python, repl, and r kernels in --workspace; repl host.mcp calls this agent's MCP tools; requires approval")
	sciencePython := flag.String("science-python", "python3", "Python interpreter for the python and repl kernels")
	scienceR := flag.String("science-rscript", "Rscript", "Rscript interpreter for the r kernel")
	shellPath := flag.String("shell", "", "absolute shell executable; defaults to /bin/bash on Unix; Windows requires explicit pwsh.exe")
	pdfRenderer := flag.String("pdf-renderer", "", "absolute Poppler pdftoppm path with adjacent pdfinfo; empty auto-detects, '-' disables PDF page rendering")
	deferToolLoading := flag.Bool("defer-tool-loading", false, "declare caller-authorized tools after ToolSearch returns their schemas")
	bashOutputMaxChars := flag.Int("bash-output-max-chars", 0, "plugin Bash inline/readback character override, 1..128000; zero uses Claude defaults and BASH_MAX_OUTPUT_LENGTH")
	bashHostMode := flag.String("bash-host-mode", "unattended", "plugin Bash background deadlines: unattended or explicit interactive")
	disableBashBackground := flag.Bool("disable-bash-background", false, "disable plugin Bash background starts and automatic promotion")
	serviceDirectory := flag.String("service-dir", "", "explicit private environment service directory; enables services surviving agent exit; Unix unsandboxed only; environment must clean up after verification")
	approval := flag.String("approval", "ask", "tool approval policy: never or ask via ACP client")
	budget := bindProviderBudget(flag.CommandLine)
	maxTurnSteps := flag.Int("max-turn-steps", harness.DefaultMaxSteps, "maximum model/tool steps per turn; 0 disables this ceiling (cancellation and provider budgets still apply)")
	outputLimitRecoveries := flag.Int("output-limit-recoveries", 0, "ACP-only attributed follow-up turns after output truncation; 0 returns max_tokens immediately")
	sessionTitles := flag.Bool("session-titles", false, "generate one conversation title after its first completed ACP turn")
	skillRoots := bindSkillRoots(flag.CommandLine)
	pluginConfig := bindPluginOptions(flag.CommandLine)
	compaction := bindCompaction(flag.CommandLine)
	toolHistory := bindToolHistory(flag.CommandLine)
	sandboxOptions := bindSandbox(flag.CommandLine)
	selectable := bindSelectableModels(flag.CommandLine)
	coding := bindCodingOptions(flag.CommandLine)
	engineeringFlags := bindEngineeringOptions(flag.CommandLine)
	delegation := bindSubagents(flag.CommandLine)
	web := bindWebOptions(flag.CommandLine)
	lspConfig := bindLSPOptions(flag.CommandLine)
	research := bindResearchOptions(flag.CommandLine)
	flag.Parse()
	modelProfile, err := loadModelProfile(*modelProfilePath, flag.CommandLine)
	if err != nil {
		return err
	}
	printPrompt := strings.TrimSpace(strings.Join(flag.Args(), " "))
	if !*printMode && flag.NArg() != 0 || strings.TrimSpace(*model) == "" || strings.TrimSpace(*sessions) == "" {
		return errors.New("--model and --session-dir are required; positional arguments require --print")
	}
	if *approval != "never" && *approval != "ask" {
		return errors.New("--approval must be never or ask")
	}
	if *maxTurnSteps < 0 {
		return errors.New("--max-turn-steps must be nonnegative")
	}
	if *outputLimitRecoveries < 0 || *printMode && *outputLimitRecoveries != 0 {
		return errors.New("--output-limit-recoveries must be nonnegative and is only supported in ACP mode")
	}
	if *maxTurnSteps == 0 {
		*maxTurnSteps = harness.UnlimitedMaxSteps
	}
	if *initOnly && *maintenance || *printMode && (*initOnly || *maintenance) {
		return errors.New("--init-only, --maintenance, and --print are mutually exclusive")
	}
	if (*initOnly || *maintenance || *printMode) && *workspace == "" {
		return errors.New("--init-only, --maintenance, and --print require --workspace")
	}
	if (*enableShell || *enableResearchClone) && *workspace == "" {
		return errors.New("--enable-shell / --enable-research-clone requires --workspace")
	}
	if len(pluginConfig.Directories) > 0 && *workspace == "" {
		return errors.New("--plugin-dir requires an explicit --workspace")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	profile, err := configuredResearch(ctx, *research, *sessions, *workspace, *enableShell, web.enabled(), pluginConfig.Models)
	if err != nil {
		return err
	}
	if profile != nil {
		pluginConfig.Directories = append(pluginConfig.Directories, profile.Directory)
	}
	if *bashOutputMaxChars != 0 && len(pluginConfig.Directories) == 0 {
		return errors.New("--bash-output-max-chars requires --plugin-dir or --research-source")
	}
	packages, err := plugins.LoadPackages(ctx, pluginConfig.Directories)
	if err != nil {
		return err
	}
	toolFormat, err := resolveToolFormat(*toolFormatFlag, len(packages) > 0)
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
	engineering, err := engineeringFlags.config()
	if err != nil {
		return err
	}
	if err := delegation.validate(); err != nil {
		return err
	}
	sandboxConfig, err := sandboxOptions.config(*workspace, *enableShell, *approval)
	if err != nil {
		return err
	}
	if *serviceDirectory != "" && (!*enableShell || sandboxConfig != nil) {
		return errors.New("--service-dir requires --enable-shell and an unsandboxed Unix host")
	}
	credential, err := takeProviderCredential(*keyEnv)
	if err != nil {
		return err
	}
	webProvider, err := configuredWeb(*web, *keyEnv, credential)
	if err != nil {
		return err
	}
	if webProvider != nil {
		defer webProvider.Close()
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
	toolHistoryConfig, err := toolHistory.config(*workspace)
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
	h, err := harness.Boot(ctx, harness.Options{EnableSubagents: delegation.Enabled || len(packages) > 0 || web.enabled(), Adapter: adapter, AdapterProviders: []string{"configured"}, ModelInfo: adapter, ApprovalPolicy: harness.ApprovalPolicy(*approval)})
	if err != nil {
		return err
	}
	var native *nativetools.App
	var skillCatalog *skills.Catalog
	var instructions *agentinstructions.App
	var pluginHooks *pluginruntime.HookApp
	var pluginAgents *subagents.ClaudeContribution
	var pluginWorkflows *workflow.App
	var webApp *webtools.App
	var lspApp *lsp.App
	var science *scienceenv.Env
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		disposeErr := h.Dispose(cleanup)
		if disposeErr == harness.ErrHarnessDisposalInProgress {
			// Drain supplies the final receipt for asynchronous disposal.
			disposeErr = nil
		}
		resultErr = errors.Join(resultErr, disposeErr, h.Drain(cleanup), native.Close(), science.Close(), pluginWorkflows.Close(), webApp.Close(), lspApp.Close(), skillCatalog.Close(), instructions.Close(), pluginHooks.Close())
	}()
	spillStore := harness.NewLocalSpillStoreWithOptions(harness.LocalSpillStoreOptions{Root: filepath.Join(*sessions, "tool-output"), RetrievalHint: "Use the current discovery tool with query select:ReadToolOutput if needed, then ReadToolOutput with this exact locator and bounded byte pages."})
	if *workspace != "" {
		if _, err := h.RegisterSpillStore(ctx, "native/tool-output-store", spillStore, harness.SpillPolicyOptions{}); err != nil {
			return err
		}
	}
	skillCatalog, err = skills.OpenSelected(ctx, *skillRoots, selections)
	if err != nil {
		return err
	}
	if *workspace != "" {
		nativeOptions := nativetools.Options{SpillStore: spillStore, Workspace: *workspace, EnableShell: *enableShell, EnableResearchClone: *enableResearchClone, Shell: *shellPath, Sandbox: sandboxConfig, ClaudeTools: toolFormat == "claude", PDFRendererPath: *pdfRenderer, DeferToolLoading: *deferToolLoading, BashEnvFile: func(agent *harness.Agent) string {
			if pluginHooks == nil {
				return ""
			}
			return pluginHooks.BashEnvironmentFile(agent)
		}, OnShellDirectory: func(agent *harness.Agent, old, next string) {
			if pluginHooks == nil {
				return
			}
			pluginHooks.ShellDirectoryChanged(agent, old, next)
		}}
		if len(packages) > 0 {
			nativeOptions.BackgroundNotifications = true
			nativeOptions.ReadOnlyResource = pluginResourceReader(skillCatalog, selections)
			nativeOptions.PluginEnvironment = pluginEnvironment
			nativeOptions.BashOutput.BashOutputMaxChars = *bashOutputMaxChars
			nativeOptions.BashTiming = nativetools.BashTimingOptions{HostMode: nativetools.BashHostMode(*bashHostMode), DisableBackground: *disableBashBackground}
		}
		native, err = nativetools.Mount(ctx, h, nativeOptions)
		if err != nil {
			return err
		}
	}
	if *scienceEnv {
		if *workspace == "" {
			return errors.New("--science-env requires --workspace")
		}
		science, err = scienceenv.Mount(ctx, h, scienceenv.Options{Workspace: *workspace, Python: *sciencePython, Rscript: *scienceR, MCP: scienceenv.AgentMCP(h)})
		if err != nil {
			return err
		}
	}
	if err := charts.Mount(ctx, h, *chartPython); err != nil {
		return err
	}
	if *serviceDirectory != "" {
		if err := mountEnvironmentServices(ctx, h, *serviceDirectory, *workspace, pluginShell, pluginEnvironment, native.CheckCWD); err != nil {
			return err
		}
	}
	instructions, err = mountCoding(ctx, h, *workspace, *coding)
	if err != nil {
		return err
	}
	engineeringApp, err := engineering.mount(ctx, h)
	if err != nil {
		return err
	}
	if skillCatalog != nil {
		mountOptions := skills.MountOptions{Claude: len(packages) > 0}
		if engineering != nil {
			mountOptions.SummaryBudget = skills.SummaryBudget{AdvertisementBytes: 8192, PageBytes: 8192}
		}
		if len(packages) > 0 {
			mountOptions.ActivateHooks = func(_ context.Context, agent *harness.Agent, definition skills.Definition) error {
				if pluginHooks == nil {
					return nil
				}
				origin, _, _ := strings.Cut(definition.Name, ":")
				var root string
				for _, pkg := range packages {
					if pkg.Definition.Name == origin {
						root = pkg.Root
						break
					}
				}
				pluginHooks.ActivateSkillHooks(agent, origin, root, definition.Name, definition.Hooks)
				return nil
			}
			mountOptions.ResolveModel = pluginModelResolver(pluginConfig.Models)
			mountOptions.Fork = func(ctx context.Context, parent *harness.Agent, definition skills.Definition) (harness.SubagentResult, error) {
				origin, _, _ := strings.Cut(definition.Name, ":")
				background := definition.Background != nil && *definition.Background
				invocation := subagents.ClaudeInvocation{
					Definition: definition.Agent, Prompt: definition.Content, Description: "Run " + definition.Name, Model: definition.Model, Effort: definition.Effort, Origin: origin, Background: background, ReportCompletion: background,
					ConfigureChild: func(ctx context.Context, run *point.Run, child *harness.Agent) error {
						return skills.ConfigureFork(ctx, h, run, child, definition)
					},
				}
				if background {
					return pluginAgents.Start(ctx, parent, invocation)
				}
				return pluginAgents.Invoke(ctx, parent, invocation)
			}
			mountOptions.Expand = func(ctx context.Context, agent *harness.Agent, definition skills.Definition, args string) (skills.Definition, error) {
				return pluginruntime.ExpandSkill(ctx, h, agent, definition, args, pluginruntime.ExpansionOptions{Shell: pluginShell, Environment: pluginEnvironment, Sandbox: sandboxConfig})
			}
			mountOptions.GuardSlash = func(ctx context.Context, agent *harness.Agent, name, arguments, prompt string) (string, error) {
				if pluginHooks == nil {
					return "", nil
				}
				return pluginHooks.GuardSlash(ctx, agent, name, arguments, prompt)
			}
		}
		if err := skills.MountCatalog(ctx, h, skillCatalog, mountOptions); err != nil {
			return err
		}
	}
	if err := mountSubagents(ctx, h, persistence, *delegation, compactionConfig); err != nil {
		return err
	}
	if len(packages) > 0 || web.enabled() {
		stateRoot, err := filepath.Abs(filepath.Join(*sessions, "plugin-hooks"))
		if err != nil {
			return err
		}
		// Command hooks stay host processes (Claude parity). The Bash sandbox
		// still confines model shell calls independently.
		pluginHooks, err = pluginruntime.MountHooks(ctx, h, packages, pluginruntime.HookOptions{ResolveModel: pluginModelResolver(pluginConfig.Models), Shell: pluginShell, Environment: pluginEnvironment, StateDirectory: stateRoot, Retain: true, EmitTerminal: writeControllingTerminal, ReportStatus: func(agent *harness.Agent, message string) {
			if agent == nil || agent.Session() == nil {
				return
			}
			_, _ = agent.Session().Append("hook/status", map[string]string{"message": message})
		}, ReloadSkills: func(ctx context.Context) error {
			if skillCatalog == nil {
				return nil
			}
			return skillCatalog.Rescan(ctx)
		}, RunAgent: func(ctx context.Context, parent *harness.Agent, prompt, model string) (string, error) {
			if pluginAgents == nil {
				return "", errors.New("agent hooks require mounted subagents")
			}
			steps := 50
			if limit := parent.MaxSteps(); limit > 0 && limit < steps {
				steps = limit
			}
			result, err := pluginAgents.Invoke(ctx, parent, subagents.ClaudeInvocation{
				Definition: "Explore", Prompt: prompt, Description: "Agent hook", Model: model, MaxSteps: steps,
			})
			if err != nil {
				return "", err
			}
			var text []string
			for _, block := range result.ParentContent() {
				if block.Text != "" {
					text = append(text, block.Text)
				}
			}
			if len(text) == 0 && result.Diagnostic != "" {
				return "", errors.New(result.Diagnostic)
			}
			return strings.Join(text, "\n"), nil
		}})
		if err != nil {
			return err
		}
		if _, err := pluginruntime.MountMCP(ctx, h, packages, pluginEnvironment, pluginHooks); err != nil {
			return err
		}
		if _, err := tasks.Mount(ctx, h); err != nil {
			return err
		}
		memoryPresentation := subagents.MemoryPresentation("")
		if engineering != nil {
			memoryPresentation = subagents.MemoryAsContext
		}
		pluginAgents, err = subagents.MountClaude(ctx, h, agentDefinitions, subagents.ClaudeOptions{MemoryPresentation: memoryPresentation, SkillText: func(ctx context.Context, name string) (string, error) {
			if skillCatalog == nil {
				return "", errors.New("agent skills require a selected skill catalog")
			}
			return skillCatalog.Preload(ctx, name)
		}, IsolatedWorktree: func(ctx context.Context, parent *harness.Agent) (string, func(), error) {
			if pluginHooks == nil {
				return "", nil, subagents.ErrDefaultWorktree
			}
			return pluginHooks.CreateIsolatedWorktree(ctx, parent)
		}, TaskLookup: func(ctx context.Context, parent *harness.Agent, id string) (harness.TaskHandle, bool, error) {
			if task, found, err := native.LookupTask(ctx, parent, id); found || err != nil {
				return task, found, err
			}
			return pluginWorkflows.LookupTask(ctx, parent, id)
		}, InvocationOrigin: skills.ActivePlugin, ModelRoutes: pluginConfig.Models, MaxDepth: 4, MaxActive: delegation.MaxActive, Persistence: persistence, Compaction: compactionConfig, LegacyTaskAlias: profile != nil, BackgroundNotifications: profile != nil})
		if err != nil {
			return err
		}
		if workflow.HasScripts(packages) {
			node, err := exec.LookPath(*workflowNode)
			if err != nil {
				return errors.New("selected plugin workflows require Node; configure --workflow-node")
			}
			node, err = filepath.Abs(node)
			if err != nil {
				return err
			}
			pluginWorkflows, err = workflow.Mount(ctx, h, packages, workflow.Options{Node: node, Provider: "configured", Agents: pluginAgents, MaxConcurrentAgents: 3, MaxAgentCalls: 64})
			if err != nil {
				return err
			}
		}
	}
	webApp, err = mountWeb(ctx, h, webProvider, pluginAgents)
	if err != nil {
		return err
	}
	lspApp, err = mountLSP(ctx, h, *workspace, packages, pluginEnvironment, *lspConfig)
	if err != nil {
		return err
	}
	if err := mountToolHistory(ctx, h, toolHistoryConfig); err != nil {
		return err
	}
	if err := mountLaunchReceipt(ctx, h, launchReceipt{ModelProfile: modelProfile, ToolFormat: toolFormat, APIFormat: budget.APIFormat, StreamingDisabled: budget.DisableStreaming, ReasoningEffort: budget.ReasoningEffort, Model: *model, ContextWindow: compaction.ContextWindow, MaxOutputTokens: budget.MaxTokens, ThinkingDisabled: budget.DisableThinking, ImageInput: budget.ImageInput, MaxTurnSteps: *maxTurnSteps, RequestTimeoutMS: budget.RequestTimeoutMS, Compaction: compactionConfig, EnvironmentServices: *serviceDirectory != "", OutputLimitRecoveries: *outputLimitRecoveries}); err != nil {
		return err
	}
	if *initOnly || *maintenance {
		trigger := "init"
		if *maintenance {
			trigger = "maintenance"
		}
		agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "plugin-init", CWD: *workspace, Provider: "configured", Model: *model, MaxSteps: *maxTurnSteps})
		if err != nil {
			return err
		}
		if pluginHooks != nil {
			if err := pluginHooks.RunSetup(ctx, agent, trigger); err != nil {
				return err
			}
		}
		return nil
	}
	if *printMode {
		return runPrintPrepared(ctx, h, pluginHooks, *model, *workspace, printPrompt, harness.AgentOptions{MaxSteps: *maxTurnSteps, Compaction: compactionConfig}, engineering.preparePrompt(engineeringApp))
	}
	serverOptions := acp.Options{SessionTitles: *sessionTitles, UserQuestions: len(packages) > 0, ModelSelection: len(*selectable) != 0, Compaction: compactionConfig, Harness: h, Persistence: persistence, Provider: "configured", Model: *model, MaxSteps: *maxTurnSteps, Name: "pero-agent-acp", Version: "0.1"}
	serverOptions.OutputLimitRecoveries = *outputLimitRecoveries
	serverOptions.PreparePrompt = engineering.preparePrompt(engineeringApp)
	if pluginHooks != nil {
		serverOptions.HoldAssistantText = func(*harness.Agent) bool { return pluginHooks.HoldsAssistantText() }
		serverOptions.RenderAssistantText = pluginHooks.DisplayedAssistantText
	}
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
	APIFormat           string
	DisableStreaming    bool
	DisableThinking     bool
	UseEnvironmentProxy bool
	AllowHTTP           bool
	ImageInput          bool
	MaxRequests         int
	MaxTokens           int
	MaxRetries          int
	ReasoningEffort     string
	RequestTimeoutMS    int64
}

func bindProviderBudget(flags *flag.FlagSet) *providerBudget {
	budget := &providerBudget{}
	flags.StringVar(&budget.APIFormat, "api-format", "chat-completions", "provider protocol: chat-completions or responses (Responses requires --disable-streaming)")
	flags.BoolVar(&budget.DisableStreaming, "disable-streaming", false, "request a complete JSON response instead of SSE; no automatic transport fallback")
	flags.BoolVar(&budget.DisableThinking, "disable-thinking", false, "explicitly send thinking.type=disabled to a compatible provider")
	flags.BoolVar(&budget.UseEnvironmentProxy, "use-env-proxy", false, "opt in to standard HTTP(S)_PROXY/NO_PROXY routing; TLS verification remains enabled")
	flags.BoolVar(&budget.AllowHTTP, "allow-http", false, "allow plaintext HTTP for the explicitly configured provider endpoint")
	flags.BoolVar(&budget.ImageInput, "image-input", false, "declare this model supports bounded in-memory PNG/JPEG input; never fetch remote image URLs or local paths")
	flags.IntVar(&budget.MaxRequests, "max-requests", 0, "hard provider HTTP attempt cap for this process (0 keeps unlimited)")
	flags.IntVar(&budget.MaxTokens, "max-tokens", 0, "hard per-request output token cap (0 keeps provider default)")
	flags.IntVar(&budget.MaxRetries, "max-retries", -1, "provider recovery retry count (0 disables; -1 preserves default)")
	flags.StringVar(&budget.ReasoningEffort, "reasoning-effort", "", "explicit provider reasoning effort/default; omitted preserves existing behavior")
	flags.Int64Var(&budget.RequestTimeoutMS, "request-timeout-ms", 0, "optional total provider request deadline, including continuous slow streams; 0 keeps the outer task deadline; no default retry on expiry")
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
	config := openai.Config{APIFormat: openai.APIFormat(budget.APIFormat), Endpoint: endpoint, APIKey: credential, ProviderName: "configured", Models: []openai.ModelConfig{declared}, MaxRequests: budget.MaxRequests, MaxOutputTokens: budget.MaxTokens, UseEnvironmentProxy: budget.UseEnvironmentProxy, AllowHTTP: budget.AllowHTTP, DisableThinking: budget.DisableThinking, DisableStreaming: budget.DisableStreaming}
	config.RequestTimeoutMS = budget.RequestTimeoutMS
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
