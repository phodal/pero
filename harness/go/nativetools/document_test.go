package nativetools

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/media"
	"github.com/phodal/pero/harness/go/providers/openai"
)

func TestPDFReadRendersSelectedPagesWithProvenance(t *testing.T) {
	path, err := exec.LookPath("pdftoppm")
	if err != nil {
		t.Skip("real Poppler tools are not installed")
	}
	renderer, err := probeDocumentRenderer(t.Context(), path)
	if err != nil || renderer == nil {
		t.Fatalf("renderer probe: %v", err)
	}
	f := newClaudeFixture(t, Options{PDFRendererPath: path})
	if err := os.WriteFile(filepath.Join(f.root, "pages.pdf"), twoPagePDF(), 0600); err != nil {
		t.Fatal(err)
	}
	result := f.call(t, f.denied, "PDFRead", struct {
		Path  string `json:"file_path"`
		First int    `json:"start_page"`
		Last  int    `json:"end_page"`
	}{filepath.Join(f.root, "pages.pdf"), 1, 2})
	if result.IsError || len(result.Content) != 4 {
		t.Fatalf("PDF result: %+v", result)
	}
	for page := 1; page <= 2; page++ {
		var source documentImageSource
		if err := json.Unmarshal([]byte(result.Content[(page-1)*2].Text), &source); err != nil {
			t.Fatal(err)
		}
		if source.Page != page || source.Pages != 2 || source.Path != "pages.pdf" || len(source.SHA256) != 64 {
			t.Fatalf("lost page provenance: %+v", source)
		}
		block := result.Content[(page-1)*2+1]
		decoded, _, err := image.Decode(bytes.NewReader(block.Data))
		if err != nil || block.Type != harness.BlockImage || len(block.Data) > media.ToolImageMaxBytes {
			t.Fatalf("invalid rendered image: %v", err)
		}
		bounds := decoded.Bounds()
		if bounds.Dx() > 2048 || bounds.Dy() > 2048 {
			t.Fatal(bounds)
		}
		r, _, b, _ := decoded.At(bounds.Dx()/2, bounds.Dy()/2).RGBA()
		if page == 1 && r <= b || page == 2 && b <= r {
			t.Fatalf("page %d had wrong rendered color: red=%d blue=%d", page, r, b)
		}
	}
	if got := f.call(t, f.denied, "PDFRead", struct {
		Path string `json:"file_path"`
		Page int    `json:"start_page"`
	}{"pages.pdf", 3}); !got.IsError {
		t.Fatal("nonexistent page accepted")
	}
	if f.approvals.Load() != 0 {
		t.Fatal("read requested mutation approval")
	}
	projected := media.ProjectImagesForTextModel([]harness.Message{{Role: harness.RoleTool, Content: result.Content}})
	for _, block := range projected[0].Content {
		if block.Type == harness.BlockImage {
			t.Fatal("text route received pixels")
		}
	}
	if !strings.Contains(fmt.Sprint(projected), "text only") {
		t.Fatal("text-only limitation was lost")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Model    string          `json:"model"`
			Messages json.RawMessage `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		wire := string(request.Messages)
		if request.Model == "vision" && !strings.Contains(wire, "data:image/") {
			t.Error("vision route did not receive rendered pages")
		}
		if request.Model == "text" && (strings.Contains(wire, "data:image/") || !strings.Contains(wire, "not inspected its pixels")) {
			t.Error("text route lost modality limitation")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"received\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	adapter, err := openai.New(openai.Config{Endpoint: server.URL, APIKey: "local-fixture", ProviderName: "fixture", Models: []openai.ModelConfig{{ID: "vision", InputModalities: []string{"text", "image"}}, {ID: "text", InputModalities: []string{"text"}}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, model := range []string{"vision", "text"} {
		if _, err := adapter.Generate(t.Context(), harness.GenerateRequest{Provider: "fixture", Model: model, Messages: []harness.Message{{Role: harness.RoleTool, Content: []harness.ContentBlock{{Type: harness.BlockToolResult, ToolCallID: "pdf", Content: result.Content}}}}}, nil); err != nil {
			t.Fatal(err)
		}
	}
}

func TestDocumentCapabilityAdmissionAndNotebookRaster(t *testing.T) {
	f := newClaudeFixture(t, Options{PDFRendererPath: "-"})
	schemas, err := f.harness.Tools().SchemasForAgent(t.Context(), f.denied)
	if err != nil {
		t.Fatal(err)
	}
	for _, schema := range schemas {
		if schema.Name == "PDFRead" {
			t.Fatal("disabled renderer advertised")
		}
	}
	for _, mime := range []string{"image/png", "image/jpeg"} {
		var encoded bytes.Buffer
		pixels := image.NewRGBA(image.Rect(0, 0, 3, 2))
		pixels.Set(1, 1, color.RGBA{R: 240, A: 255})
		if mime == "image/png" {
			err = png.Encode(&encoded, pixels)
		} else {
			err = jpeg.Encode(&encoded, pixels, nil)
		}
		if err != nil {
			t.Fatal(err)
		}
		base64Data := base64.StdEncoding.EncodeToString(encoded.Bytes())
		notebook := struct {
			Format int `json:"nbformat"`
			Cells  []struct {
				ID      string   `json:"id"`
				Kind    string   `json:"cell_type"`
				Source  []string `json:"source"`
				Outputs []struct {
					Data map[string]string `json:"data"`
				} `json:"outputs"`
				Attachments map[string]map[string]string `json:"attachments"`
			} `json:"cells"`
		}{Format: 4}
		cell := struct {
			ID      string   `json:"id"`
			Kind    string   `json:"cell_type"`
			Source  []string `json:"source"`
			Outputs []struct {
				Data map[string]string `json:"data"`
			} `json:"outputs"`
			Attachments map[string]map[string]string `json:"attachments"`
		}{ID: "saved-image", Kind: "code", Source: []string{"never executed"}, Attachments: map[string]map[string]string{"figure": {mime: base64Data}}}
		cell.Outputs = append(cell.Outputs, struct {
			Data map[string]string `json:"data"`
		}{map[string]string{mime: base64Data, "text/html": "<script>never execute</script>"}})
		notebook.Cells = append(notebook.Cells, cell)
		raw, _ := json.Marshal(notebook)
		if err := os.WriteFile(filepath.Join(f.root, "saved.ipynb"), raw, 0600); err != nil {
			t.Fatal(err)
		}
		for _, attachment := range []string{"", "figure"} {
			result := f.call(t, f.denied, "NotebookImage", struct {
				Path       string `json:"file_path"`
				Cell       int    `json:"cell_index"`
				Attachment string `json:"attachment_name,omitempty"`
			}{"saved.ipynb", 1, attachment})
			if result.IsError || len(result.Content) != 2 || result.Content[1].Type != harness.BlockImage {
				t.Fatalf("saved image: %+v", result)
			}
			var source documentImageSource
			if err := json.Unmarshal([]byte(result.Content[0].Text), &source); err != nil {
				t.Fatal(err)
			}
			if source.Cell != 1 || source.CellID != "saved-image" || source.Attachment != attachment || source.MIME != mime || len(source.SHA256) != 64 {
				t.Fatalf("lost notebook provenance: %+v", source)
			}
			if _, _, err := image.Decode(bytes.NewReader(result.Content[1].Data)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if got := f.call(t, f.denied, "NotebookImage", struct {
		Path string `json:"file_path"`
		Cell int    `json:"cell_index"`
	}{filepath.Join(t.TempDir(), "outside.ipynb"), 1}); !got.IsError {
		t.Fatal("notebook escaped workspace")
	}
	if _, err := probeDocumentRenderer(t.Context(), filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("explicit nonexistent renderer accepted")
	}
}

func TestDocumentProcessLimits(t *testing.T) {
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("Unix process fixture")
	}
	_, err := runDocumentProcess(t.Context(), "/bin/sh", []string{"-c", "printf 123456789"}, nil, 3, time.Second)
	if err == nil {
		t.Fatal("renderer output budget ignored")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := runDocumentProcess(ctx, "/bin/sh", []string{"-c", "exec sleep 30"}, nil, 32, time.Second); err == nil {
		t.Fatal("canceled render started")
	}
}

func twoPagePDF() []byte {
	objects := []string{
		`<< /Type /Catalog /Pages 2 0 R >>`,
		`<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>`,
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents 5 0 R >>`,
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents 6 0 R >>`,
	}
	for _, paint := range []string{"1 0 0 rg 0 0 72 72 re f\n", "0 0 1 rg 0 0 72 72 re f\n"} {
		objects = append(objects, fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(paint), paint))
	}
	var pdf bytes.Buffer
	pdf.WriteString("%PDF-1.4\n")
	offsets := []int{0}
	for i, object := range objects {
		offsets = append(offsets, pdf.Len())
		fmt.Fprintf(&pdf, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := pdf.Len()
	fmt.Fprintf(&pdf, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&pdf, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&pdf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	return pdf.Bytes()
}
