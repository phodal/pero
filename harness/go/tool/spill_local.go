package tool

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	point "github.com/phodal/pero/harness/go/runtime"
)

const DefaultProcessSpillBytes int64 = 64 * 1024 * 1024
const DefaultSpillRetention = 30 * 24 * time.Hour

type LocalSpillStoreOptions struct {
	// SessionMaxBytes bounds all retained text/process artifacts for one owner.
	// Zero selects 256 MiB; negative values are rejected at admission.
	SessionMaxBytes  int64
	Root             string
	Retention        time.Duration
	DisableCleanup   bool
	Now              func() time.Time
	Warn             func(string)
	DefaultRootsBase string
	RetrievalHint    string
}

type LocalSpillStore struct {
	options     LocalSpillStoreOptions
	once        sync.Once
	root        string
	err         error
	cleanupOnce sync.Once
	cleanupDone chan struct{}
	cleanupErr  error
}

func NewLocalSpillStore(root string) *LocalSpillStore {
	return NewLocalSpillStoreWithOptions(LocalSpillStoreOptions{Root: root})
}

func NewLocalSpillStoreWithOptions(options LocalSpillStoreOptions) *LocalSpillStore {
	if options.SessionMaxBytes == 0 {
		options.SessionMaxBytes = DefaultSessionSpillBytes
	}
	if options.Retention == 0 {
		options.Retention = DefaultSpillRetention
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.DefaultRootsBase == "" {
		options.DefaultRootsBase = os.TempDir()
	}
	return &LocalSpillStore{options: options}
}

// StartSpillLifecycle launches one best-effort startup sweep and returns a
// disposer that waits for that exact sweep to quiesce.
func (s *LocalSpillStore) StartSpillLifecycle(context.Context) (point.Dispose, error) {
	if s == nil {
		return nil, errors.New("spill-local: store is nil")
	}
	if s.options.Retention < 0 {
		return nil, errors.New("spill-local: retention must not be negative")
	}
	root, err := s.Root()
	if err != nil {
		return nil, err
	}
	s.cleanupOnce.Do(func() {
		s.cleanupDone = make(chan struct{})
		if s.options.DisableCleanup {
			close(s.cleanupDone)
			return
		}
		go func() {
			defer close(s.cleanupDone)
			cleanupManagedSpills(root, s.options.DefaultRootsBase, s.options.Now().Add(-s.options.Retention), s.options.Warn)
		}()
	})
	done := s.cleanupDone
	return point.Dispose(func(context.Context) error {
		if done != nil {
			<-done
		}
		return s.cleanupErr
	}), nil
}

func (s *LocalSpillStore) Root() (string, error) {
	if s == nil {
		return "", errors.New("spill-local: store is nil")
	}
	s.once.Do(func() {
		if s.options.SessionMaxBytes < 0 {
			s.err = errors.New("spill-local: session quota must be positive")
			return
		}
		s.root, s.err = initializeSpillRoot(s.options.Root, s.options.DefaultRootsBase)
	})
	return s.root, s.err
}

func (s *LocalSpillStore) SaveText(ctx context.Context, input SaveTextSpill) (SpillRef, error) {
	if err := validateSaveTextSpill(input); err != nil {
		return SpillRef{}, err
	}
	if ctx != nil && ctx.Err() != nil {
		return SpillRef{}, ctx.Err()
	}
	var path string
	var file *os.File
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		var directory string
		directory, err = s.sessionDirectory(input.Owner, true)
		if err == nil {
			path, file, err = openPrivateSpill(directory, input.SuggestedName)
		}
		if err == nil || !errors.Is(err, os.ErrNotExist) {
			break
		}
	}
	if err != nil {
		return SpillRef{}, err
	}
	data := []byte(input.Content)
	written, writeErr := s.writeQuota(path, file, data, false)
	if writeErr == nil && written != len(data) {
		writeErr = io.ErrShortWrite
	}
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		_ = os.Remove(path)
		return SpillRef{}, errors.Join(writeErr, closeErr)
	}
	hint := s.options.RetrievalHint
	if hint == "" {
		hint = "Retrieve this exact saved locator through a readback tool available in the current request; use bounded ranges and follow truncation markers."
	}
	return SpillRef{Locator: path, Bytes: int64(len(data)), RetrievalHint: hint}, nil
}

