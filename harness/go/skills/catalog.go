// Package skills provides an opt-in, read-only catalog of explicitly selected
// SKILL.md files. It is not a script runner, permission engine or live registry.
package skills

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/phodal/pero/harness/go/fstools"
	"gopkg.in/yaml.v3"
)

const MaxRoots = 8
const MaxEntries = 512
const MaxSkills = 64
const MaxFileBytes = 64 << 10

type Summary struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Digest      string `json:"digest"`
}
type Definition struct {
	Summary
	Content string `json:"content"`
}
type entry struct {
	summary  Summary
	path     string
	files    *fstools.ScopedTextFiles
	disabled bool
}

// Catalog owns a fixed launch-time selection. New, removed or changed files
// require a new catalog; reads never silently refresh the authorized manifest.
type Catalog struct {
	// Private deterministic discovery race fixture; never set by tool arguments.
	openFiles func(string, []string, int64) (*fstools.ScopedTextFiles, error)
	afterRead func()
	mu        sync.Mutex
	entries   map[string]entry
	closed    bool
}

// Open accepts only explicit roots. Layout is root/<skill-name>/SKILL.md;
// discovery visits one level, never home/project defaults or resource files.
func Open(ctx context.Context, roots []string) (_ *Catalog, err error) {
	if len(roots) == 0 || len(roots) > MaxRoots {
		return nil, errors.New("skills: specify between 1 and 8 explicit roots")
	}
	c := &Catalog{entries: make(map[string]entry)}
	defer func() {
		if err != nil {
			_ = c.Close()
		}
	}()
	seen := map[string]bool{}
	visited := 0
	for _, name := range roots {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if strings.TrimSpace(name) == "" {
			return nil, errors.New("skills: empty root")
		}
		absolute, err := filepath.Abs(name)
		if err != nil {
			return nil, err
		}
		canonical, err := filepath.EvalSymlinks(absolute)
		if err != nil || canonical != absolute {
			return nil, errors.New("skills: root must be an existing non-symlink directory")
		}
		if seen[absolute] {
			return nil, errors.New("skills: duplicate root")
		}
		seen[absolute] = true
		if err := c.scan(ctx, absolute, &visited); err != nil {
			return nil, err
		}
	}
	return c, nil
}
func (c *Catalog) scan(ctx context.Context, path string, visited *int) error {
	before, err := os.Lstat(path)
	if err != nil || !before.IsDir() {
		return errors.New("skills: root is not a directory")
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return err
	}
	defer root.Close()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(before, opened) {
		return errors.New("skills: root changed during discovery")
	}
	directory, err := root.Open(".")
	if err != nil {
		return err
	}
	defer directory.Close()
	children, err := directory.ReadDir(MaxEntries - *visited + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	*visited += len(children)
	if *visited > MaxEntries {
		return errors.New("skills: directory entry limit exceeded")
	}
	sort.Slice(children, func(i, j int) bool { return children[i].Name() < children[j].Name() })
	for _, child := range children {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !child.IsDir() || child.Type()&os.ModeSymlink != 0 || !validName(child.Name()) {
			continue
		}
		relative := child.Name() + "/SKILL.md"
		if _, err := root.Lstat(relative); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return err
		}
		if len(c.entries) >= MaxSkills {
			return errors.New("skills: skill count limit exceeded")
		}
		selectFiles := c.openFiles
		if selectFiles == nil {
			selectFiles = fstools.OpenScopedTextFiles
		}
		files, err := selectFiles(path, []string{relative}, MaxFileBytes)
		if err != nil {
			return fmt.Errorf("skills: %s: %w", relative, err)
		}
		if !files.MatchesRoot(before) {
			files.Close()
			return errors.New("skills: selected root differs from discovery root")
		}
		text, err := files.Read(ctx, relative)
		if c.afterRead != nil {
			c.afterRead()
		}
		if err != nil {
			files.Close()
			return err
		}
		definition, disabled, err := parse(text.Text)
		if err != nil || definition.Name != child.Name() {
			files.Close()
			return fmt.Errorf("skills: invalid SKILL.md for %q: name must match directory and frontmatter must be valid: %v", child.Name(), err)
		}
		if _, exists := c.entries[definition.Name]; exists {
			files.Close()
			return fmt.Errorf("skills: duplicate name %q; no root takes precedence", definition.Name)
		}
		definition.Digest = text.Digest
		c.entries[definition.Name] = entry{definition.Summary, relative, files, disabled}
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, after) {
		return errors.New("skills: root changed during discovery")
	}
	return nil
}
func (c *Catalog) List(ctx context.Context) ([]Summary, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, errors.New("skills: catalog closed")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	rows := make([]Summary, 0, len(c.entries))
	for _, e := range c.entries {
		if !e.disabled {
			rows = append(rows, e.summary)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })
	return rows, nil
}
func (c *Catalog) Read(ctx context.Context, name, digest string) (Definition, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return Definition{}, errors.New("skills: catalog closed")
	}
	if err := ctx.Err(); err != nil {
		return Definition{}, err
	}
	e, ok := c.entries[name]
	if !ok || e.disabled {
		return Definition{}, errors.New("skills: unknown or model-disabled skill")
	}
	if digest != e.summary.Digest {
		return Definition{}, errors.New("skills: digest must match the launch-time catalog; call skill with {} to list this catalog, then copy the listed digest rather than guessing it")
	}
	text, err := e.files.Read(ctx, e.path)
	if err != nil {
		return Definition{}, fmt.Errorf("skills: selected file unavailable or changed; restart to select again: %w", err)
	}
	if text.Digest != digest {
		return Definition{}, errors.New("skills: content changed; restart to select again")
	}
	definition, _, err := parse(text.Text)
	definition.Digest = digest
	return definition, err
}
func (c *Catalog) Close() error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	var err error
	for _, e := range c.entries {
		err = errors.Join(err, e.files.Close())
	}
	return err
}

// Adapted from the pinned DSH filesystem parser; product metadata and implicit
// invocation hooks are intentionally absent. Unknown frontmatter is inert.
func parse(text string) (Definition, bool, error) {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	if !strings.HasPrefix(text, "---\n") {
		return Definition{}, false, errors.New("YAML frontmatter required")
	}
	closing := strings.Index(text[4:], "\n---")
	if closing < 0 {
		return Definition{}, false, errors.New("unclosed frontmatter")
	}
	closing += 4
	end := closing + len("\n---")
	if end < len(text) && text[end] != '\n' {
		return Definition{}, false, errors.New("invalid frontmatter delimiter")
	}
	var header struct {
		Name        string `yaml:"name"`
		Description string `yaml:"description"`
		Disabled    bool   `yaml:"disable-model-invocation"`
	}
	if err := yaml.Unmarshal([]byte(text[4:closing]), &header); err != nil {
		return Definition{}, false, err
	}
	if !validName(header.Name) || len(header.Description) > 1024 || strings.TrimSpace(header.Description) == "" {
		return Definition{}, false, errors.New("invalid name or description (maximum 1024 bytes)")
	}
	body := ""
	if end < len(text) {
		body = strings.TrimSpace(text[end+1:])
	}
	return Definition{Summary: Summary{Name: header.Name, Description: header.Description}, Content: body}, header.Disabled, nil
}
func validName(name string) bool {
	if name == "" || len(name) > 64 || strings.Contains(name, "--") {
		return false
	}
	for i, r := range name {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			continue
		}
		if r != '-' || i == 0 || i == len(name)-1 {
			return false
		}
	}
	return true
}
