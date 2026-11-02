package webtools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const DefaultEndpoint = "https://api.deepseek.com/v1/tools"

var ErrRequestBudget = errors.New("webtools: web HTTP request budget exhausted")

// Provider is replaceable retrieval, independent of the agent's model route.
// Close releases idle transport resources after owned calls have drained.
type Provider interface {
	Search(context.Context, SearchQuery) (SearchResult, error)
	Fetch(context.Context, PageURL) (Page, error)
	Close() error
}

type DeepSeekOptions struct {
	Endpoint, APIKey string
	MaxRequests      int
	Client           *http.Client
}

type DeepSeek struct {
	endpoint, key string
	client        *http.Client
	mu            sync.Mutex
	remaining     int
}

func NewDeepSeek(options DeepSeekOptions) (*DeepSeek, error) {
	endpoint := options.Endpoint
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" {
		return nil, errors.New("webtools: endpoint must be an absolute HTTPS URL without credentials, query or fragment")
	}
	loopback := parsed.Hostname() == "localhost"
	if ip := net.ParseIP(parsed.Hostname()); ip != nil {
		loopback = ip.IsLoopback()
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) {
		return nil, errors.New("webtools: endpoint requires HTTPS; HTTP is allowed only for loopback fixtures")
	}
	if strings.TrimSpace(options.APIKey) == "" || strings.ContainsAny(options.APIKey, "\x00\r\n") {
		return nil, errors.New("webtools: an explicit web provider credential is required")
	}
	if options.MaxRequests < 1 {
		return nil, errors.New("webtools: MaxRequests must be positive")
	}
	client := http.Client{Timeout: 5 * time.Minute}
	if options.Client != nil {
		client = *options.Client
	}
	if client.Transport == nil {
		client.Transport = http.DefaultTransport.(*http.Transport).Clone()
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if client.Timeout == 0 {
		client.Timeout = 5 * time.Minute
	}
	return &DeepSeek{endpoint: strings.TrimRight(parsed.String(), "/"), key: options.APIKey, client: &client, remaining: options.MaxRequests}, nil
}

func (p *DeepSeek) Search(ctx context.Context, query SearchQuery) (SearchResult, error) {
	request := struct {
		Query       string `json:"query"`
		Count       int    `json:"count"`
		NeedContent bool   `json:"need_content"`
	}{query.ProviderQuery(), MaxSources, false}
	var response struct {
		Results *[]struct {
			URL     *string `json:"url"`
			Title   *string `json:"title"`
			Snippet *string `json:"snippet"`
			Summary *string `json:"summary"`
			Date    *string `json:"date"`
		} `json:"results"`
	}
	if err := p.post(ctx, "search", request, &response); err != nil {
		return SearchResult{}, err
	}
	if response.Results == nil {
		return SearchResult{}, errors.New("webtools: provider returned invalid search results")
	}
	sources := make([]Source, 0, len(*response.Results))
	for _, item := range *response.Results {
		if item.URL == nil || *item.URL == "" || item.Title == nil || item.Snippet == nil || item.Summary == nil {
			return SearchResult{}, errors.New("webtools: provider returned invalid search results")
		}
		source := Source{URL: *item.URL, Title: *item.Title, Snippet: *item.Snippet, Summary: *item.Summary}
		if item.Date != nil {
			source.PublishedAt = *item.Date
		}
		sources = append(sources, source)
	}
	return query.Select(sources), nil
}

func (p *DeepSeek) Fetch(ctx context.Context, target PageURL) (Page, error) {
	var response struct {
		Title   *string `json:"title"`
		Content *string `json:"content"`
	}
	if err := p.post(ctx, "fetch", struct {
		URL string `json:"url"`
	}{target.String()}, &response); err != nil {
		return Page{}, err
	}
	if response.Title == nil || response.Content == nil {
		return Page{}, errors.New("webtools: provider returned an invalid fetched page")
	}
	return Page{Title: *response.Title, Markdown: *response.Content}, nil
}

// One tool request makes one credential-bearing HTTP attempt. Redirects, error
// bodies and transport diagnostics are never copied into model-visible errors.
func (p *DeepSeek) post(ctx context.Context, operation string, value, response any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	body, err := json.Marshal(value)
	if err != nil {
		return errors.New("webtools: could not encode provider request")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint+"/"+operation, bytes.NewReader(body))
	if err != nil {
		return errors.New("webtools: could not prepare provider request")
	}
	request.Header.Set("Authorization", "Bearer "+p.key)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	p.mu.Lock()
	if err := ctx.Err(); err != nil {
		p.mu.Unlock()
		return err
	}
	if p.remaining == 0 {
		p.mu.Unlock()
		return ErrRequestBudget
	}
	p.remaining--
	p.mu.Unlock()
	result, err := p.client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("webtools: provider request failed")
	}
	defer result.Body.Close()
	if result.StatusCode != http.StatusOK {
		return fmt.Errorf("webtools: provider returned HTTP %d", result.StatusCode)
	}
	const limit = 8 << 20
	raw, err := io.ReadAll(io.LimitReader(result.Body, limit+1))
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("webtools: provider response could not be read")
	}
	if len(raw) > limit {
		return errors.New("webtools: provider response exceeds 8 MiB")
	}
	if err := json.Unmarshal(raw, response); err != nil {
		return errors.New("webtools: provider returned invalid JSON")
	}
	return nil
}

func (p *DeepSeek) Close() error { p.client.CloseIdleConnections(); return nil }
