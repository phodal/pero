package fstools

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// ScopedTextFiles is a descriptor-owned set of existing text files. Opening it
// grants no authority: the host must supply an approved path manifest and its
// current policy check. It cannot create/delete caller-selected targets,
// execute commands, follow selected symlinks, or address an undeclared target.
// Replacement uses a host-generated transient sibling staging file; the
// caller's policy must permit that staging as well as the selected replacement.
type ScopedTextFiles struct {
	mu       sync.Mutex
	root     *os.Root
	rootPath string
	identity os.FileInfo
	files    map[string]scopedTextTarget
	limit    int64
	closed   bool
	readOnly bool
	// Internal fault injection for commit/readback boundary tests. Never set
	// by tool arguments or by the public host construction API.
	afterCommit func()
}

// MatchesRoot checks whether this selection is bound to an already observed
// root directory. It grants no authority and does not refresh the selection.
// Discovery owners use this to reject pathname replacement (including ABA)
// between opening their directory and selecting a manifest from that path.
func (s *ScopedTextFiles) MatchesRoot(identity os.FileInfo) bool {
	if s == nil || identity == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.closed && os.SameFile(s.identity, identity)
}

type scopedTextTarget struct {
	parent   *os.Root
	dir      string
	name     string
	identity os.FileInfo
}

type ScopedText struct {
	Path   string `json:"path"`
	Text   string `json:"text"`
	Digest string `json:"digest"`
}

// ScopedTextReceipt records observed filesystem state, not a test verdict or
// authorization. Any error after commit keeps State unknown until independent
// readback reconciles the original intent. The host owns durable journaling.
type ScopedTextReceipt struct {
	Path         string `json:"path"`
	BeforeDigest string `json:"beforeDigest"`
	AfterDigest  string `json:"afterDigest"`
	State        string `json:"state"` // not-applied | applied | unknown
}

func scopedTextDigest(data []byte) string {
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// OpenScopedTextFiles accepts canonical slash-separated relative paths, not
// globs. Directory descriptors retain the originally selected objects even if
// an untrusted pathname is replaced. Root/parent identity is rechecked before
// reads and replacement; a redirected pathname never chooses a new target.
func OpenScopedTextFiles(rootPath string, paths []string, maxBytes int64) (_ *ScopedTextFiles, err error) {
	return openScopedTextFiles(rootPath, paths, maxBytes, false)
}

// OpenReadOnlyTextFiles pins approved existing text without granting replacement.
// Selected skill definitions and resources are always read-only, on every host.
func OpenReadOnlyTextFiles(rootPath string, paths []string, maxBytes int64) (*ScopedTextFiles, error) {
	return openScopedTextFiles(rootPath, paths, maxBytes, true)
}

func openScopedTextFiles(rootPath string, paths []string, maxBytes int64, readOnly bool) (_ *ScopedTextFiles, err error) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" && !(runtime.GOOS == "windows" && readOnly) {
		return nil, errors.New("scoped text replacement requires a supported descriptor-rooted Unix host")
	}
	if !filepath.IsAbs(rootPath) || filepath.Clean(rootPath) != rootPath || len(paths) == 0 || len(paths) > 32 || maxBytes < 1 || maxBytes > 1<<20 {
		return nil, errors.New("invalid scoped text root, path count or byte limit")
	}
	canonical, err := canonicalWorkspacePath(rootPath)
	if err != nil || canonical != rootPath {
		return nil, errors.New("scoped text root must be canonical and available")
	}
	before, err := scopedPathInfo(rootPath)
	if err != nil || !before.IsDir() {
		return nil, errors.New("scoped text root is not a directory")
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return nil, err
	}
	scope := &ScopedTextFiles{root: root, rootPath: rootPath, identity: before, files: map[string]scopedTextTarget{}, limit: maxBytes, readOnly: readOnly}
	defer func() {
		if err != nil {
			_ = scope.Close()
		}
	}()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(before, opened) {
		return nil, errors.New("scoped text root changed while opening")
	}
	scope.identity = opened
	for _, relative := range paths {
		if relative == "." || relative == "" || path.Clean(relative) != relative || !filepath.IsLocal(relative) || strings.ContainsAny(relative, "\\:\x00") || !nativeRelativePath(relative) {
			return nil, fmt.Errorf("invalid scoped relative path %q", relative)
		}
		if _, duplicate := scope.files[relative]; duplicate {
			return nil, errors.New("duplicate scoped text path")
		}
		dir := path.Dir(relative)
		parts := strings.Split(relative, "/")
		for i := 1; i < len(parts); i++ {
			info, statErr := root.Lstat(strings.Join(parts[:i], "/"))
			if statErr != nil || !info.IsDir() || scopedLink(info) {
				return nil, errors.New("scoped text parent must be an existing directory, not a symlink")
			}
		}
		parent, openErr := root.OpenRoot(dir)
		if openErr != nil {
			return nil, openErr
		}
		identity, statErr := parent.Stat(".")
		if statErr != nil {
			_ = parent.Close()
			return nil, statErr
		}
		scope.files[relative] = scopedTextTarget{parent: parent, dir: dir, name: path.Base(relative), identity: identity}
		if _, _, readErr := scope.readLocked(context.Background(), relative); readErr != nil {
			return nil, readErr
		}
	}
	return scope, nil
}

