// pero-agent-acp runs the extracted agent loop over ACP stdio, without product services.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/phodal/pero/harness/go/acp"
	"github.com/phodal/pero/harness/go/agentinstructions"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	"github.com/phodal/pero/harness/go/providers/openai"
	"github.com/phodal/pero/harness/go/skills"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() (resultErr error) {
	endpoint := flag.String("endpoint", "", "explicit OpenAI-compatible HTTPS endpoint (loopback HTTP allowed)")
	model := flag.String("model", "", "explicit provider model ID")
	sessions := flag.String("session-dir", "", "private directory for durable JSONL sessions (required)")
	keyEnv := flag.String("api-key-env", "AGENT_PROVIDER_API_KEY", "environment variable containing the provider credential")
	workspace := flag.String("workspace", "", "explicit native file tool authority root; absent disables native tools")
	enableShell := flag.Bool("enable-shell", false, "enable approved shell execution (unsandboxed unless --sandbox supplied; requires --workspace)")
	shellPath := flag.String("shell", "/bin/bash", "absolute Bash executable for explicitly enabled shell")
	approval := flag.String("approval", "ask", "tool approval policy: never or ask via ACP client")
	budget := bindProviderBudget(flag.CommandLine)
	skillRoots := bindSkillRoots(flag.CommandLine)
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
	if *enableShell && *workspace == "" {
		return errors.New("--enable-shell requires --workspace")
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
	providerConfig, err := configuredProvider(*endpoint, *model, credential, *budget)
	if err != nil {
		return err
	}
	compactionConfig, err := configuredCompaction(&providerConfig, *compaction)
	if err != nil {
		return err
	}
	if err := configureSelectableModels(&providerConfig, *selectable); err != nil {
		return err
	}
	adapter, err := openai.New(providerConfig)
	if err != nil {
		return err
	}
	persistence, err := harness.NewJSONLSessionPersistence(*sessions)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	h, err := harness.Boot(ctx, harness.Options{EnableSubagents: delegation.Enabled, Adapter: adapter, AdapterProviders: []string{"configured"}, ModelInfo: adapter, ApprovalPolicy: harness.ApprovalPolicy(*approval)})
	if err != nil {
		return err
	}
	var native *nativetools.App
	var skillCatalog *skills.Catalog
	var instructions *agentinstructions.App
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		resultErr = errors.Join(resultErr, h.Dispose(cleanup), h.Drain(cleanup), native.Close(), skillCatalog.Close(), instructions.Close())
	}()
	if *workspace != "" {
		native, err = nativetools.Mount(ctx, h, nativetools.Options{Workspace: *workspace, EnableShell: *enableShell, Shell: *shellPath, Sandbox: sandboxConfig})
		if err != nil {
			return err
		}
	}
	instructions, err = mountCoding(ctx, h, *workspace, *coding)
	if err != nil {
		return err
	}
	skillCatalog, err = skills.Mount(ctx, h, *skillRoots)
	if err != nil {
		return err
	}
	if err := mountSubagents(ctx, h, persistence, *delegation, compactionConfig); err != nil {
		return err
	}
	serverOptions := acp.Options{ModelSelection: len(*selectable) != 0, Compaction: compactionConfig, Harness: h, Persistence: persistence, Provider: "configured", Model: *model, Name: "pero-agent-acp", Version: "0.1"}
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
	MaxRequests         int
	MaxTokens           int
	MaxRetries          int
	ReasoningEffort     string
}

func bindProviderBudget(flags *flag.FlagSet) *providerBudget {
	budget := &providerBudget{}
	flags.BoolVar(&budget.DisableThinking, "disable-thinking", false, "explicitly send thinking.type=disabled to a compatible provider")
	flags.BoolVar(&budget.UseEnvironmentProxy, "use-env-proxy", false, "opt in to standard HTTP(S)_PROXY/NO_PROXY routing; TLS verification remains enabled")
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
