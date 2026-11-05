package nativetools

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/media"
)

const documentMaxSourceBytes = 32 << 20

type documentRenderer struct{ pages, info string }

// A renderer is an explicitly probed pair of Poppler executables. Empty selects
// a host-installed pair, while "-" disables PDF tools. Missing automatic
// capability leaves PDF tools unregistered; an invalid explicit path is an error.
func probeDocumentRenderer(ctx context.Context, path string) (*documentRenderer, error) {
	if path == "-" {
		return nil, nil
	}
	explicit := path != ""
	if !explicit {
		var err error
		path, err = exec.LookPath("pdftoppm")
		if err != nil {
			return nil, nil
		}
	}
	if !filepath.IsAbs(path) {
		return nil, errors.New("PDF renderer path must be absolute")
	}
	renderer := &documentRenderer{pages: path, info: filepath.Join(filepath.Dir(path), "pdfinfo"+filepath.Ext(path))}
	// Unix executables commonly contain no suffix; keep a Windows .exe suffix.
	if filepath.Ext(path) != ".exe" {
		renderer.info = filepath.Join(filepath.Dir(path), "pdfinfo")
	}
	for _, executable := range []string{renderer.pages, renderer.info} {
		output, err := runDocumentProcess(ctx, executable, []string{"-v"}, nil, 4096, 2*time.Second)
		if err != nil || !bytes.Contains(bytes.ToLower(output), []byte("version")) {
			if explicit {
				return nil, fmt.Errorf("PDF renderer probe failed for %s: %w", executable, errors.Join(err, errors.New("expected Poppler version output")))
			}
			return nil, nil
		}
	}
	return renderer, nil
}

