// Package fstools exposes bounded descriptor-rooted text operations. It is not
// an OS sandbox. Selected filesystem authority is the launch-time workspace.
package fstools

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"
)

const MaxFileBytes = 1 << 20
const MaxOutputBytes = 64 << 10
const MaxEntries = 256

type Workspace struct {
	afterCreate      func() // private deterministic race/failure injection, never tool arguments
	beforePublish    func() // private Windows exclusive-publication fixture
	beforeSearchRead func() // private deterministic root-replacement fixture

	mu       sync.Mutex
	root     *os.Root
	path     string
	identity os.FileInfo
}

func OpenWorkspace(name string) (*Workspace, error) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" && runtime.GOOS != "windows" {
		return nil, errors.New("native workspace tools require supported descriptor-rooted Unix semantics")
	}
	if !filepath.IsAbs(name) {
		return nil, errors.New("workspace must be an absolute path")
	}
	canonical, err := canonicalWorkspacePath(name)
	if err != nil {
		return nil, err
	}
	info, err := scopedPathInfo(canonical)
	if err != nil || !info.IsDir() {
		return nil, errors.New("workspace must be a directory")
	}
	root, err := os.OpenRoot(canonical)
	if err != nil {
		return nil, err
	}
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(info, opened) {
		root.Close()
		return nil, errors.New("workspace changed during open")
	}
	return &Workspace{root: root, path: canonical, identity: opened}, nil
}
func (w *Workspace) Path() string { return w.path }

// SupportsReplacement reports native capability, not session write permission.
// Windows supports exclusive creation but cannot safely preserve all existing metadata.
func (w *Workspace) SupportsReplacement() bool { return nativeFileReplacement }
func (w *Workspace) Close() error              { w.mu.Lock(); defer w.mu.Unlock(); return w.root.Close() }
func (w *Workspace) CheckCWD(cwd string) error {
	canonical, err := canonicalWorkspacePath(cwd)
	if err != nil || canonical != w.path {
		return errors.New("session cwd must equal the configured workspace")
	}
	return w.check()
}
func (w *Workspace) check() error {
	info, err := scopedPathInfo(w.path)
	if err != nil || !info.IsDir() || !os.SameFile(w.identity, info) {
		return errors.New("workspace directory was replaced")
	}
	return nil
}
func relative(name string, directory bool) (string, error) {
	if name == "" && directory {
		name = "."
	}
	if name == "." && directory {
		return name, nil
	}
	if name == "" || strings.Contains(name, "\\") || !fs.ValidPath(name) || filepath.IsAbs(name) || strings.ContainsRune(name, 0) || !nativeRelativePath(name) {
		return "", errors.New("path must be a canonical workspace-relative slash path")
	}
	return name, nil
}

// Reject symlinks, even within the root, so traversals have one explicit policy.
func (w *Workspace) checked(name string, directory bool) (string, error) {
	if err := w.check(); err != nil {
		return "", err
	}
	name, err := relative(name, directory)
	if err != nil {
		return "", err
	}
	parts := strings.Split(name, "/")
	for i := range parts {
		p := strings.Join(parts[:i+1], "/")
		info, e := w.root.Lstat(p)
		if errors.Is(e, os.ErrNotExist) && i == len(parts)-1 {
			return name, nil
		}
		if e != nil {
			return "", e
		}
		if scopedLink(info) {
			return "", errors.New("symlink paths are not allowed")
		}
		if i < len(parts)-1 && !info.IsDir() {
			return "", errors.New("path parent is not a directory")
		}
	}
	return name, nil
}
func validText(data []byte) bool { return !bytes.ContainsRune(data, 0) && utf8.Valid(data) }
func sameFileInfo(left, right fs.FileInfo) bool {
	return left != nil && right != nil && os.SameFile(left, right) && left.Size() == right.Size() && left.ModTime() == right.ModTime() && left.Mode() == right.Mode()
}