func (s *ScopedTextFiles) check(target scopedTextTarget) error {
	if err := checkPrivatePath(filepath.Join(s.rootPath, target.dir, target.name)); err != nil {
		return err
	}
	if s.closed {
		return errors.New("scoped text owner is closed")
	}
	current, err := scopedPathInfo(s.rootPath)
	if err != nil || !current.IsDir() || !os.SameFile(s.identity, current) {
		return errors.New("scoped text root was replaced")
	}
	// Check each component as well as the pinned parent: an intermediate
	// symlink may not redirect even to another directory inside the root.
	if target.dir != "." {
		parts := strings.Split(target.dir, "/")
		for i := 1; i <= len(parts); i++ {
			info, statErr := s.root.Lstat(strings.Join(parts[:i], "/"))
			if statErr != nil || !info.IsDir() || scopedLink(info) {
				return errors.New("scoped text parent was redirected")
			}
		}
	}
	current, err = s.root.Lstat(target.dir)
	if err != nil || !os.SameFile(target.identity, current) {
		return errors.New("scoped text parent was replaced")
	}
	return nil
}

func (s *ScopedTextFiles) readLocked(ctx context.Context, relative string) (ScopedText, os.FileInfo, error) {
	target, allowed := s.files[relative]
	if !allowed {
		return ScopedText{}, nil, errors.New("file is outside the exact scoped manifest")
	}
	if err := ctx.Err(); err != nil {
		return ScopedText{}, nil, err
	}
	if err := s.check(target); err != nil {
		return ScopedText{}, nil, err
	}
	before, err := target.parent.Lstat(target.name)
	if err != nil || !before.Mode().IsRegular() || before.Size() > s.limit {
		return ScopedText{}, nil, errors.New("scoped text file must be an existing bounded regular file")
	}
	file, err := openScopedTextFile(target.parent, target.name)
	if err != nil {
		return ScopedText{}, nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !sameFileInfo(before, opened) {
		return ScopedText{}, nil, errors.New("scoped text file changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(file, s.limit+1))
	if err != nil || int64(len(data)) > s.limit || !validText(data) {
		return ScopedText{}, nil, errors.New("scoped text file is not bounded UTF-8 text")
	}
	current, err := target.parent.Lstat(target.name)
	if err != nil || !sameFileInfo(opened, current) {
		return ScopedText{}, nil, errors.New("scoped text file changed while reading")
	}
	if err := s.check(target); err != nil {
		return ScopedText{}, nil, err
	}
	return ScopedText{Path: relative, Text: string(data), Digest: scopedTextDigest(data)}, current, ctx.Err()
}

func (s *ScopedTextFiles) Read(ctx context.Context, relative string) (ScopedText, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, _, err := s.readLocked(ctx, relative)
	return value, err
}

// Replace conditionally replaces one declared file, then reads its actual
// bytes back. The caller MUST flush its immutable intent and approval before
// calling; authorize rechecks current policy/lease both before staging and
// immediately before commit. It must not mint or widen authority. This is not
// a transaction across files or a lock against independent external writers.
func (s *ScopedTextFiles) Replace(ctx context.Context, relative, expectedDigest string, after []byte, authorize func(context.Context) error) (receipt ScopedTextReceipt, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readOnly {
		return ScopedTextReceipt{Path: relative, State: "not-applied"}, errors.New("scoped text selection is read-only")
	}
	after = append([]byte(nil), after...)
	receipt = ScopedTextReceipt{Path: relative, BeforeDigest: expectedDigest, AfterDigest: scopedTextDigest(after), State: "not-applied"}
	if authorize == nil || int64(len(after)) > s.limit || !validText(after) {
		return receipt, errors.New("scoped replacement requires current authorization and bounded UTF-8 text")
	}
	before, info, err := s.readLocked(ctx, relative)
	if err != nil {
		return receipt, err
	}
	if before.Digest != expectedDigest || bytes.Equal([]byte(before.Text), after) {
		return receipt, errors.New("scoped replacement preimage changed or replacement is unchanged")
	}
	if err = authorize(ctx); err != nil {
		return receipt, err
	}
	target := s.files[relative]
	staging := ".pero-edit-" + rand.Text() + ".tmp"
	temp, err := target.parent.OpenFile(staging, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return receipt, err
	}
	defer func() {
		_ = temp.Close()
		if cleanupErr := target.parent.Remove(staging); cleanupErr != nil && !errors.Is(cleanupErr, os.ErrNotExist) {
			err = errors.Join(err, cleanupErr)
		}
	}()
	if _, err = temp.Write(after); err != nil {
		return receipt, err
	}
	if err = temp.Chmod(info.Mode().Perm()); err != nil {
		return receipt, err
	}
	if err = temp.Sync(); err != nil {
		return receipt, err
	}
	if err = temp.Close(); err != nil {
		return receipt, err
	}
	if err = authorize(ctx); err != nil {
		return receipt, err
	}
	current, currentInfo, err := s.readLocked(ctx, relative)
	if err != nil || current.Digest != expectedDigest || !sameFileInfo(info, currentInfo) {
		return receipt, errors.New("scoped replacement preimage changed before commit")
	}
	if err = s.check(target); err != nil {
		return receipt, err
	}
	if err = ctx.Err(); err != nil {
		return receipt, err
	}
	// A rename error is conservatively uncertain: callers must reconcile,
	// not replay under a fresh operation identity.
	receipt.State = "unknown"
	if err = target.parent.Rename(staging, target.name); err != nil {
		return receipt, err
	}
	if s.afterCommit != nil {
		s.afterCommit()
	}
	directory, err := target.parent.Open(".")
	if err != nil {
		return receipt, err
	}
	err = directory.Sync()
	closeErr := directory.Close()
	if err != nil || closeErr != nil {
		return receipt, errors.Join(err, closeErr)
	}
	readback, _, err := s.readLocked(ctx, relative)
	if err != nil || readback.Digest != receipt.AfterDigest {
		return receipt, errors.New("scoped replacement readback is uncertain")
	}
	receipt.State = "applied"
	return receipt, nil
}

func (s *ScopedTextFiles) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	var result error
	for _, target := range s.files {
		result = errors.Join(result, target.parent.Close())
	}
	return errors.Join(result, s.root.Close())
}
