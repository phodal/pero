package openai

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func ownedPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	value := image.NewRGBA(image.Rect(0, 0, width, height))
	value.Set(0, 0, color.RGBA{R: 255, A: 255})
	var output bytes.Buffer
	if err := png.Encode(&output, value); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func TestBoundedImageUserAndToolWire(t *testing.T) {
	data := ownedPNG(t, 2, 2)
	decodedImage, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	var encodedJPEG bytes.Buffer
	if err := jpeg.Encode(&encodedJPEG, decodedImage, nil); err != nil {
		t.Fatal(err)
	}
	formats := map[string][]byte{"image/png": data, "image/jpeg": encodedJPEG.Bytes()}
	var received atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.Add(1)
		var body struct {
			Messages []struct {
				Role       string
				Content    json.RawMessage
				ToolCallID string `json:"tool_call_id"`
			}
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		message := body.Messages[len(body.Messages)-1]
		var parts []wireContentPart
		if err := json.Unmarshal(message.Content, &parts); err != nil {
			t.Error(err)
			return
		}
		if len(parts) != 3 || parts[0].Type != "text" || parts[0].Text != "before" || parts[1].Type != "image_url" || parts[2].Text != "after" {
			t.Errorf("not typed, ordered image content: %+v", parts)
			return
		}
		if parts[1].ImageURL == nil {
			t.Error("image URL missing")
			return
		}
		prefix, mime := "", ""
		for candidate := range formats {
			if strings.HasPrefix(parts[1].ImageURL.URL, "data:"+candidate+";base64,") {
				mime, prefix = candidate, "data:"+candidate+";base64,"
			}
		}
		if prefix == "" {
			t.Error("image is not an in-memory data URI")
			return
		}
		decoded, err := base64.StdEncoding.Strict().DecodeString(strings.TrimPrefix(parts[1].ImageURL.URL, prefix))
		if err != nil || !bytes.Equal(decoded, formats[mime]) {
			t.Error("canonical base64 changed the observed bytes")
		}
		if message.Role == "tool" && message.ToolCallID != "observed-image" {
			t.Error("tool identity lost")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		event(w, `{"choices":[{"index":0,"delta":{"content":"fixture accepted typed image"},"finish_reason":"stop"}]}`)
		event(w, "[DONE]")
	}))
	defer server.Close()
	a, err := New(Config{Endpoint: server.URL, APIKey: "fixture", ProviderName: "fixture", Models: []ModelConfig{{ID: "fixture-model", InputModalities: []string{"text", "image"}}}})
	if err != nil {
		t.Fatal(err)
	}
	for mime, data := range formats {
		content := []harness.ContentBlock{{Type: harness.BlockText, Text: "before"}, {Type: harness.BlockImage, MIMEType: mime, Data: data}, {Type: harness.BlockText, Text: "after"}}
		for _, role := range []harness.Role{harness.RoleUser, harness.RoleTool} {
			r := request()
			r.Messages[0] = harness.Message{Role: role, Content: content}
			if role == harness.RoleTool {
				r.Messages[0].Content = []harness.ContentBlock{{Type: harness.BlockToolResult, ToolCallID: "observed-image", Content: content}}
			}
			if _, err := a.Generate(t.Context(), r, nil); err != nil {
				t.Fatal(err)
			}
		}
	}
	if received.Load() != 4 {
		t.Fatal("expected actual loopback requests")
	}
}