// selectFile binds the reused scoped algorithm to the original workspace object,
// not whatever directory currently occupies its pathname.
func (w *Workspace) selectFile(name string) (*ScopedTextFiles, error) {
	scope, err := openScopedTextFiles(w.path, []string{name}, MaxFileBytes, !w.SupportsReplacement())
	if err != nil {
		return nil, err
	}
	if !os.SameFile(w.identity, scope.identity) {
		scope.Close()
		return nil, errors.New("workspace identity changed while selecting file")
	}
	return scope, nil
}

func (w *Workspace) Read(ctx context.Context, name string) (ScopedText, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	name, err := w.checked(name, false)
	if err != nil {
		return ScopedText{}, err
	}
	selected, err := w.selectFile(name)
	if err != nil {
		return ScopedText{}, err
	}
	defer selected.Close()
	if err := w.check(); err != nil {
		return ScopedText{}, err
	}
	return selected.Read(ctx, name)
}

func (w *Workspace) Write(ctx context.Context, name, text string) (ScopedTextReceipt, error) {
	return w.write(ctx, name, text, false)
}

// WriteCreatingParents is the Claude Write contract. Directory creation is part
// of the already-approved file write and remains under the same workspace root.
func (w *Workspace) WriteCreatingParents(ctx context.Context, name, text string) (ScopedTextReceipt, error) {
	return w.write(ctx, name, text, true)
}

func (w *Workspace) write(ctx context.Context, name, text string, createParents bool) (ScopedTextReceipt, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if createParents {
		if len(text) > MaxFileBytes || !validText([]byte(text)) {
			return ScopedTextReceipt{}, errors.New("content must be UTF-8 text of at most 1 MiB without NUL")
		}
		if err := w.createParents(ctx, name); err != nil {
			return ScopedTextReceipt{}, err
		}
	}
	name, err := w.checked(name, false)
	if err != nil {
		return ScopedTextReceipt{}, err
	}
	if len(text) > MaxFileBytes || !validText([]byte(text)) {
		return ScopedTextReceipt{}, errors.New("content must be UTF-8 text of at most 1 MiB without NUL")
	}
	if err := ctx.Err(); err != nil {
		return ScopedTextReceipt{}, err
	}
	info, err := w.root.Lstat(name)
	if err == nil {
		if !w.SupportsReplacement() {
			return ScopedTextReceipt{Path: name, State: "not-applied"}, errors.New("Windows write_file creates new files only; replacement is unavailable")
		}
		if !info.Mode().IsRegular() {
			return ScopedTextReceipt{}, errors.New("target must be regular file")
		}
		selected, err := w.selectFile(name)
		if err != nil {
			return ScopedTextReceipt{}, err
		}
		defer selected.Close()
		before, err := selected.Read(ctx, name)
		if err != nil {
			return ScopedTextReceipt{}, err
		}
		if before.Text == text {
			return ScopedTextReceipt{Path: name, BeforeDigest: before.Digest, AfterDigest: before.Digest, State: "unchanged"}, nil
		}
		return selected.Replace(ctx, name, before.Digest, []byte(text), func(c context.Context) error {
			if err := c.Err(); err != nil {
				return err
			}
			return w.check()
		})
	}
	if !errors.Is(err, os.ErrNotExist) {
		return ScopedTextReceipt{}, err
	}
	return w.writeNew(ctx, name, text)
}

func (w *Workspace) createParents(ctx context.Context, name string) error {
	if err := w.check(); err != nil {
		return err
	}
	name, err := relative(name, false)
	if err != nil {
		return err
	}
	parts := strings.Split(path.Dir(name), "/")
	for i := range parts {
		if err := ctx.Err(); err != nil {
			return err
		}
		parent := strings.Join(parts[:i+1], "/")
		if parent == "." {
			continue
		}
		info, err := w.root.Lstat(parent)
		if errors.Is(err, os.ErrNotExist) {
			if err = w.root.Mkdir(parent, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				return err
			}
			info, err = w.root.Lstat(parent)
		}
		if err != nil {
			return err
		}
		if scopedLink(info) || !info.IsDir() {
			return errors.New("write parent must be a directory without symlinks")
		}
	}
	return w.check()
}