func (s *LocalSpillStore) LookupText(ctx context.Context, owner SpillOwner, locator string, maxBytes int) (SpillTextLookup, error) {
	return s.ReadTextPage(ctx, owner, locator, 0, maxBytes)
}

// ReadTextPage reads a byte range from an exact Session-owned saved locator.
// Callers continue at offset+len(Text), which stays on a UTF-8 boundary.
func (s *LocalSpillStore) ReadTextPage(ctx context.Context, owner SpillOwner, locator string, offset int64, maxBytes int) (SpillTextLookup, error) {
	if owner.SessionID == "" || maxBytes <= 0 || offset < 0 {
		return SpillTextLookup{}, errors.New("spill-local: lookup requires owner and positive read limit")
	}
	root, err := s.Root()
	if err != nil {
		return SpillTextLookup{}, err
	}
	candidate, err := filepath.Abs(locator)
	if err != nil {
		return SpillTextLookup{}, nil
	}
	candidate = filepath.Clean(candidate)
	if !pathWithin(root, candidate) {
		return SpillTextLookup{}, nil
	}
	directory, err := s.sessionDirectory(owner, false)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return SpillTextLookup{Recognized: true}, nil
		}
		return SpillTextLookup{}, err
	}
	if filepath.Dir(candidate) != directory {
		return SpillTextLookup{Recognized: true}, nil
	}
	info, err := os.Lstat(candidate)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return SpillTextLookup{Recognized: true}, nil
		}
		return SpillTextLookup{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || !privateMode(info, 0o600) {
		return SpillTextLookup{Recognized: true}, nil
	}
	if ctx != nil && ctx.Err() != nil {
		return SpillTextLookup{}, ctx.Err()
	}
	file, err := os.Open(candidate)
	if err != nil {
		return SpillTextLookup{}, err
	}
	defer file.Close()
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return SpillTextLookup{}, err
	}
	data, err := io.ReadAll(io.LimitReader(file, int64(maxBytes)+1))
	if err != nil {
		return SpillTextLookup{}, err
	}
	if len(data) > 0 && !utf8.RuneStart(data[0]) {
		return SpillTextLookup{}, errors.New("spill-local: offset must be a UTF-8 boundary")
	}
	truncated := len(data) > maxBytes
	if truncated {
		data = data[:maxBytes]
		for len(data) > 0 && !utf8.Valid(data) {
			data = data[:len(data)-1]
		}
	}
	if !utf8.Valid(data) {
		return SpillTextLookup{}, errors.New("spill-local: stored result is not valid UTF-8")
	}
	return SpillTextLookup{Recognized: true, Read: &SpillTextRead{Text: string(data), Truncated: truncated}}, nil
}

type ProcessSpill interface {
	io.Writer
	Close() error
	Abort() error
	Locator() string
}

type ProcessSpillStore interface {
	OpenProcessSpill(context.Context, SpillOwner, string) (ProcessSpill, error)
}

func (s *LocalSpillStore) OpenProcessSpill(ctx context.Context, owner SpillOwner, label string) (ProcessSpill, error) {
	if owner.SessionID == "" || strings.TrimSpace(label) == "" {
		return nil, errors.New("spill-local: process spill requires owner and label")
	}
	if ctx != nil && ctx.Err() != nil {
		return nil, ctx.Err()
	}
	var path string
	var file *os.File
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		var directory string
		directory, err = s.sessionDirectory(owner, true)
		if err == nil {
			path, file, err = openPrivateSpill(directory, label+".log")
		}
		if err == nil || !errors.Is(err, os.ErrNotExist) {
			break
		}
	}
	if err != nil {
		return nil, err
	}
	return &localProcessSpill{path: path, file: file, store: s}, nil
}

type localProcessSpill struct {
	store *LocalSpillStore
	path  string
	file  *os.File
	once  sync.Once
	err   error
}