func TestImageInputRejectsUnsafeMediaBeforeHTTP(t *testing.T) {
	valid := ownedPNG(t, 2, 2)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer server.Close()
	a, err := New(Config{Endpoint: server.URL, APIKey: "fixture", ProviderName: "fixture", Models: []ModelConfig{{ID: "fixture-model", InputModalities: []string{"text", "image"}}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, mime string
		data       []byte
		kind       harness.BlockType
		role       harness.Role
	}{
		{"remote URL", "image/png", []byte("https://example.com/private.png"), harness.BlockImage, harness.RoleUser},
		{"local path", "image/png", []byte("/tmp/private.png"), harness.BlockImage, harness.RoleUser},
		{"base64 text is not raster bytes", "image/png", []byte(base64.StdEncoding.EncodeToString(valid)), harness.BlockImage, harness.RoleUser},
		{"data URI is not raster bytes", "image/png", []byte("data:image/png;base64," + base64.StdEncoding.EncodeToString(valid)), harness.BlockImage, harness.RoleUser},
		{"MIME mismatch", "image/jpeg", valid, harness.BlockImage, harness.RoleUser},
		{"SVG", "image/svg+xml", []byte(`<svg/>`), harness.BlockImage, harness.RoleUser},
		{"incomplete PNG", "image/png", valid[:len(valid)-12], harness.BlockImage, harness.RoleUser},
		{"oversized bytes", "image/png", make([]byte, MaxInputImageBytes+1), harness.BlockImage, harness.RoleUser},
		{"oversized dimension", "image/png", ownedPNG(t, MaxInputImageDimension+1, 1), harness.BlockImage, harness.RoleUser},
		{"empty bytes", "image/png", nil, harness.BlockImage, harness.RoleUser},
		{"assistant image", "image/png", valid, harness.BlockImage, harness.RoleAssistant},
		{"file upload", "image/png", valid, harness.BlockFile, harness.RoleUser},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := request()
			r.Messages[0] = harness.Message{Role: test.role, Content: []harness.ContentBlock{{Type: test.kind, Data: test.data, MIMEType: test.mime}}}
			if _, err := a.Generate(t.Context(), r, nil); err == nil {
				t.Fatal("unsafe media accepted")
			}
		})
	}
	textOnly, _ := fixture(t, func(http.ResponseWriter, *http.Request) { calls.Add(1) })
	r := request()
	r.Messages[0].Content = []harness.ContentBlock{{Type: harness.BlockImage, Data: valid, MIMEType: "image/png"}}
	if _, err := textOnly.Generate(t.Context(), r, nil); err == nil {
		t.Fatal("default text-only model silently gained image capability")
	}
	if calls.Load() != 0 {
		t.Fatal("invalid content caused a network request")
	}
	used := MaxRequestImageBytes - len(valid) + 1
	if _, err := encodeContent(r.Messages[0].Content, true, &used); err == nil {
		t.Fatal("request-wide image byte bound ignored")
	}
}

func TestTextOnlyToolImageKeepsReferenceAndDisclosesUnreadPixels(t *testing.T) {
	data := ownedPNG(t, 2, 2)
	var received atomic.Int32
	a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		var body wireRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		message := body.Messages[len(body.Messages)-1]
		text, ok := message.Content.(string)
		if !ok || message.Role != "tool" || message.ToolCallID != "figure" ||
			!strings.Contains(text, "![Figure](pero-image://observed)") ||
			!strings.Contains(text, "has not inspected its pixels") ||
			!strings.HasSuffix(text, "Original caption and TeX lines.") || strings.Contains(text, "base64") {
			t.Errorf("text-only tool projection lost reference or limitation: %+v", message)
		}
		received.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		event(w, `{"choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":"stop"}]}`)
		event(w, "[DONE]")
	})
	r := request()
	r.Messages = []harness.Message{{Role: harness.RoleTool, Content: []harness.ContentBlock{{
		Type: harness.BlockToolResult, ToolCallID: "figure", Content: []harness.ContentBlock{
			{Type: harness.BlockText, Text: "![Figure](pero-image://observed)"},
			{Type: harness.BlockImage, MIMEType: "image/png", Data: data},
			{Type: harness.BlockText, Text: "Original caption and TeX lines."},
		},
	}}}}
	if _, err := a.Generate(t.Context(), r, nil); err != nil {
		t.Fatal(err)
	}
	if received.Load() != 1 || !bytes.Equal(r.Messages[0].Content[0].Content[1].Data, data) {
		t.Fatal("tool image was lost from the retained transcript")
	}
}

func TestHistoricalToolImagesDoNotBlockContinuation(t *testing.T) {
	for _, data := range [][]byte{[]byte("malformed historical raster"), ownedPNG(t, MaxInputImageDimension+1, 1)} {
		original := append([]byte(nil), data...)
		r := request()
		r.Messages = []harness.Message{{Role: harness.RoleTool, Content: []harness.ContentBlock{{Type: harness.BlockToolResult, ToolCallID: "old-read", Content: []harness.ContentBlock{
			{Type: harness.BlockText, Text: "Retained image reference"},
			{Type: harness.BlockImage, MIMEType: "image/png", Data: data},
		}}}}}
		wire, err := encodeRequest(r, true)
		if err != nil {
			t.Fatalf("history poisoned continuation: %v", err)
		}
		encoded, _ := json.Marshal(wire)
		if !strings.Contains(string(encoded), "Retained image reference") {
			t.Fatal("lost image provenance")
		}
		if !bytes.Equal(original, r.Messages[0].Content[0].Content[1].Data) {
			t.Fatal("rewrote durable history")
		}
	}
	projected := projectToolImages([]harness.ContentBlock{{Type: harness.BlockImage, MIMEType: "image/png", Data: ownedPNG(t, 2, 2)}}, true, MaxRequestImageBytes)
	if projected[0].Type != harness.BlockText || !strings.Contains(projected[0].Text, "omitted") {
		t.Fatal("exhausted image budget did not disclose omission")
	}
}
