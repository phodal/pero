package nativetools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/providers/openai"
)

func TestClaudeReadImageContinuation(t *testing.T) {
	var gifData, largePNG bytes.Buffer
	if err := gif.Encode(&gifData, image.NewPaletted(image.Rect(0, 0, 2, 2), color.Palette{color.Black, color.White}), nil); err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(&largePNG, image.NewRGBA(image.Rect(0, 0, 3000, 1))); err != nil {
		t.Fatal(err)
	}
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []struct{ Content json.RawMessage }
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		wire := string(request.Messages[len(request.Messages)-1].Content)
		if !strings.Contains(wire, "data:image/") || strings.Contains(wire, "image/gif") {
			t.Errorf("Read result was not usable raster content: %s", wire)
		}
		requests++
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"observed\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	adapter, err := openai.New(openai.Config{Endpoint: server.URL, APIKey: "fixture", ProviderName: "fixture", Models: []openai.ModelConfig{{ID: "vision", InputModalities: []string{"text", "image"}}}})
	if err != nil {
		t.Fatal(err)
	}
	f := newClaudeFixture(t, Options{})
	for name, data := range map[string][]byte{"first-frame.gif": gifData.Bytes(), "wide.png": largePNG.Bytes(), "broken.png": []byte("broken")} {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(f.root, name), data, 0600); err != nil {
				t.Fatal(err)
			}
			result := f.call(t, f.denied, "Read", map[string]any{"file_path": name})
			if name == "broken.png" {
				if !result.IsError {
					t.Fatal("malformed image entered successful history")
				}
				return
			}
			if result.IsError {
				t.Fatalf("read failed: %+v", result)
			}
			config, _, err := image.DecodeConfig(bytes.NewReader(result.Content[0].Data))
			if err != nil || config.Width > openai.MaxInputImageDimension {
				t.Fatalf("image was not resized: %+v %v", config, err)
			}
			_, err = adapter.Generate(t.Context(), harness.GenerateRequest{Provider: "fixture", Model: "vision", Messages: []harness.Message{{Role: harness.RoleTool, Content: []harness.ContentBlock{{Type: harness.BlockToolResult, ToolCallID: "read-image", Content: result.Content}}}}}, nil)
			if err != nil {
				t.Fatal(err)
			}
		})
	}
	if requests != 2 {
		t.Fatalf("provider continuations = %d", requests)
	}
}

func TestClaudeReadReturnsImageContent(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	path := filepath.Join(f.root, "shot.png")
	png := tinyPNG()
	if err := os.WriteFile(path, png, 0600); err != nil {
		t.Fatal(err)
	}
	result := f.call(t, f.denied, "Read", map[string]any{"file_path": path})
	if result.IsError || len(result.Content) != 1 || result.Content[0].Type != harness.BlockImage || result.Content[0].MIMEType != "image/png" {
		t.Fatalf("image read failed: %+v", result)
	}
	if string(result.Content[0].Data) != string(png) {
		t.Fatal("image bytes changed")
	}
}

func TestClaudeReadRejectsHugeImage(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	path := filepath.Join(f.root, "huge.png")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(129 << 20); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	result := f.call(t, f.denied, "Read", map[string]any{"file_path": path})
	if !result.IsError || !strings.Contains(result.Content[0].Text, "too large") || !strings.Contains(result.Content[0].Text, "resize") {
		t.Fatalf("large image accepted: %+v", result)
	}
}

func tinyPNG() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
		0x42, 0x60, 0x82,
	}
}
