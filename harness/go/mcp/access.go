package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	harnesstool "github.com/phodal/pero/harness/go/tool"
)

// SessionAccess projects the same live connections owned by MountConnection.
// It never starts a transport and never exposes transport configuration.
type SessionAccess struct {
	mu      sync.RWMutex
	servers map[string]accessServer
}
type accessServer struct {
	generation uint64
	catalog    uint64
	session    *sdk.ClientSession
	tools      []*sdk.Tool
	apps       map[string]Tool
	timeout    time.Duration
}
type AccessServer struct {
	Name       string      `json:"name"`
	Generation uint64      `json:"generation"`
	Connected  bool        `json:"connected"`
	Tools      []*sdk.Tool `json:"tools"`
}

func NewSessionAccess() *SessionAccess { return &SessionAccess{servers: make(map[string]accessServer)} }
func (a *SessionAccess) Publish(name string, generation uint64, session *sdk.ClientSession, tools []*sdk.Tool, apps []Tool, timeout time.Duration) {
	a.mu.Lock()
	defer a.mu.Unlock()
	entry := accessServer{generation: generation, catalog: a.servers[name].catalog + 1, session: session, tools: tools, apps: make(map[string]Tool), timeout: timeout}
	for _, tool := range apps {
		entry.apps[tool.Name] = tool
	}
	a.servers[name] = entry
}
func (a *SessionAccess) Disconnect(name string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	entry := a.servers[name]
	entry.session = nil
	entry.apps = nil
	entry.tools = nil
	a.servers[name] = entry
}
func (a *SessionAccess) List() []AccessServer {
	a.mu.RLock()
	defer a.mu.RUnlock()
	result := make([]AccessServer, 0, len(a.servers))
	for name, entry := range a.servers {
		tools := make([]*sdk.Tool, 0, len(entry.tools))
		for _, tool := range entry.tools {
			// Only UI discovery metadata is needed by the frame host.
			meta := sdk.Meta{}
			for _, key := range []string{"ui", "ui/resourceUri"} {
				if value, exists := tool.Meta[key]; exists && value != nil {
					meta[key] = value
				}
			}
			tools = append(tools, &sdk.Tool{Name: tool.Name, Description: tool.Description, InputSchema: tool.InputSchema, Meta: meta})
		}
		result = append(result, AccessServer{Name: name, Generation: entry.generation, Connected: entry.session != nil, Tools: tools})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result
}
func (a *SessionAccess) current(name string, generation uint64) (accessServer, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	entry, ok := a.servers[name]
	if !ok || entry.session == nil || generation == 0 || entry.generation != generation {
		return accessServer{}, errors.New("MCP connection is unavailable or has changed")
	}
	return entry, nil
}
func (a *SessionAccess) Check(name string, generation uint64) error {
	_, err := a.current(name, generation)
	return err
}
func (a *SessionAccess) AppTool(server string, generation uint64, name, resource string, opening bool) (Tool, string, error) {
	entry, err := a.current(server, generation)
	if err != nil {
		return Tool{}, "", err
	}
	tool, ok := entry.apps[name]
	if !ok {
		return Tool{}, "", errors.New("tool is not available to this MCP App")
	}
	var uri string
	for _, remote := range entry.tools {
		if remote.Name == name {
			uri = appResource(remote.Meta)
			break
		}
	}
	if opening && uri == "" || !opening && uri != "" && uri != resource {
		return Tool{}, "", errors.New("tool is outside the MCP App resource binding")
	}
	// Recheck after approval, immediately before the business call. Never replay.
	execute := tool.Execute
	tool.Execute = func(ctx context.Context, raw json.RawMessage) (result harnesstool.Result, err error) {
		current, checkErr := a.current(server, generation)
		if checkErr != nil {
			return result, checkErr
		}
		if current.catalog != entry.catalog {
			return result, errors.New("MCP tool catalog changed while awaiting approval")
		}
		return execute(ctx, raw)
	}
	return tool, uri, nil
}

// Request reads a resource from exactly the selected live generation.
func (a *SessionAccess) Request(ctx context.Context, server string, generation uint64, action, cursor, uri string) (json.RawMessage, error) {
	entry, err := a.current(server, generation)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, entry.timeout)
	defer cancel()
	var result any
	switch action {
	case "resources":
		result, err = entry.session.ListResources(ctx, &sdk.ListResourcesParams{Cursor: cursor})
	case "templates":
		result, err = entry.session.ListResourceTemplates(ctx, &sdk.ListResourceTemplatesParams{Cursor: cursor})
	case "read", "resource":
		if strings.TrimSpace(uri) == "" || len(uri) > 8192 {
			return nil, errors.New("invalid MCP resource URI")
		}
		result, err = entry.session.ReadResource(ctx, &sdk.ReadResourceParams{URI: uri})
	default:
		return nil, errors.New("unsupported MCP resource action")
	}
	if err != nil {
		return nil, SafeError(err)
	}
	if err = a.Check(server, generation); err != nil {
		return nil, err
	}
	return BoundedAccessResult(result)
}
func BoundedAccessResult(value any) (json.RawMessage, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if len(raw) > 1<<20 {
		return nil, errors.New("MCP response exceeds 1 MiB")
	}
	return raw, nil
}
func appResource(meta sdk.Meta) string {
	ui, _ := meta["ui"].(map[string]any)
	uri, _ := ui["resourceUri"].(string)
	if uri == "" {
		uri, _ = meta["ui/resourceUri"].(string)
	}
	return uri
}
func appVisible(meta sdk.Meta) bool {
	ui, ok := meta["ui"].(map[string]any)
	if !ok {
		return meta["ui"] == nil
	}
	raw, present := ui["visibility"]
	if !present {
		return true
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return false
	}
	var audiences []string
	if json.Unmarshal(data, &audiences) != nil || len(audiences) == 0 {
		return false
	}
	visible := false
	for _, audience := range audiences {
		if audience != "app" && audience != "model" {
			return false
		}
		visible = visible || audience == "app"
	}
	return visible
}
