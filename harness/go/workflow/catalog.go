package workflow

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/plugins"
)

type selectedScript struct {
	path, relative, plugin, digest string
	files                          *fstools.ScopedTextFiles
}

type scriptCatalog struct {
	scripts map[string]selectedScript
	files   []*fstools.ScopedTextFiles
}

func isWorkflowScript(path string) bool {
	return strings.HasPrefix(path, "workflows/") && (strings.HasSuffix(path, ".js") || strings.HasSuffix(path, ".mjs"))
}

// HasScripts reports whether the explicitly compiled resource manifests contain
// workflow scripts. It performs no implicit filesystem discovery.
func HasScripts(packages []plugins.Package) bool {
	for _, pkg := range packages {
		for _, path := range pkg.Resources {
			if isWorkflowScript(path) {
				return true
			}
		}
	}
	return false
}

func openCatalog(ctx context.Context, packages []plugins.Package) (_ *scriptCatalog, err error) {
	catalog := &scriptCatalog{scripts: make(map[string]selectedScript)}
	defer func() {
		if err != nil {
			_ = catalog.close()
		}
	}()
	for _, pkg := range packages {
		var paths []string
		for _, path := range pkg.Resources {
			if isWorkflowScript(path) {
				paths = append(paths, path)
			}
		}
		for start := 0; start < len(paths); start += 32 {
			batch := paths[start:min(start+32, len(paths))]
			files, err := fstools.OpenScopedTextFiles(pkg.Root, batch, 1<<20)
			if err != nil {
				return nil, fmt.Errorf("workflow: open selected scripts: %w", err)
			}
			catalog.files = append(catalog.files, files)
			for _, path := range batch {
				text, err := files.Read(ctx, path)
				if err != nil {
					return nil, err
				}
				absolute := filepath.Join(pkg.Root, filepath.FromSlash(path))
				if _, exists := catalog.scripts[absolute]; exists {
					return nil, errors.New("workflow: duplicate selected script")
				}
				catalog.scripts[absolute] = selectedScript{path: absolute, relative: path, plugin: pkg.Definition.Name, digest: text.Digest, files: files}
			}
		}
	}
	return catalog, nil
}

func (catalog *scriptCatalog) read(ctx context.Context, path string) (selectedScript, string, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return selectedScript{}, "", errors.New("workflow: scriptPath must be an absolute selected package script")
	}
	selected, found := catalog.scripts[path]
	if !found {
		return selectedScript{}, "", errors.New("workflow: scriptPath is outside the selected package workflow scripts")
	}
	text, err := selected.files.Read(ctx, selected.relative)
	if err != nil || text.Digest != selected.digest {
		return selectedScript{}, "", errors.New("workflow: selected script changed or is unavailable; restart to select again")
	}
	return selected, text.Text, nil
}

func (catalog *scriptCatalog) close() error {
	var err error
	for _, files := range catalog.files {
		err = errors.Join(err, files.Close())
	}
	return err
}
