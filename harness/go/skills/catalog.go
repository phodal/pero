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

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/fstools"
	"gopkg.in/yaml.v3"
)

const MaxRoots = 8
const MaxEntries = 512
const MaxSkills = 64
const MaxFileBytes = 64 << 10

type Summary struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Digest       string   `json:"digest"`
	ArgumentHint string   `json:"argumentHint,omitempty"`
	Paths        []string `json:"paths,omitempty"`
}
type Definition struct {
	Summary
	Content         string             `json:"content"`
	ResourceBase    string             `json:"resourceBase,omitempty"`
	Directory       string             `json:"directory,omitempty"`
	Resources       []string           `json:"resources,omitempty"`
	AllowedTools    []string           `json:"allowedTools,omitempty"`
	DisallowedTools []string           `json:"disallowedTools,omitempty"`
	Model           string             `json:"model,omitempty"`
	Effort          string             `json:"effort,omitempty"`
	Context         string             `json:"context,omitempty"`
	Agent           string             `json:"agent,omitempty"`
	Background      *bool              `json:"background,omitempty"`
	Claude          bool               `json:"-"`
	Shell           string             `json:"shell,omitempty"`
	Hooks           []claudehooks.Hook `json:"-"`
	// Rendered marks trusted invocation output, never model-supplied content.
	Rendered bool `json:"-"`
}
type entry struct {
	definition                    Definition
	path                          string
	files                         *fstools.ScopedTextFiles
	userInvocable, modelInvocable bool
	resources                     map[string]selectedResource
}

// Catalog owns a fixed launch-time selection. New, removed or changed files
// require a new catalog; reads never silently refresh the authorized manifest.
type Catalog struct {
	// Private deterministic discovery race fixture; never set by tool arguments.
	openFiles  func(string, []string, int64) (*fstools.ScopedTextFiles, error)
	afterRead  func()
	mu         sync.Mutex
	roots      []string
	rescanning bool
	entries    map[string]entry
	resources  map[selectedSource]selectedResource
	ownedFiles []*fstools.ScopedTextFiles
	closed     bool
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
		c.roots = append(c.roots, absolute)
		if err := c.scan(ctx, absolute, &visited); err != nil {
			return nil, err
		}
	}
	return c, nil
}

// Rescan reads the same authorized roots again and adds skill directories that
// were not present at launch. Definitions already in the catalog stay as they
// were authorized.
func (c *Catalog) Rescan(ctx context.Context) error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errors.New("skills: catalog is closed")
	}
	c.rescanning = true
	defer func() { c.rescanning = false }()
	visited := 0
	for _, root := range c.roots {
		if err := c.scan(ctx, root, &visited); err != nil {
			return err
		}
	}
	return nil
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
			if c.rescanning {
				continue
			}
			return fmt.Errorf("skills: duplicate name %q; no root takes precedence", definition.Name)
		}
		definition.Digest = text.Digest
		c.entries[definition.Name] = entry{definition: definition, path: relative, files: files, userInvocable: !disabled, modelInvocable: !disabled}
		c.ownedFiles = append(c.ownedFiles, files)
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, after) {
		return errors.New("skills: root changed during discovery")
	}
	return nil
}
func (c *Catalog) List(ctx context.Context) ([]Summary, error) {
	return c.list(ctx, false)
}

// UserList includes user-invocable definitions that are hidden from model
// discovery. Legacy roots preserve their existing disabled behavior.
func (c *Catalog) UserList(ctx context.Context) ([]Summary, error) {
	return c.list(ctx, true)
}

func (c *Catalog) list(ctx context.Context, user bool) ([]Summary, error) {
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
		if user && e.userInvocable || !user && e.modelInvocable {
			rows = append(rows, e.definition.Summary)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })
	return rows, nil
}

// Preload returns one selected skill body for a trusted agent. An exact name
// wins. A bare name matches one plugin-qualified skill. The text does not
// grant tools.
func (c *Catalog) Preload(ctx context.Context, name string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return "", errors.New("skills: catalog closed")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	var exact, suffix []entry
	for _, candidate := range c.entries {
		switch {
		case candidate.definition.Name == name:
			exact = append(exact, candidate)
		case strings.HasSuffix(candidate.definition.Name, ":"+name):
			suffix = append(suffix, candidate)
		}
	}
	chosen := exact
	if len(chosen) == 0 {
		chosen = suffix
	}
	if len(chosen) != 1 {
		return "", fmt.Errorf("skills: skill %q must match one selected skill", name)
	}
	definition, err := c.definition(ctx, chosen[0])
	if err != nil {
		return "", err
	}
	return definition.Content, nil
}

func (c *Catalog) Read(ctx context.Context, name, digest string) (Definition, error) {
	return c.read(ctx, name, digest, false)
}

func (c *Catalog) ReadUser(ctx context.Context, name, digest string) (Definition, error) {
	return c.read(ctx, name, digest, true)
}

func (c *Catalog) read(ctx context.Context, name, digest string, user bool) (Definition, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, err := c.lookup(ctx, name, digest)
	if err != nil {
		return Definition{}, err
	}
	if user && !e.userInvocable || !user && !e.modelInvocable {
		return Definition{}, errors.New("skills: skill is unavailable to this invocation source")
	}
	return c.definition(ctx, e)
}

// lookup and definition run under the Catalog mutex. They own snapshot checks
// for both instruction and resource reads.
func (c *Catalog) lookup(ctx context.Context, name, digest string) (entry, error) {
	if c.closed {
		return entry{}, errors.New("skills: catalog closed")
	}
	if err := ctx.Err(); err != nil {
		return entry{}, err
	}
	e, ok := c.entries[name]
	if !ok {
		return entry{}, errors.New("skills: unknown skill")
	}
	if digest != e.definition.Digest {
		return entry{}, errors.New("skills: digest must match the launch-time catalog; call skill with {} to list this catalog, then copy the listed digest rather than guessing it")
	}
	return e, nil
}

func (c *Catalog) definition(ctx context.Context, e entry) (Definition, error) {
	text, err := e.files.Read(ctx, e.path)
	if err != nil {
		return Definition{}, fmt.Errorf("skills: selected file unavailable or changed; restart to select again: %w", err)
	}
	if text.Digest != e.definition.Digest {
		return Definition{}, errors.New("skills: content changed; restart to select again")
	}
	definition := e.definition
	definition.Resources = append([]string(nil), definition.Resources...)
	definition.AllowedTools = append([]string(nil), definition.AllowedTools...)
	definition.DisallowedTools = append([]string(nil), definition.DisallowedTools...)
	definition.Paths = append([]string(nil), definition.Paths...)
	if definition.Background != nil {
		background := *definition.Background
		definition.Background = &background
	}
	return definition, nil
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
	for _, files := range c.ownedFiles {
		err = errors.Join(err, files.Close())
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
		Name         string `yaml:"name"`
		Description  string `yaml:"description"`
		ArgumentHint string `yaml:"argument-hint"`
		Disabled     bool   `yaml:"disable-model-invocation"`
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
	return Definition{Summary: Summary{Name: header.Name, Description: header.Description, ArgumentHint: strings.TrimSpace(header.ArgumentHint)}, Content: body}, header.Disabled, nil
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