func (s *localProcessSpill) Write(data []byte) (int, error) {
	return s.store.writeQuota(s.path, s.file, data, true)
}
func (s *localProcessSpill) Locator() string { return s.path }
func (s *localProcessSpill) Close() error {
	s.once.Do(func() { s.err = s.file.Close() })
	return s.err
}
func (s *localProcessSpill) Abort() error {
	closeErr := s.Close()
	return errors.Join(closeErr, os.Remove(s.path))
}

func (s *LocalSpillStore) sessionDirectory(owner SpillOwner, create bool) (string, error) {
	root, err := s.Root()
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256([]byte(owner.SessionID))
	directory := filepath.Join(root, "session-"+hex.EncodeToString(hash[:])[:12])
	if create {
		if err := os.Mkdir(directory, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
			return "", err
		}
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() || !privateMode(info, 0o700) {
		return "", errors.New("spill-local: session location is not a private directory")
	}
	canonical, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return "", err
	}
	return canonical, nil
}

func initializeSpillRoot(configured, defaultRootsBase string) (string, error) {
	var root string
	var err error
	if strings.TrimSpace(configured) == "" {
		root, err = createPrivateDefaultSpillRoot(defaultRootsBase)
	} else {
		root, err = filepath.Abs(configured)
		if err == nil {
			err = os.Mkdir(root, 0o700)
			if errors.Is(err, os.ErrExist) {
				err = nil
			}
		}
	}
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(root)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() || !privateMode(info, 0o700) {
		return "", errors.New("spill-local: root must be a private real directory")
	}
	return filepath.EvalSymlinks(root)
}

type spillSweepRoot struct {
	path  string
	prune bool
}

func createPrivateDefaultSpillRoot(base string) (string, error) {
	for attempt := 0; attempt < 100; attempt++ {
		random := make([]byte, 3)
		if _, err := rand.Read(random); err != nil {
			return "", err
		}
		path := filepath.Join(base, "dsh-spill-"+hex.EncodeToString(random))
		if err := os.Mkdir(path, 0o700); err == nil {
			return path, nil
		} else if !errors.Is(err, os.ErrExist) {
			return "", err
		}
	}
	return "", errors.New("spill-local: exhausted default-root collision retries")
}

func cleanupManagedSpills(activeRoot, defaultRootsBase string, cutoff time.Time, warn func(string)) {
	roots := make([]spillSweepRoot, 0, 8)
	if entries, err := os.ReadDir(defaultRootsBase); err == nil {
		for _, entry := range entries {
			if defaultSpillRootName(entry.Name()) {
				roots = append(roots, spillSweepRoot{path: filepath.Join(defaultRootsBase, entry.Name()), prune: true})
			}
		}
	} else {
		warnSpillCleanup(warn, fmt.Sprintf("spill-local: failed to scan default roots: %v", err))
	}
	roots = append(roots, spillSweepRoot{path: activeRoot})
	seen := make(map[string]int)
	resolved := make([]spillSweepRoot, 0, len(roots))
	for _, candidate := range roots {
		path, identity, ok := resolveTrustedSpillCleanupRoot(candidate.path, warn)
		if !ok {
			continue
		}
		if index, found := seen[identity]; found {
			resolved[index].prune = resolved[index].prune && candidate.prune
			continue
		}
		seen[identity] = len(resolved)
		resolved = append(resolved, spillSweepRoot{path: path, prune: candidate.prune})
	}
	for _, root := range resolved {
		sweepSpillRoot(root, cutoff, warn)
	}
}

func resolveTrustedSpillCleanupRoot(path string, warn func(string)) (string, string, bool) {
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			warnSpillCleanup(warn, fmt.Sprintf("spill-local: failed to inspect root %s: %v", path, err))
		}
		return "", "", false
	}
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil || !trustedSpillCleanupDirectory(canonical, info, true) {
		warnSpillCleanup(warn, fmt.Sprintf("spill-local: skipped unsafe root %s", path))
		return "", "", false
	}
	return canonical, spillCleanupIdentity(canonical, info), true
}