func (w *Workspace) Edit(ctx context.Context, name, oldText, newText string, all bool) (ScopedTextReceipt, error) {
	if !w.SupportsReplacement() {
		return ScopedTextReceipt{}, errors.New("native Windows file replacement is unavailable")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	name, err := w.checked(name, false)
	if err != nil {
		return ScopedTextReceipt{}, err
	}
	if oldText == "" || len(oldText) > MaxFileBytes || len(newText) > MaxFileBytes || !validText([]byte(oldText)) || !validText([]byte(newText)) {
		return ScopedTextReceipt{}, errors.New("edit requires nonempty bounded UTF-8 old_text and bounded new_text")
	}
	selected, err := w.selectFile(name)
	if err != nil {
		return ScopedTextReceipt{}, err
	}
	defer selected.Close()
	before, err := selected.Read(ctx, name)
	if err != nil {
		return ScopedTextReceipt{}, err
	}
	count := strings.Count(before.Text, oldText)
	if count == 0 || (!all && count != 1) {
		return ScopedTextReceipt{}, errors.New("old_text must match exactly once unless replace_all is true")
	}
	// Check expansion before allocating the replacement.
	if len(newText) > len(oldText) && (len(newText)-len(oldText)) > (MaxFileBytes-len(before.Text))/count {
		return ScopedTextReceipt{}, errors.New("edited content exceeds 1 MiB")
	}
	after := strings.ReplaceAll(before.Text, oldText, newText)
	return selected.Replace(ctx, name, before.Digest, []byte(after), func(c context.Context) error {
		if err := c.Err(); err != nil {
			return err
		}
		return w.check()
	})
}

type DirectoryEntry struct {
	Name      string `json:"name"`
	Directory bool   `json:"directory"`
	Symlink   bool   `json:"symlink"`
}
type DirectoryResult struct {
	Entries   []DirectoryEntry `json:"entries"`
	Truncated bool             `json:"truncated"`
}

func (w *Workspace) List(ctx context.Context, name string) (DirectoryResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	name, err := w.checked(name, true)
	if err != nil {
		return DirectoryResult{}, err
	}
	if err = ctx.Err(); err != nil {
		return DirectoryResult{}, err
	}
	dir, err := openScopedTextFile(w.root, name)
	if err != nil {
		return DirectoryResult{}, err
	}
	defer dir.Close()
	entries, err := dir.ReadDir(MaxEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return DirectoryResult{}, err
	}
	out := DirectoryResult{Entries: []DirectoryEntry{}, Truncated: len(entries) > MaxEntries}
	if len(entries) > MaxEntries {
		entries = entries[:MaxEntries]
	}
	for _, e := range entries {
		link, err := scopedEntryLink(e)
		if err != nil {
			return DirectoryResult{}, err
		}
		out.Entries = append(out.Entries, DirectoryEntry{e.Name(), e.IsDir(), link})
	}
	sort.Slice(out.Entries, func(i, j int) bool { return out.Entries[i].Name < out.Entries[j].Name })
	return out, ctx.Err()
}

type SearchMatch struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}
type SearchResult struct {
	Matches      []SearchMatch `json:"matches"`
	Truncated    bool          `json:"truncated"`
	ScannedFiles int           `json:"scanned_files"`
}

