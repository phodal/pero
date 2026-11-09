package plugins

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

var markdownInlineResource = regexp.MustCompile(`\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)`)
var markdownNamedResource = regexp.MustCompile(`(?m)^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|([^\s]+))`)

// maxSkillBundleBytes bounds the selected directory and its linked text files.
// The checkout itself is refused before blobs above this budget are downloaded.
const maxSkillBundleBytes int64 = 8 << 20

// bundleSkillResources keeps the chosen subtree and linked repository text files.
// Related SKILLs and plugin integration files are not imported through links.
func bundleSkillResources(ctx context.Context, original, target, revision, skillPath string) error {
	selectedDir := path.Dir(skillPath)
	root, err := os.OpenRoot(original)
	if err != nil {
		return err
	}
	defer root.Close()
	var markdown []string
	var copiedBytes int64
	copied := make(map[string]bool)
	selected, err := fs.Sub(os.DirFS(original), selectedDir)
	if err != nil {
		return err
	}
	err = fs.WalkDir(selected, ".", func(relative string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if excludedSkillResource(relative) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("plugins: selected skill resources contain unsupported symbolic links")
		}
		if entry.IsDir() {
			return nil
		}
		resource := path.Join(selectedDir, relative)
		if strings.EqualFold(entry.Name(), "SKILL.md") && resource != skillPath {
			return errors.New("plugins: selected directory contains other skills; select an individual catalog entry")
		}
		file, err := selected.Open(relative)
		if err != nil {
			return err
		}
		defer file.Close()
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if err = accountSkillBytes(&copiedBytes, info.Size()); err != nil {
			return err
		}
		destination := filepath.Join(target, filepath.FromSlash(resource))
		if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
			return err
		}
		// Copied resources are data. Do not retain executable bits from the source tree.
		output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(output, file)
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		copied[resource] = true
		if markdownResource(resource) {
			markdown = append(markdown, resource)
		}
		return nil
	})
	if err != nil {
		return err
	}
	// Tree names come from the pinned commit without checking out unrelated data.
	names, err := runGit(ctx, "resource index", "-C", original, "ls-tree", "-r", "-z", "--name-only", revision)
	if err != nil {
		return err
	}
	available := make(map[string]bool)
	for _, name := range strings.Split(names, "\x00") {
		available[name] = true
	}
	for len(markdown) > 0 {
		document := markdown[0]
		markdown = markdown[1:]
		content, err := readConfiguration(root, document)
		if err != nil {
			return err
		}
		for _, pattern := range []*regexp.Regexp{markdownInlineResource, markdownNamedResource} {
			for _, match := range pattern.FindAllStringSubmatch(string(content), -1) {
				link := match[1]
				if link == "" {
					link = match[2]
				}
				parsed, err := url.Parse(link)
				if err != nil {
					return errors.New("plugins: malformed Markdown resource link")
				}
				if parsed.Scheme != "" || parsed.Host != "" || parsed.Path == "" {
					continue
				}
				resource := path.Clean(path.Join(path.Dir(document), parsed.Path))
				if strings.Contains(parsed.Path, "\\") || path.IsAbs(parsed.Path) || resource == ".." || strings.HasPrefix(resource, "../") {
					return errors.New("plugins: Markdown resource reference is outside the pinned repository")
				}
				if copied[resource] || !available[resource] || excludedSkillResource(resource) || strings.EqualFold(path.Base(resource), "SKILL.md") || !textResourceExtension(path.Ext(resource)) {
					continue
				}
				if err = checkoutGitPaths(ctx, original, revision, resource); err != nil {
					return err
				}
				info, err := root.Lstat(filepath.FromSlash(resource))
				if err != nil || !info.Mode().IsRegular() {
					return errors.New("plugins: shared skill resources must be regular repository files")
				}
				data, err := readConfiguration(root, resource)
				if err != nil {
					return fmt.Errorf("plugins: cannot read a linked skill resource: %w", err)
				}
				if err = accountSkillBytes(&copiedBytes, int64(len(data))); err != nil {
					return err
				}
				destination := filepath.Join(target, filepath.FromSlash(resource))
				if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
					return err
				}
				if err = os.WriteFile(destination, data, 0600); err != nil {
					return err
				}
				copied[resource] = true
				if markdownResource(resource) {
					markdown = append(markdown, resource)
				}
			}
		}
	}
	return nil
}

func accountSkillBytes(total *int64, size int64) error {
	if size < 0 || size > maxSkillBundleBytes || *total > maxSkillBundleBytes-size {
		return errors.New("plugins: selected skill directory exceeds the size limit")
	}
	*total += size
	return nil
}

func markdownResource(resource string) bool {
	return strings.EqualFold(path.Ext(resource), ".md") || strings.EqualFold(path.Ext(resource), ".markdown")
}
func excludedSkillResource(resource string) bool {
	for _, component := range strings.Split(resource, "/") {
		if component == ".git" || component == ".claude-plugin" || component == ".codex-plugin" || component == "hooks" || component == ".mcp.json" || component == ".lsp.json" {
			return true
		}
	}
	return false
}
