package skills

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/phodal/pero/harness/go/fstools"
)

const MaxSelectedSkills = 512
const MaxResourcesPerRoot = 1024
const MaxResourceFileBytes = 1 << 20

// FileSelection is the operator's exact file selection and already compiled
// instructions. Definition.Digest identifies the original, unexpanded bytes.
// ResourcePaths are exact slash-separated paths relative to Root.
type FileSelection struct {
	Root, Path                    string
	Definition                    Definition
	UserInvocable, ModelInvocable bool
	ResourcePaths                 []string
}

type selectedSource struct {
	root, path string
}

type selectedResource struct {
	files  *fstools.ScopedTextFiles
	path   string
	digest string
}

// OpenSelected combines legacy roots and explicit compiled selections in one
// fixed catalog. No selection leaves skills disabled, without discovery.
func OpenSelected(ctx context.Context, roots []string, selected []FileSelection) (_ *Catalog, err error) {
	if len(roots) == 0 && len(selected) == 0 {
		return nil, nil
	}
	if len(selected) > MaxSelectedSkills {
		return nil, errors.New("skills: selected skill count limit exceeded")
	}
	var c *Catalog
	if len(roots) > 0 {
		c, err = Open(ctx, roots)
		if err != nil {
			return nil, err
		}
	} else {
		c = &Catalog{entries: make(map[string]entry)}
	}
	c.resources = make(map[selectedSource]selectedResource)
	resourcesPerRoot := make(map[string]int)
	defer func() {
		if err != nil {
			_ = c.Close()
		}
	}()
	for _, selection := range selected {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		name := selection.Definition.Name
		if !validSelectedName(name) {
			return nil, errors.New("skills: selected definition requires a valid name")
		}
		if _, exists := c.entries[name]; exists {
			return nil, fmt.Errorf("skills: duplicate selected name %q", name)
		}
		before, statErr := os.Lstat(selection.Root)
		if statErr != nil || !before.IsDir() {
			return nil, errors.New("skills: selected root must be an existing directory")
		}
		files, openErr := fstools.OpenScopedTextFiles(selection.Root, []string{selection.Path}, MaxFileBytes)
		if openErr != nil {
			return nil, fmt.Errorf("skills: selected definition unavailable: %w", openErr)
		}
		c.ownedFiles = append(c.ownedFiles, files)
		if !files.MatchesRoot(before) {
			return nil, errors.New("skills: selected root changed while opening")
		}
		original, readErr := files.Read(ctx, selection.Path)
		if readErr != nil {
			return nil, readErr
		}
		if original.Digest != selection.Definition.Digest {
			return nil, errors.New("skills: selected content changed since compilation; restart to select again")
		}
		definition := selection.Definition
		definition.AllowedTools = append([]string(nil), definition.AllowedTools...)
		definition.Claude = true
		definition.ResourceBase = selection.Root
		definition.Directory = filepath.ToSlash(filepath.Dir(selection.Path))
		definition.Resources = nil
		e := entry{definition: definition, path: selection.Path, files: files, userInvocable: selection.UserInvocable, modelInvocable: selection.ModelInvocable, resources: make(map[string]selectedResource)}
		var missing []string
		for _, path := range selection.ResourcePaths {
			if _, duplicate := e.resources[path]; duplicate {
				continue
			}
			key := selectedSource{selection.Root, path}
			if cached, ok := c.resources[key]; ok {
				if !cached.files.MatchesRoot(before) {
					return nil, errors.New("skills: resource selection belongs to a replaced root")
				}
				e.resources[path] = cached
			} else {
				// Mark the key to deduplicate this selection before opening batches.
				e.resources[path] = selectedResource{}
				missing = append(missing, path)
			}
		}
		if resourcesPerRoot[selection.Root]+len(missing) > MaxResourcesPerRoot {
			return nil, errors.New("skills: resource count limit exceeded")
		}
		for start := 0; start < len(missing); start += 32 {
			end := min(start+32, len(missing))
			batch := missing[start:end]
			scope, openErr := fstools.OpenScopedTextFiles(selection.Root, batch, MaxResourceFileBytes)
			if openErr != nil {
				return nil, fmt.Errorf("skills: selected resource unavailable: %w", openErr)
			}
			c.ownedFiles = append(c.ownedFiles, scope)
			if !scope.MatchesRoot(before) {
				return nil, errors.New("skills: selected resource root changed while opening")
			}
			for _, path := range batch {
				text, readErr := scope.Read(ctx, path)
				if readErr != nil {
					return nil, readErr
				}
				resource := selectedResource{scope, path, text.Digest}
				c.resources[selectedSource{selection.Root, path}] = resource
				e.resources[path] = resource
			}
		}
		resourcesPerRoot[selection.Root] += len(missing)
		for path := range e.resources {
			definition.Resources = append(definition.Resources, path)
		}
		sort.Strings(definition.Resources)
		e.definition = definition
		c.entries[name] = e
	}
	return c, nil
}

func validSelectedName(name string) bool {
	parts := strings.Split(name, ":")
	if len(parts) < 1 || len(parts) > 2 {
		return false
	}
	for i, part := range parts {
		if part == "" || (i == len(parts)-1 && len(part) > 64) {
			return false
		}
		for _, r := range part {
			if len(parts) == 2 && i == 0 && ((r >= 'A' && r <= 'Z') || r == '.' || r == '_') {
				continue
			}
			if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' {
				return false
			}
		}
	}
	return true
}

func (c *Catalog) ListResources(ctx context.Context, name, digest string) ([]string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, err := c.lookup(ctx, name, digest)
	if err != nil {
		return nil, err
	}
	definition, err := c.definition(ctx, e)
	return definition.Resources, err
}

// ReadResource reads an operator-selected resource. Visibility controls invoking
// instructions, not reading explicitly selected resources after a user invoke.
func (c *Catalog) ReadResource(ctx context.Context, name, digest, path string) (fstools.ScopedText, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, err := c.lookup(ctx, name, digest)
	if err != nil {
		return fstools.ScopedText{}, err
	}
	if _, err := c.definition(ctx, e); err != nil {
		return fstools.ScopedText{}, err
	}
	resource, ok := e.resources[path]
	if !ok {
		return fstools.ScopedText{}, errors.New("skills: resource is outside the selected manifest")
	}
	text, err := resource.files.Read(ctx, resource.path)
	if err != nil {
		return fstools.ScopedText{}, fmt.Errorf("skills: selected resource unavailable; restart to select again: %w", err)
	}
	if text.Digest != resource.digest {
		return fstools.ScopedText{}, errors.New("skills: selected resource changed; restart to select again")
	}
	return text, nil
}
