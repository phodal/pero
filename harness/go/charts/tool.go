// Package charts mounts the App-independent chart_render capability.
// The embedded Python value core is also packaged with Data Agent.
package charts

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

//go:embed python/*.py
var core embed.FS

const ToolName = "chart_render"
const inputSchema = `{"type":"object","additionalProperties":false,"properties":{"document":{"type":"object"},"dataset":{"type":"object","additionalProperties":false,"properties":{"name":{"type":"string"},"content":{"type":"string"},"format":{"type":"string","enum":["json","json_lines"]}},"required":["name","content","format"]},"view":{"type":"object"},"chartDocument":{"type":"object"},"aggregation":{"type":"object"}}}`

// Render validates at the shared domain boundary. Its receipt is retained by
// the normal Session journal, so replay never executes Python again.
func Render(ctx context.Context, python string, input json.RawMessage) (json.RawMessage, error) {
	if len(input) > 2*1024*1024 {
		return nil, errors.New("chart request exceeds 2 MiB")
	}
	directory, err := os.MkdirTemp("", "pero-chart-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(directory)
	entries, err := core.ReadDir("python")
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		body, err := core.ReadFile("python/" + entry.Name())
		if err != nil {
			return nil, err
		}
		if err := os.WriteFile(filepath.Join(directory, entry.Name()), body, 0600); err != nil {
			return nil, err
		}
	}
	// JSON crosses pipes as UTF-8, independently of the Windows locale.
	command := exec.CommandContext(ctx, python, "-I", "-X", "utf8", filepath.Join(directory, "render.py"))
	command.Stdin = bytes.NewReader(input)
	var output, diagnostic bytes.Buffer
	command.Stdout, command.Stderr = &output, &diagnostic
	if err := command.Run(); err != nil {
		var failure struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(output.Bytes(), &failure) == nil && failure.Error != "" {
			return nil, errors.New(failure.Error)
		}
		message := diagnostic.String()
		if len(message) > 1000 {
			message = message[:1000]
		}
		return nil, fmt.Errorf("chart core unavailable (Python 3.9+ required): %w: %s", err, message)
	}
	return json.RawMessage(bytes.TrimSpace(output.Bytes())), nil
}

func Mount(ctx context.Context, h *harness.Harness, python string) error {
	if h == nil {
		return errors.New("charts require harness")
	}
	if python == "" {
		python = "python3"
	}
	_, err := h.RegisterTool(ctx, "data/charts", harness.Tool{
		Schema:  harness.ToolSchema{Name: ToolName, InputSchema: json.RawMessage(inputSchema), Description: `Render reviewed data as an inline GPUI chart in this conversation; no Data Agent App is required. Supply document (schemaVersion:1,id,title,chart,rows,source:{label,caveats}). chart uses type and x/y fields; line optionally series and null gaps; candlestick uses x/open/high/low/close; sankey uses x/target/y. Types: line,bar,area,pie,radar,candlestick,sankey. Alternatively supply dataset:{name,content,format}, chartDocument:{title,chart}, optional view (filter/sort/selection) and aggregation:{category,measure,aggregation:sum|count} to retain exact source records. Missing is not zero; source labels are declarations. Success publishes the chart; do not repeat its JSON in prose.`},
		Timeout: 30 * time.Second,
		Execute: func(ctx context.Context, input json.RawMessage) (harness.ToolResult, error) {
			output, err := Render(ctx, python, input)
			if err != nil {
				return harness.ToolResult{IsError: true, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: err.Error()}}}, nil
			}
			return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(output)}}}, nil
		},
	})
	return err
}
