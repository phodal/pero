// Package molecules publishes a Scientific Viewer molecule preview in the conversation.
// Chemistry stays in the App; this tool only runs that preview and retains its receipt.
package molecules

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/model"
)

const ToolName = "molecule_render"

const inputSchema = `{"type":"object","additionalProperties":false,"properties":{"format":{"type":"string","enum":["smiles","mol","sdf"]},"records":{"type":"array","minItems":1,"maxItems":4,"items":{"type":"string","minLength":1,"maxLength":32768}}},"required":["format","records"]}`

// Render runs the existing viewer conversation entry. The returned summary is for the
// model; DisplayText is the full receipt, including drawings, for the conversation UI.
func Render(ctx context.Context, python, backend string, input json.RawMessage) (summary string, receipt string, err error) {
	if python == "" {
		python = "python3"
	}
	script := filepath.Join(backend, "conversation.py")
	if backend == "" {
		return unavailable(input, "Scientific Viewer backend is not configured")
	}
	if _, statErr := os.Stat(script); statErr != nil {
		return unavailable(input, "Scientific Viewer molecule entry was not found")
	}
	if len(input) > 1024*1024 {
		return "", "", errors.New("molecule request exceeds 1 MiB")
	}
	command := exec.CommandContext(ctx, python, "-I", "-X", "utf8", script)
	command.Stdin = bytes.NewReader(input)
	var output, diagnostic bytes.Buffer
	command.Stdout, command.Stderr = &output, &diagnostic
	if err := command.Run(); err != nil {
		var failure struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(output.Bytes(), &failure) == nil && failure.Error != "" {
			return "", "", errors.New(failure.Error)
		}
		message := diagnostic.String()
		if len(message) > 500 {
			message = message[:500]
		}
		return "", "", fmt.Errorf("molecule preview failed: %w: %s", err, message)
	}
	body := bytes.TrimSpace(output.Bytes())
	var receiptValue struct {
		Kind     string `json:"kind"`
		Status   string `json:"status"`
		Version  string `json:"version"`
		Citation string `json:"citation"`
		Engine   *struct {
			Name    string `json:"name"`
			Version string `json:"version"`
		} `json:"engine"`
		Rows []struct {
			Input       string `json:"input"`
			Status      string `json:"status"`
			Error       string `json:"error,omitempty"`
			Descriptors map[string]struct {
				Value float64 `json:"value"`
				Unit  string  `json:"unit"`
			} `json:"descriptors,omitempty"`
		} `json:"rows"`
	}
	if err := json.Unmarshal(body, &receiptValue); err != nil || receiptValue.Kind != "pero.molecule-conversation.v1" {
		return "", "", errors.New("molecule preview did not return a conversation receipt")
	}
	modelView := map[string]any{
		"kind": receiptValue.Kind, "status": receiptValue.Status, "version": receiptValue.Version,
		"citation": receiptValue.Citation, "engine": receiptValue.Engine, "rows": receiptValue.Rows,
		"note": "Drawings are in the conversation receipt. Do not paste SVG or treat descriptors as experimental measurements.",
	}
	encoded, err := json.Marshal(modelView)
	if err != nil {
		return "", "", err
	}
	return string(encoded), string(body), nil
}

func unavailable(input json.RawMessage, reason string) (string, string, error) {
	var request struct {
		Format  string   `json:"format"`
		Records []string `json:"records"`
	}
	if err := json.Unmarshal(input, &request); err != nil || len(request.Records) == 0 {
		return "", "", errors.New(reason)
	}
	identity, _ := json.Marshal(map[string]any{"engine": nil, "format": request.Format, "records": request.Records, "rows": []any{}})
	sum := sha256.Sum256(identity)
	version := fmt.Sprintf("%x", sum)
	rows := make([]map[string]string, 0, len(request.Records))
	for _, record := range request.Records {
		rows = append(rows, map[string]string{"input": record, "status": "unavailable", "error": "RDKit is unavailable"})
	}
	receipt := map[string]any{
		"kind": "pero.molecule-conversation.v1", "version": version, "citation": "scientific-viewer:" + version,
		"status": "unavailable", "inheritedCheck": false, "format": request.Format, "engine": nil,
		"method":      "RDKit was not run. No structure or descriptor was calculated.",
		"scope":       "No drawing or descriptor was invented.",
		"explanation": reason + " No drawing or descriptor was invented.",
		"rows":        rows,
	}
	body, err := json.Marshal(receipt)
	if err != nil {
		return "", "", err
	}
	summary, err := json.Marshal(map[string]any{"kind": receipt["kind"], "status": "unavailable", "version": version, "citation": receipt["citation"], "note": reason})
	return string(summary), string(body), err
}

func Mount(ctx context.Context, h *harness.Harness, python, backend string) error {
	if h == nil {
		return errors.New("molecules require harness")
	}
	_, err := h.RegisterTool(ctx, "data/"+ToolName, harness.Tool{
		Schema:  harness.ToolSchema{Name: ToolName, InputSchema: json.RawMessage(inputSchema), Description: `Depict 1–4 SMILES, MOL, or SDF records with the existing Scientific Viewer RDKit preview and show the versioned receipt in this conversation. Failed records keep their error and do not receive a drawing or zero descriptors. The result is calculated structure and descriptors, not an experiment or biological activity. Do not paste SVG or repeat descriptor JSON in prose.`},
		Timeout: 30 * time.Second,
		ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			summary, receipt, err := Render(ctx, python, backend, request.Arguments)
			if err != nil {
				return harness.ToolResult{IsError: true, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: err.Error()}}}, nil
			}
			result := harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: summary}}}
			if receipt != "" {
				result.Meta, err = json.Marshal(model.ToolPresentation{DisplayText: receipt})
			}
			return result, err
		},
	})
	return err
}
