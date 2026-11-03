package nativetools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

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
