package agentinstructions

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
)

type instructionFile struct{ abs, display, scope, content string }

func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func splitScope(scope string) (string, string) {
	index := strings.IndexByte(scope, 0)
	if index < 0 {
		return scope, ""
	}
	return scope[:index], scope[index+1:]
}

func (a *App) read(ctx context.Context, touched ...string) ([]instructionFile, error) {
	if a.hierarchical {
		return a.readHierarchy(ctx, touched)
	}
	// The shared reader intentionally reports a generic error for missing
	// manifest entries. Probe only absence, never read bytes by pathname; both
	// admission and every actual read remain descriptor-rooted.
	if err := a.files.CheckCWD(a.files.Path()); err != nil {
		return nil, err
	}
	if _, err := os.Lstat(filepath.Join(a.files.Path(), "AGENTS.md")); errors.Is(err, os.ErrNotExist) {
		if err := a.files.CheckCWD(a.files.Path()); err != nil {
			return nil, err
		}
		return nil, nil
	}
	value, err := a.files.Read(ctx, "AGENTS.md")
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []instructionFile{{display: "AGENTS.md", scope: ".\x00AGENTS.md", content: value.Text}}, nil
}

func instructionPaths(events []harness.Event) []string {
	var paths []string
	for _, event := range events {
		if event.Type == "workspace-instructions/touch" {
			var touch instructionTouch
			if json.Unmarshal(event.Data, &touch) == nil {
				paths = append(paths, touch.Paths...)
			}
			continue
		}
		if event.Type != "tool/call" {
			continue
		}
		var call struct {
			Name      string
			Arguments json.RawMessage
		}
		if json.Unmarshal(event.Data, &call) != nil {
			continue
		}
		paths = append(paths, toolInstructionPaths(call.Name, call.Arguments)...)
	}
	return paths
}

func toolInstructionPaths(name string, arguments json.RawMessage) []string {
	switch name {
	case "Read", "Write", "Edit", "NotebookEdit", "NotebookRead", "PDFRead", "NotebookImage", "read_file", "write_file", "edit_file", "notebook_read", "pdf_read", "notebook_image", "apply_patch":
	default:
		return nil
	}
	var args struct {
		Path         string `json:"path"`
		FilePath     string `json:"file_path"`
		NotebookPath string `json:"notebook_path"`
		Patch        string `json:"patch"`
	}
	if json.Unmarshal(arguments, &args) != nil {
		return nil
	}
	if name == "apply_patch" {
		names, err := fstools.PatchPaths(args.Patch)
		if err == nil {
			return names
		}
	} else {
		name := args.Path
		if args.FilePath != "" {
			name = args.FilePath
		}
		if args.NotebookPath != "" {
			name = args.NotebookPath
		}
		if name != "" {
			return []string{name}
		}
	}
	return nil
}

func (a *App) readHierarchy(ctx context.Context, touched []string) ([]instructionFile, error) {
	directories := map[string]bool{".": true}
	for _, name := range touched {
		if filepath.IsAbs(name) {
			relative, err := filepath.Rel(a.files.Path(), name)
			if err != nil || !filepath.IsLocal(relative) {
				relative, err = filepath.Rel(a.workspaceAlias, name)
			}
			if err != nil || !filepath.IsLocal(relative) {
				continue
			}
			name = filepath.ToSlash(relative)
		}
		if !filepath.IsLocal(name) {
			continue
		}
		name = filepath.ToSlash(name)
		for dir := path.Dir(name); dir != "."; dir = path.Dir(dir) {
			directories[dir] = true
		}
	}
	dirs := make([]string, 0, len(directories))
	for dir := range directories {
		dirs = append(dirs, dir)
	}
	sort.Slice(dirs, func(i, j int) bool {
		if dirs[i] == dirs[j] {
			return false
		}
		di, dj := strings.Count(dirs[i], "/"), strings.Count(dirs[j], "/")
		if dirs[i] == "." {
			return true
		}
		if dirs[j] == "." {
			return false
		}
		if di != dj {
			return di < dj
		}
		return dirs[i] < dirs[j]
	})
	if len(dirs) > 64 {
		return nil, errors.New("workspace instruction discovery exceeds 64 directories; start a focused session")
	}
	var files []instructionFile
	for _, dir := range dirs {
		for _, base := range []string{"CLAUDE.md", "AGENTS.md"} {
			name := path.Join(dir, base)
			if err := a.files.CheckCWD(a.files.Path()); err != nil {
				return nil, err
			}
			if _, err := os.Lstat(filepath.Join(a.files.Path(), filepath.FromSlash(name))); errors.Is(err, os.ErrNotExist) {
				continue
			}
			value, err := a.files.Read(ctx, name)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", name, err)
			}
			files = append(files, instructionFile{display: name, scope: dir + "\x00" + base, content: value.Text})
		}
	}
	return files, nil
}
