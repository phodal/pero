package tool

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
)

const DefaultSessionSpillBytes int64 = 256 << 20

var ErrSpillQuota = errors.New("spill-local: retained session output quota reached; existing artifacts are preserved")

// All writers for the same directory serialize the disk fold and write. Reading
// actual sizes makes a newly opened store honor retained data after restart;
// text saves and live process chunks charge the same session owner.
//
// Windows directory listings keep reporting 0 for a file that has been written
// but not closed. Admitted bytes cover that gap until the handle is closed
// under the same lock, so a second writer cannot spend the same remaining quota.
var spillDirectoryLocks sync.Map

type spillGate struct {
	mu       sync.Mutex
	admitted map[string]int64
}

func spillGateFor(directory string) *spillGate {
	entry, _ := spillDirectoryLocks.LoadOrStore(directory, &spillGate{admitted: map[string]int64{}})
	return entry.(*spillGate)
}

func (s *LocalSpillStore) writeQuota(path string, file *os.File, data []byte, partial bool) (int, error) {
	directory := filepath.Dir(path)
	gate := spillGateFor(directory)
	gate.mu.Lock()
	defer gate.mu.Unlock()
	used, err := spillUsed(directory, gate.admitted)
	if err != nil {
		return 0, err
	}
	remaining := s.options.SessionMaxBytes - used
	var written []byte
	var quota error
	if remaining < int64(len(data)) {
		if !partial || remaining <= 0 {
			return 0, ErrSpillQuota
		}
		written = data[:remaining]
		quota = ErrSpillQuota
	} else {
		written = data
	}
	n, err := file.Write(written)
	if n > 0 {
		gate.admitted[path] += int64(n)
	}
	return n, errors.Join(err, quota)
}

func spillUsed(directory string, admitted map[string]int64) (int64, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return 0, err
	}
	var used int64
	seen := map[string]struct{}{}
	for _, entry := range entries {
		info, err := entry.Info()
		if errors.Is(err, os.ErrNotExist) {
			continue // a failed save or an aborted stream released this entry
		}
		if err != nil {
			return 0, err
		}
		if !info.Mode().IsRegular() {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		size := info.Size()
		if reserved := admitted[path]; reserved > size {
			size = reserved
		}
		used += size
		seen[path] = struct{}{}
	}
	for path, reserved := range admitted {
		if filepath.Dir(path) != directory {
			continue
		}
		if _, ok := seen[path]; ok {
			continue
		}
		used += reserved
	}
	return used, nil
}

// releaseSpill closes the handle under the directory lock so the next writer
// observes the retained size, then drops the in-flight admission.
func (s *LocalSpillStore) releaseSpill(path string, file *os.File, remove bool) error {
	gate := spillGateFor(filepath.Dir(path))
	gate.mu.Lock()
	defer gate.mu.Unlock()
	delete(gate.admitted, path)
	closeErr := file.Close()
	if !remove {
		return closeErr
	}
	return errors.Join(closeErr, os.Remove(path))
}
