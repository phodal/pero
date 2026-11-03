package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync/atomic"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ResourceDirectory is the set of configured MCP servers that share the three
// resource tools. A dropped connection clears the live session and leaves the
// server name in place, so the tools and prompt stay until the mount is disposed.
type ResourceDirectory struct {
	endpoints map[string]*resourceEndpoint
}

type resourceEndpoint struct {
	session atomic.Pointer[mcp.ClientSession]
	timeout time.Duration
}

// NewResourceDirectory records one configured server. The map is not mutated later.
func NewResourceDirectory(servers map[string]time.Duration) *ResourceDirectory {
	endpoints := make(map[string]*resourceEndpoint, len(servers))
	for name, timeout := range servers {
		endpoints[name] = &resourceEndpoint{timeout: timeout}
	}
	return &ResourceDirectory{endpoints: endpoints}
}

// Names returns the configured server names in order.
func (d *ResourceDirectory) Names() []string {
	if d == nil {
		return nil
	}
	names := make([]string, 0, len(d.endpoints))
	for name := range d.endpoints {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// SetSession publishes the current connection generation. Nil means disconnected.
func (d *ResourceDirectory) SetSession(name string, session *mcp.ClientSession) {
	if d == nil {
		return
	}
	endpoint := d.endpoints[name]
	if endpoint == nil {
		return
	}
	endpoint.session.Store(session)
}

// Request runs one resource method against the named server's live session.
func (d *ResourceDirectory) Request(ctx context.Context, server, method string, cursor *string, uri string) (json.RawMessage, error) {
	if d == nil {
		return nil, fmt.Errorf("MCP resource server %q is unavailable in this agent's scope", server)
	}
	endpoint := d.endpoints[server]
	if endpoint == nil {
		return nil, fmt.Errorf("MCP resource server %q is unavailable in this agent's scope", server)
	}
	session := endpoint.session.Load()
	if session == nil {
		return nil, fmt.Errorf("mcp-client(%s): server is disconnected", server)
	}
	requestCtx, cancel := context.WithTimeout(ctx, endpoint.timeout)
	defer cancel()
	var result any
	var err error
	switch method {
	case "resources/list":
		params := &mcp.ListResourcesParams{}
		if cursor != nil {
			params.Cursor = *cursor
		}
		result, err = session.ListResources(requestCtx, params)
	case "resources/templates/list":
		params := &mcp.ListResourceTemplatesParams{}
		if cursor != nil {
			params.Cursor = *cursor
		}
		result, err = session.ListResourceTemplates(requestCtx, params)
	case "resources/read":
		result, err = session.ReadResource(requestCtx, &mcp.ReadResourceParams{URI: uri})
	case "prompts/list":
		params := &mcp.ListPromptsParams{}
		if cursor != nil {
			params.Cursor = *cursor
		}
		result, err = session.ListPrompts(requestCtx, params)
	default:
		return nil, fmt.Errorf("unsupported MCP resource method %q", method)
	}
	if err != nil {
		return nil, SafeError(err)
	}
	return marshalResource(result)
}

// GetPrompt reads one named prompt from the server's live session.
func (d *ResourceDirectory) GetPrompt(ctx context.Context, server, name string, arguments map[string]string) (json.RawMessage, error) {
	if d == nil {
		return nil, fmt.Errorf("MCP resource server %q is unavailable in this agent's scope", server)
	}
	endpoint := d.endpoints[server]
	if endpoint == nil {
		return nil, fmt.Errorf("MCP resource server %q is unavailable in this agent's scope", server)
	}
	session := endpoint.session.Load()
	if session == nil {
		return nil, fmt.Errorf("mcp-client(%s): server is disconnected", server)
	}
	requestCtx, cancel := context.WithTimeout(ctx, endpoint.timeout)
	defer cancel()
	result, err := session.GetPrompt(requestCtx, &mcp.GetPromptParams{Name: name, Arguments: arguments})
	if err != nil {
		return nil, SafeError(err)
	}
	return marshalResource(result)
}

func marshalResource(value any) (json.RawMessage, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

// RenderResourceResult attributes one protocol result and keeps binary payloads
// out of the model-facing text. The original JSON stays available to the caller.
func RenderResourceResult(server string, value json.RawMessage) (string, error) {
	rendered, err := redactResourceBlobs(value)
	if err != nil {
		return "", err
	}
	return "MCP server: " + server + "\n" + rendered, nil
}

func redactResourceBlobs(raw []byte) (string, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var buf bytes.Buffer
	if err := writeResourceValue(&buf, decoder, ""); err != nil {
		return "", err
	}
	if decoder.More() {
		return "", fmt.Errorf("resource result has trailing JSON")
	}
	return buf.String(), nil
}

func writeResourceValue(buf *bytes.Buffer, decoder *json.Decoder, key string) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	switch value := token.(type) {
	case json.Delim:
		switch value {
		case '{':
			buf.WriteByte('{')
			first := true
			for decoder.More() {
				keyToken, keyErr := decoder.Token()
				if keyErr != nil {
					return keyErr
				}
				name, ok := keyToken.(string)
				if !ok {
					return fmt.Errorf("resource result object key is %T", keyToken)
				}
				if !first {
					buf.WriteByte(',')
				}
				first = false
				appendJSONString(buf, name)
				buf.WriteByte(':')
				if err := writeResourceValue(buf, decoder, name); err != nil {
					return err
				}
			}
			end, endErr := decoder.Token()
			if endErr != nil {
				return endErr
			}
			if end != json.Delim('}') {
				return fmt.Errorf("resource result object ended with %v", end)
			}
			buf.WriteByte('}')
		case '[':
			buf.WriteByte('[')
			first := true
			for decoder.More() {
				if !first {
					buf.WriteByte(',')
				}
				first = false
				if err := writeResourceValue(buf, decoder, key); err != nil {
					return err
				}
			}
			end, endErr := decoder.Token()
			if endErr != nil {
				return endErr
			}
			if end != json.Delim(']') {
				return fmt.Errorf("resource result array ended with %v", end)
			}
			buf.WriteByte(']')
		default:
			return fmt.Errorf("unexpected JSON delimiter %v", value)
		}
	case string:
		if key == "blob" {
			value = fmt.Sprintf("[binary resource: %d base64 characters; available to programmatic callers]", jsStringLength(value))
		}
		appendJSONString(buf, value)
	case json.Number:
		buf.WriteString(value.String())
	case bool:
		if value {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
	case nil:
		buf.WriteString("null")
	default:
		return fmt.Errorf("unexpected JSON token %T", token)
	}
	return nil
}

func appendJSONString(buf *bytes.Buffer, value string) {
	var tmp bytes.Buffer
	encoder := json.NewEncoder(&tmp)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(value)
	buf.Write(bytes.TrimSuffix(tmp.Bytes(), []byte("\n")))
}

func jsStringLength(value string) int {
	units := 0
	for _, character := range value {
		units++
		if character > 0xffff {
			units++
		}
	}
	return units
}