func mountDocumentTools(ctx context.Context, h *harness.Harness, app *App, rendererPath string, claude bool) error {
	renderer, err := probeDocumentRenderer(ctx, rendererPath)
	if err != nil {
		return err
	}
	pathProperty, pathName := `"path":{"type":"string","minLength":1}`, "path"
	pdfName, notebookName := "pdf_read", "notebook_image"
	if claude {
		pathProperty, pathName = `"file_path":{"type":"string","minLength":1}`, "file_path"
		pdfName, notebookName = "PDFRead", "NotebookImage"
	}
	register := func(name, description, fields, required string, body func(context.Context, *fstools.Workspace, arguments, json.RawMessage) (harness.ToolResult, error)) error {
		_, err := h.RegisterTool(ctx, "native/"+name, harness.Tool{
			Schema:        harness.ToolSchema{Name: name, Description: description, InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{` + pathProperty + fields + `},"required":["` + pathName + `"` + required + `]}`)},
			ExecutionMode: harness.ExecutionSerial, Timeout: 35 * time.Second,
			ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
				if request.Agent == nil {
					return harness.ToolResult{}, errors.New("document reads require an agent")
				}
				if err := app.CheckCWD(request.Agent.Session().WorkingDirectory()); err != nil {
					return harness.ToolResult{}, err
				}
				files := WorkspaceForToolRequest(request, app.files)
				alias := files.Path()
				if files == app.files {
					alias = request.Agent.Session().WorkingDirectory()
				}
				input, err := decodeNativeArguments(request.Arguments, files.Path(), claude, false, alias)
				if err != nil {
					return harness.ToolResult{}, err
				}
				return body(ctx, files, input, request.Arguments)
			},
		})
		return err
	}
	if renderer != nil {
		err := register(pdfName, "Render selected PDF pages as normalized PNG/JPEG images. A probed local Poppler renderer reads only descriptor-selected workspace bytes. Source at most 32 MiB; 1-based start_page defaults to 1, end_page defaults to start_page; at most 3 pages per call. Reports actual page count, source hash and page numbers. Each image fits 2048 pixels/4 MiB, total at most 12 MiB. Rendering has a 30-second budget. Text-only models receive the ordinary unread-image limitation; no OCR or page-text extraction is claimed.", `,"start_page":{"type":"integer","minimum":1},"end_page":{"type":"integer","minimum":1}`, "", func(ctx context.Context, files *fstools.Workspace, input arguments, raw json.RawMessage) (harness.ToolResult, error) {
			var pages struct {
				Start int `json:"start_page"`
				End   int `json:"end_page"`
			}
			if err := json.Unmarshal(raw, &pages); err != nil {
				return harness.ToolResult{}, err
			}
			return renderer.read(ctx, files, input.Path, pages.Start, pages.End)
		})
		if err != nil {
			return err
		}
	}
	return register(notebookName, "Read one saved raster output or attachment from a Jupyter nbformat 4 notebook and return an actual normalized image. cell_index is 1-based; output_index is 0-based and defaults to 0. attachment_name selects a named cell attachment instead of an output. PNG/JPEG/GIF/WebP are decoded; GIF uses its first frame. Source at most 32 MiB; image at most 20 MiB/64 million source pixels, normalized to 2048 pixels/4 MiB. Reports source hash, cell ID/index and output/attachment provenance. No notebook code, HTML or SVG is executed. Text-only models receive an explicit unread-image limitation.", `,"cell_index":{"type":"integer","minimum":1},"output_index":{"type":"integer","minimum":0},"attachment_name":{"type":"string","minLength":1},"mime_type":{"type":"string","enum":["image/png","image/jpeg","image/gif","image/webp"]}`, `,"cell_index"`, readNotebookImage)
}

type documentImageSource struct {
	Path       string `json:"path"`
	SHA256     string `json:"source_sha256"`
	Page       int    `json:"page,omitempty"`
	Pages      int    `json:"total_pages,omitempty"`
	Cell       int    `json:"cell_index,omitempty"`
	CellID     string `json:"cell_id,omitempty"`
	Output     *int   `json:"output_index,omitempty"`
	Attachment string `json:"attachment_name,omitempty"`
	MIME       string `json:"mime_type"`
}

func documentImageBlocks(source documentImageSource, data []byte, mime string) []harness.ContentBlock {
	source.MIME = mime
	raw, _ := json.Marshal(source)
	return []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}, {Type: harness.BlockImage, MIMEType: mime, Data: data}}
}

func (r *documentRenderer) read(ctx context.Context, files *fstools.Workspace, path string, first, last int) (harness.ToolResult, error) {
	if strings.ToLower(filepath.Ext(path)) != ".pdf" {
		return harness.ToolResult{}, errors.New("PDF path must end with .pdf")
	}
	if first == 0 {
		first = 1
	}
	if last == 0 {
		last = first
	}
	if first < 1 || last < first || last-first >= 3 {
		return harness.ToolResult{}, errors.New("select a forward range of at most 3 PDF pages")
	}
	data, err := files.ReadBytes(ctx, path, documentMaxSourceBytes)
	if err != nil {
		return harness.ToolResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	info, err := runDocumentProcess(ctx, r.info, []string{"-"}, data, 16<<10, 5*time.Second)
	if err != nil {
		return harness.ToolResult{}, fmt.Errorf("inspect PDF: %w", err)
	}
	count := 0
	for _, line := range strings.Split(string(info), "\n") {
		if value, ok := strings.CutPrefix(line, "Pages:"); ok {
			count, _ = strconv.Atoi(strings.TrimSpace(value))
			break
		}
	}
	if count < 1 || last > count {
		return harness.ToolResult{}, fmt.Errorf("PDF has %d pages; select a range within that document", count)
	}
	digest := sha256.Sum256(data)
	result := harness.ToolResult{}
	for page := first; page <= last; page++ {
		image, err := runDocumentProcess(ctx, r.pages, []string{"-f", strconv.Itoa(page), "-l", strconv.Itoa(page), "-singlefile", "-scale-to", "2048", "-png", "-"}, data, 20<<20, 15*time.Second)
		if err != nil {
			return harness.ToolResult{}, fmt.Errorf("render PDF page %d: %w", page, err)
		}
		image, mime, err := media.NormalizeToolImage(image, "image/png")
		if err != nil {
			return harness.ToolResult{}, fmt.Errorf("normalize PDF page %d: %w", page, err)
		}
		result.Content = append(result.Content, documentImageBlocks(documentImageSource{Path: path, SHA256: hex.EncodeToString(digest[:]), Page: page, Pages: count}, image, mime)...)
	}
	return result, nil
}

func readNotebookImage(ctx context.Context, files *fstools.Workspace, input arguments, raw json.RawMessage) (harness.ToolResult, error) {
	if strings.ToLower(filepath.Ext(input.Path)) != ".ipynb" {
		return harness.ToolResult{}, errors.New("notebook path must end with .ipynb")
	}
	var selection struct {
		Cell       int    `json:"cell_index"`
		Output     int    `json:"output_index"`
		Attachment string `json:"attachment_name"`
		MIME       string `json:"mime_type"`
	}
	if err := json.Unmarshal(raw, &selection); err != nil {
		return harness.ToolResult{}, err
	}
	data, err := files.ReadBytes(ctx, input.Path, documentMaxSourceBytes)
	if err != nil {
		return harness.ToolResult{}, err
	}
	var notebook notebookDocument
	if err := json.Unmarshal(data, &notebook); err != nil {
		return harness.ToolResult{}, fmt.Errorf("invalid notebook JSON: %w", err)
	}
	if notebook.Nbformat != 4 || selection.Cell < 1 || selection.Cell > len(notebook.Cells) {
		return harness.ToolResult{}, errors.New("select an existing 1-based cell in an nbformat 4 notebook")
	}
	cell := notebook.Cells[selection.Cell-1]
	if len(cell.ID) > 64 {
		return harness.ToolResult{}, errors.New("notebook cell ID exceeds the nbformat 4 limit")
	}
	var bundle map[string]json.RawMessage
	source := documentImageSource{Path: input.Path, Cell: selection.Cell, CellID: cell.ID, Attachment: selection.Attachment}
	if selection.Attachment != "" {
		var attachments map[string]map[string]json.RawMessage
		if err := json.Unmarshal(cell.Attachments, &attachments); err != nil {
			return harness.ToolResult{}, errors.New("cell has no valid saved attachments")
		}
		bundle = attachments[selection.Attachment]
	} else {
		var outputs []struct {
			Data map[string]json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(cell.Outputs, &outputs); err != nil || selection.Output < 0 || selection.Output >= len(outputs) {
			return harness.ToolResult{}, errors.New("select an existing 0-based saved output index")
		}
		bundle = outputs[selection.Output].Data
		source.Output = &selection.Output
	}
	mime := selection.MIME
	if mime == "" {
		for _, candidate := range []string{"image/png", "image/jpeg", "image/gif", "image/webp"} {
			if _, ok := bundle[candidate]; ok {
				mime = candidate
				break
			}
		}
	}
	encoded, ok := bundle[mime]
	if !ok {
		return harness.ToolResult{}, errors.New("selected output/attachment has no supported saved raster; HTML/SVG are not rendered")
	}
	var base64Data string
	if err := json.Unmarshal(encoded, &base64Data); err != nil {
		var lines []string
		if err := json.Unmarshal(encoded, &lines); err != nil {
			return harness.ToolResult{}, errors.New("saved raster must contain a base64 string or string array")
		}
		base64Data = strings.Join(lines, "")
	}
	if len(base64Data) > base64.StdEncoding.EncodedLen(int(media.DefaultMaxImageBytes)) {
		return harness.ToolResult{}, errors.New("saved raster exceeds source image byte budget")
	}
	image, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return harness.ToolResult{}, errors.New("saved raster contains invalid base64")
	}
	image, mime, err = media.NormalizeToolImage(image, mime)
	if err != nil {
		return harness.ToolResult{}, err
	}
	digest := sha256.Sum256(data)
	source.SHA256 = hex.EncodeToString(digest[:])
	return harness.ToolResult{Content: documentImageBlocks(source, image, mime)}, nil
}

func runDocumentProcess(ctx context.Context, executable string, args []string, input []byte, limit int, timeout time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(ctx, executable, args...)
	command.Env = []string{"PATH=/usr/bin:/bin", "LANG=C.UTF-8", "LC_ALL=C"}
	command.Stdin = bytes.NewReader(input)
	command.WaitDelay = 250 * time.Millisecond
	configureNativeProcess(command)
	defer cleanupNativeProcess(command)
	output := &nativeProcessOutput{limit: limit, cancel: cancel}
	diagnostics := &nativeProcessOutput{limit: 4096, cancel: cancel}
	command.Stdout, command.Stderr = output, diagnostics
	err := command.Run()
	if err != nil {
		return nil, fmt.Errorf("document renderer failed: %w (%s)", errors.Join(err, ctx.Err()), boundedText(diagnostics.buffer.String(), 1024))
	}
	if output.buffer.Len() == 0 {
		return append([]byte(nil), diagnostics.buffer.Bytes()...), nil
	}
	return append([]byte(nil), output.buffer.Bytes()...), nil
}