func (w *Workspace) Search(ctx context.Context, base, query string) (SearchResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	base, err := w.checked(base, true)
	if err != nil {
		return SearchResult{}, err
	}
	if query == "" || len(query) > 4096 {
		return SearchResult{}, errors.New("query must be 1..4096 bytes")
	}
	out := SearchResult{Matches: []SearchMatch{}}
	pending := []string{base}
	entriesSeen, totalBytes := 0, 0
	for len(pending) > 0 {
		if err = ctx.Err(); err != nil {
			return out, err
		}
		dirName := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		dir, err := openScopedTextFile(w.root, dirName)
		if err != nil {
			return out, err
		}
		entries, readErr := dir.ReadDir(513 - entriesSeen)
		dir.Close()
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			return out, readErr
		}
		for _, entry := range entries {
			entriesSeen++
			if entriesSeen > 512 {
				out.Truncated = true
				return out, ctx.Err()
			}
			name := path.Join(dirName, entry.Name())
			link, err := scopedEntryLink(entry)
			if err != nil {
				return out, err
			}
			if link {
				continue
			}
			if entry.IsDir() {
				pending = append(pending, name)
				continue
			}
			// Use the same descriptor/preimage checks as reads; special files never open blocking.
			if w.beforeSearchRead != nil {
				w.beforeSearchRead()
			}
			if e := w.check(); e != nil {
				return out, e
			}
			scope, e := w.selectFile(name)
			if e != nil {
				if err := ctx.Err(); err != nil {
					return out, err
				}
				if err := w.check(); err != nil {
					return out, err
				}
				continue
			}
			text, e := scope.Read(ctx, name)
			scope.Close()
			if e != nil {
				if err := ctx.Err(); err != nil {
					return out, err
				}
				if err := w.check(); err != nil {
					return out, err
				}
				continue
			}
			out.ScannedFiles++
			totalBytes += len(text.Text)
			if totalBytes > 8*MaxFileBytes {
				out.Truncated = true
				return out, ctx.Err()
			}
			for line, value := range strings.Split(text.Text, "\n") {
				if strings.Contains(value, query) {
					if len(value) > 512 {
						value = value[:512]
						for !utf8.ValidString(value) {
							value = value[:len(value)-1]
						}
					}
					out.Matches = append(out.Matches, SearchMatch{name, line + 1, value})
					if len(out.Matches) >= 64 {
						out.Truncated = true
						return out, ctx.Err()
					}
				}
			}
		}
	}
	return out, ctx.Err()
}

// ReadWindow is a bounded physical-line window with an explicit continuation.
// Long lines are shortened visibly; next_offset always starts a complete line.
type ReadWindow struct {
	Path       string `json:"path"`
	Content    string `json:"content"`
	Offset     int    `json:"offset"`
	TotalLines int    `json:"total_lines"`
	NextOffset int    `json:"next_offset,omitempty"`
	Truncated  bool   `json:"truncated"`
	Digest     string `json:"digest"`
}

func FormatRead(text ScopedText, offset, limit int) (ReadWindow, error) {
	if offset == 0 {
		offset = 1
	}
	if limit == 0 {
		limit = 200
	}
	if offset < 1 || limit < 1 || limit > 2000 {
		return ReadWindow{}, errors.New("offset must be positive and limit at most 2000")
	}
	lines := strings.Split(text.Text, "\n")
	// A terminal newline closes its preceding line; it does not create another.
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if offset > len(lines) && !(offset == 1 && len(lines) == 0) {
		return ReadWindow{}, fmt.Errorf("offset exceeds %d lines", len(lines))
	}
	result := ReadWindow{Path: text.Path, Offset: offset, TotalLines: len(lines), Digest: text.Digest}
	var content strings.Builder
	end := offset - 1
	for end < len(lines) && end-(offset-1) < limit {
		line := strings.TrimSuffix(lines[end], "\r")
		runes := []rune(line)
		shortened := len(runes) > 2000
		if shortened {
			line = string(runes[:2000]) + "... (line truncated to 2000 chars)"
		}
		separator := 0
		if end > offset-1 {
			separator = 1
		}
		if content.Len()+separator+len(line) > 16<<10 {
			break
		}
		if separator != 0 {
			content.WriteByte('\n')
		}
		content.WriteString(line)
		result.Truncated = result.Truncated || shortened
		end++
	}
	result.Content = content.String()
	if end < len(lines) {
		result.NextOffset = end + 1
		result.Truncated = true
	}
	return result, nil
}