func sweepSpillRoot(root spillSweepRoot, cutoff time.Time, warn func(string)) {
	entries, err := os.ReadDir(root.path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			warnSpillCleanup(warn, fmt.Sprintf("spill-local: failed to read root %s: %v", root.path, err))
		}
		return
	}
	for _, entry := range entries {
		if !managedSessionName(entry.Name()) {
			continue
		}
		directory := filepath.Join(root.path, entry.Name())
		info, statErr := os.Lstat(directory)
		if statErr != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() || !trustedSpillCleanupDirectory(directory, info, false) {
			if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
				warnSpillCleanup(warn, fmt.Sprintf("spill-local: failed to inspect session directory %s: %v", directory, statErr))
			}
			continue
		}
		files, readErr := os.ReadDir(directory)
		if readErr != nil {
			warnSpillCleanup(warn, fmt.Sprintf("spill-local: failed to read %s: %v", directory, readErr))
			continue
		}
		for _, file := range files {
			path := filepath.Join(directory, file.Name())
			fileInfo, fileErr := os.Lstat(path)
			if fileErr != nil || !fileInfo.Mode().IsRegular() || !fileInfo.ModTime().Before(cutoff) {
				continue
			}
			if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				warnSpillCleanup(warn, fmt.Sprintf("spill-local: failed to delete %s: %v", path, removeErr))
			}
		}
		_ = os.Remove(directory)
	}
	if root.prune {
		_ = os.Remove(root.path)
	}
}

func managedSessionName(name string) bool {
	if len(name) != len("session-")+12 || !strings.HasPrefix(name, "session-") {
		return false
	}
	return lowerHex(name[len("session-"):])
}

func defaultSpillRootName(name string) bool {
	if strings.HasPrefix(name, "dsh-spill-") {
		return len(name) == len("dsh-spill-")+6 && asciiAlphaNumeric(name[len("dsh-spill-"):])
	}
	if !strings.HasPrefix(name, "point-spill-") || len(name) == len("point-spill-") {
		return false
	}
	for _, character := range name[len("point-spill-"):] {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func asciiAlphaNumeric(value string) bool {
	for _, character := range []byte(value) {
		if (character < '0' || character > '9') &&
			(character < 'A' || character > 'Z') &&
			(character < 'a' || character > 'z') {
			return false
		}
	}
	return value != ""
}

func warnSpillCleanup(warn func(string), message string) {
	if warn == nil {
		return
	}
	defer func() { _ = recover() }()
	warn(message)
}

func lowerHex(value string) bool {
	for _, character := range value {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return value != ""
}

func validateSaveTextSpill(input SaveTextSpill) error {
	if input.Owner.SessionID == "" || input.Source.ToolName == "" || input.Source.CallID == "" || input.Source.Label == "" || strings.TrimSpace(input.SuggestedName) == "" {
		return errors.New("spill: save request fields must not be blank")
	}
	if !utf8.ValidString(input.Content) {
		return errors.New("spill: content must be valid UTF-8")
	}
	return nil
}

func openPrivateSpill(directory, suggested string) (string, *os.File, error) {
	name := encodeSpillSegment(suggested)
	for attempt := 0; attempt < 100; attempt++ {
		random := make([]byte, 6)
		if _, err := rand.Read(random); err != nil {
			return "", nil, err
		}
		path := filepath.Join(directory, hex.EncodeToString(random)+"-"+name)
		file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			return path, file, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return "", nil, err
		}
	}
	return "", nil, errors.New("spill-local: exhausted collision retries")
}

func encodeSpillSegment(value string) string {
	if value == "" {
		return "~"
	}
	var result strings.Builder
	for _, character := range value {
		if character != '~' && character < utf8.RuneSelf && ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || strings.ContainsRune("._-", character)) {
			result.WriteRune(character)
			continue
		}
		fmt.Fprintf(&result, "~%04X", character)
	}
	encoded := result.String()
	if encoded == "." || encoded == ".." {
		encoded = strings.ReplaceAll(encoded, ".", "~002E")
	}
	return encoded
}

func pathWithin(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

func privateMode(info os.FileInfo, expected os.FileMode) bool {
	return runtime.GOOS == "windows" || info.Mode().Perm() == expected
}
