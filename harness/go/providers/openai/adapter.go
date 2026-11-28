// Package openai provides explicit OpenAI-compatible chat completions with
// optional bounded in-memory raster input for declared image-capable models.
// Streaming assembly is adapted from the pinned DSH port; product routing,
// telemetry, identity persistence, Files uploads and settings discovery are absent.
package openai

import (
	"context"
	"errors"
	"fmt"
	openaisdk "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/responses"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/llm"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync/atomic"
	"time"
)

var errStreamClosed = errors.New("SSE stream ended without [DONE]")

type APIFormat string

const (
	ChatCompletions  APIFormat = "chat-completions"
	Responses        APIFormat = "responses"
	DeepSeekMessages APIFormat = "deepseek-messages"
)

type ModelConfig struct {
	ID, Name, Description    string
	ContextWindow, MaxTokens int
	InputModalities          []string
	Reasoning                *llm.ModelReasoningInfo
}
type Config struct {
	APIFormat APIFormat
	// A 32-byte local secret explicitly enables signed Messages thinking.
	// It scopes replay to this endpoint, provider and credential. Do not reuse
	// the API key itself or send this secret to the provider.
	MessagesReplayKey []byte
	// Both fields explicitly enable raster-only Files uploads. The directory
	// must be owner-controlled and the key must not be the provider credential.
	MessagesFilesDirectory string
	MessagesFilesKey       []byte
	// Separately opt in to bounded deletion of near-expiry, locally proven uploads.
	MessagesFilesReclaim bool
	// Explicit compatible-provider extension; omitted unless requested.
	DisableThinking bool
	// Explicit transport choice for compatible providers without an SSE route.
	DisableStreaming bool
	// Explicit opt-in to the process environment HTTP(S) proxy; TLS verification is unchanged.
	UseEnvironmentProxy bool
	// Explicit opt-in to plaintext HTTP for this configured endpoint only.
	AllowHTTP bool
	// Optional audit gate called before each HTTP attempt. An error prevents it.
	BeforeHTTPAttempt func() error
	// Optional adapter-lifetime hard limits. Zero preserves unlimited behavior.
	MaxRequests                    int
	MaxOutputTokens                int
	Endpoint, APIKey, ProviderName string
	Models                         []ModelConfig
	Client                         *http.Client
	RetryPolicy                    *llm.RetryPolicyConfig
	StreamIdleTimeoutMS            int64
	RequestTimeoutMS               int64
}
type Adapter struct {
	apiFormat                APIFormat
	responses                responses.ResponseService
	messagesClient           *http.Client
	messagesURL, messagesKey string
	messagesReplayScope      string
	messagesFiles            *messagesFiles
	disableThinking          bool
	disableStreaming         bool
	maxRequests              int64
	maxOutputTokens          int
	requests                 atomic.Int64
	client                   openaisdk.ChatCompletionService
	models                   map[string]ModelConfig
	providerName             string
	retryPolicy              llm.ResolvedRetryPolicy
	streamIdleTimeout        time.Duration
	requestTimeout           time.Duration
}

func New(c Config) (*Adapter, error) {
	if c.APIFormat == "" {
		c.APIFormat = ChatCompletions
	}
	if c.APIFormat != ChatCompletions && c.APIFormat != Responses && c.APIFormat != DeepSeekMessages {
		return nil, errors.New("openai adapter: unsupported API format")
	}
	if c.APIFormat == Responses && (!c.DisableStreaming || c.DisableThinking) {
		return nil, errors.New("openai adapter: Responses requires disable-streaming and does not accept the Chat thinking extension")
	}
	if c.APIFormat == DeepSeekMessages && c.DisableStreaming {
		return nil, errors.New("messages adapter: this protocol requires streaming")
	}
	if c.MessagesReplayKey != nil && (len(c.MessagesReplayKey) != 32 || c.APIFormat != DeepSeekMessages || c.DisableThinking) {
		return nil, errors.New("messages adapter: signed thinking requires DeepSeek Messages, a 32-byte local replay key and thinking not disabled")
	}
	if c.MessagesFilesDirectory != "" || c.MessagesFilesKey != nil || c.MessagesFilesReclaim {
		if c.APIFormat != DeepSeekMessages || !filepath.IsAbs(c.MessagesFilesDirectory) || len(c.MessagesFilesKey) != 32 {
			return nil, errors.New("messages adapter: Files requires DeepSeek Messages, a private absolute directory and a 32-byte scope key")
		}
	}
	if c.MaxRequests < 0 || c.MaxOutputTokens < 0 {
		return nil, errors.New("openai adapter: budget limits must be non-negative")
	}
	u, err := url.Parse(c.Endpoint)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("openai adapter: explicit endpoint without userinfo/query/fragment required")
	}
	if u.Scheme != "https" {
		ip := net.ParseIP(u.Hostname())
		if u.Scheme != "http" || (!c.AllowHTTP && (ip == nil || !ip.IsLoopback())) {
			return nil, errors.New("openai adapter: HTTPS required except loopback fixtures; explicit HTTP requires allow-http")
		}
	}
	if strings.TrimSpace(c.APIKey) == "" || strings.TrimSpace(c.ProviderName) == "" || len(c.Models) == 0 {
		return nil, errors.New("openai adapter: explicit credential, provider and model catalog required")
	}
	if c.APIFormat == DeepSeekMessages {
		// Accept the official /anthropic base, a /v1 base, or the exact endpoint.
		p := strings.TrimSuffix(u.Path, "/")
		if !strings.HasSuffix(p, "/v1/messages") {
			p = strings.TrimSuffix(p, "/v1") + "/v1/messages"
		}
		u.Path, u.RawPath = p, ""
	} else {
		u.Path = strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(u.Path, "/"), "/chat/completions"), "/responses") + "/"
	}
	models := map[string]ModelConfig{}
	for _, m := range c.Models {
		if m.ID == "" || m.ContextWindow < 0 || m.MaxTokens < 0 {
			return nil, errors.New("openai adapter: invalid model declaration")
		}
		if _, ok := models[m.ID]; ok {
			return nil, errors.New("openai adapter: duplicate model")
		}
		textInput, imageInput := len(m.InputModalities) == 0, false
		for _, v := range m.InputModalities {
			switch v {
			case "text":
				textInput = true
			case "image":
				imageInput = true
			default:
				return nil, errors.New("openai adapter: unsupported input modality")
			}
		}
		if c.APIFormat == DeepSeekMessages && (m.Reasoning != nil || (m.MaxTokens == 0 && c.MaxOutputTokens == 0)) {
			return nil, errors.New("messages adapter: model without configured reasoning and an explicit max-tokens limit required")
		}
		if !textInput {
			return nil, errors.New("openai adapter: text input must remain enabled")
		}
		m.InputModalities = []string{"text"}
		if imageInput {
			m.InputModalities = append(m.InputModalities, "image")
		}
		if m.Name == "" {
			m.Name = m.ID
		}
		if m.Reasoning != nil {
			clone := *m.Reasoning
			clone.Efforts = append([]llm.ReasoningEffortInfo(nil), m.Reasoning.Efforts...)
			m.Reasoning = &clone
		}
		models[m.ID] = m
	}
	policy, err := llm.ResolveRetryPolicy(c.RetryPolicy)
	if err != nil {
		return nil, err
	}
	if c.APIFormat == DeepSeekMessages && (policy.Mode == llm.RetryAlways || slices.Contains(policy.RetryableCodes, harness.StreamClosedCode)) {
		return nil, errors.New("messages adapter: retry policy must not replay an incomplete stream")
	}
	if c.StreamIdleTimeoutMS == 0 {
		c.StreamIdleTimeoutMS = 300000
	}
	if c.StreamIdleTimeoutMS < 1 || c.StreamIdleTimeoutMS > 2147483647 {
		return nil, errors.New("openai adapter: invalid idle timeout")
	}
	if c.RequestTimeoutMS < 0 || c.RequestTimeoutMS > 2147483647 {
		return nil, errors.New("openai adapter: invalid total request timeout")
	}
	client := http.Client{}
	if c.Client != nil {
		client = *c.Client
	}
	// Redirects cannot move credentials or prompt bodies to a different destination.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	transport := client.Transport
	if transport == nil {
		transport = configuredTransport(c.UseEnvironmentProxy)
	}
	client.Transport = terminalCheckingTransport{next: transport, nonStreaming: c.DisableStreaming, messages: c.APIFormat == DeepSeekMessages}
	if c.BeforeHTTPAttempt != nil {
		client.Transport = attemptAuditTransport{next: client.Transport, before: c.BeforeHTTPAttempt}
	}
	sdkOptions := []option.RequestOption{option.WithAPIKey(c.APIKey), option.WithBaseURL(u.String()), option.WithHTTPClient(&client), option.WithMaxRetries(0), option.WithOrganization(""), option.WithProject(""), option.WithHeader("User-Agent", "pero-agent/0.1")}
	adapter := &Adapter{apiFormat: c.APIFormat, disableThinking: c.DisableThinking, disableStreaming: c.DisableStreaming, maxRequests: int64(c.MaxRequests), maxOutputTokens: c.MaxOutputTokens, models: models, providerName: c.ProviderName, retryPolicy: policy, streamIdleTimeout: time.Duration(c.StreamIdleTimeoutMS) * time.Millisecond, requestTimeout: time.Duration(c.RequestTimeoutMS) * time.Millisecond}
	if c.APIFormat == DeepSeekMessages {
		adapter.messagesClient, adapter.messagesURL, adapter.messagesKey = &client, u.String(), c.APIKey
		if c.MessagesReplayKey != nil {
			adapter.messagesReplayScope = messagesReplayScope(c.MessagesReplayKey, u.String(), c.ProviderName, c.APIKey)
		}
		if c.MessagesFilesDirectory != "" {
			filesClient := client
			filesClient.Transport = terminalCheckingTransport{next: transport, nonStreaming: true}
			if c.BeforeHTTPAttempt != nil {
				filesClient.Transport = attemptAuditTransport{next: filesClient.Transport, before: c.BeforeHTTPAttempt}
			}
			filesURL := strings.TrimSuffix(u.String(), "/messages") + "/files"
			scope := messagesReplayScope(c.MessagesFilesKey, filesURL, c.ProviderName, c.APIKey)
			adapter.messagesFiles = &messagesFiles{client: &filesClient, url: filesURL, root: filepath.Join(c.MessagesFilesDirectory, scope), reclaim: c.MessagesFilesReclaim}
		}
	} else {
		adapter.client = openaisdk.NewChatCompletionService(sdkOptions...)
		adapter.responses = responses.NewResponseService(sdkOptions...)
	}
	return adapter, nil
}

type attemptAuditTransport struct {
	next   http.RoundTripper
	before func() error
}

func (t attemptAuditTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if err := t.before(); err != nil {
		return nil, errors.New("openai adapter: HTTP attempt audit failed")
	}
	return t.next.RoundTrip(request)
}

func (a *Adapter) ResolveModelInfo(_ context.Context, provider, model string) (llm.ModelInfo, error) {
	m, ok := a.models[model]
	if !ok || provider != a.providerName {
		return llm.ModelInfo{}, fmt.Errorf("openai adapter: unconfigured provider/model")
	}
	var reasoning *llm.ModelReasoningInfo
	if m.Reasoning != nil {
		r := *m.Reasoning
		r.Efforts = append([]llm.ReasoningEffortInfo(nil), r.Efforts...)
		reasoning = &r
	}
	return llm.ModelInfo{Provider: provider, Model: model, Name: m.Name, Description: m.Description, InputModalities: append([]string(nil), m.InputModalities...), ContextWindow: m.ContextWindow, DefaultMaxTokens: m.MaxTokens, Reasoning: reasoning}, nil
}
func (a *Adapter) RetryPolicyForProvider(provider string) (llm.ResolvedRetryPolicy, bool) {
	p := a.retryPolicy
	p.RetryableCodes = append([]string(nil), p.RetryableCodes...)
	return p, provider == a.providerName
}
func (a *Adapter) PrepareAdapterCall(ctx context.Context, provider, model string) (harness.PreparedAdapterCall, error) {
	info, err := a.ResolveModelInfo(ctx, provider, model)
	if err != nil {
		return harness.PreparedAdapterCall{}, err
	}
	p, _ := a.RetryPolicyForProvider(provider)
	return harness.PreparedAdapterCall{ModelInfo: info, RetryPolicy: &p, Generate: a.Generate}, nil
}

// Preserve system/standard SSL_CERT_FILE trust; never weaken TLS for proxies.
func configuredTransport(useEnvironmentProxy bool) *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	if useEnvironmentProxy {
		transport.Proxy = http.ProxyFromEnvironment
	}
	return transport
}

// ListModels returns only the operator-supplied catalog; it never discovers models
// remotely or reads credentials/settings. The provider registry validates it.
func (a *Adapter) ListModels(_ context.Context, provider string) ([]harness.ModelCatalogEntry, error) {
	if provider != a.providerName {
		return nil, errors.New("openai adapter: unconfigured provider")
	}
	result := make([]harness.ModelCatalogEntry, 0, len(a.models))
	for _, m := range a.models {
		result = append(result, harness.ModelCatalogEntry{Provider: provider, ID: m.ID, Name: m.Name, Description: m.Description, InputModalities: append([]string(nil), m.InputModalities...)})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}
