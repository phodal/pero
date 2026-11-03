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
var spillDirectoryLocks sync.Map

func (s *LocalSpillStore) writeQuota(path string, file *os.File, data []byte, partial bool) (int, error) {
	directory := filepath.Dir(path)
	entry, _ := spillDirectoryLocks.LoadOrStore(directory, &sync.Mutex{})
	lock := entry.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()
	entries, err := os.ReadDir(directory)
	if err != nil {
		return 0, err
	}
	var used int64
	for _, entry := range entries {
		info, err := entry.Info()
		if errors.Is(err, os.ErrNotExist) {
			continue // a failed save or an aborted stream released this entry
		}
		if err != nil {
			return 0, err
		}
		if info.Mode().IsRegular() {
			used += info.Size()
		}
	}
	remaining := s.options.SessionMaxBytes - used
	if remaining < int64(len(data)) {
		if !partial || remaining <= 0 {
			return 0, ErrSpillQuota
		}
		n, err := file.Write(data[:remaining])
		return n, errors.Join(err, ErrSpillQuota)
	}
	return file.Write(data)
}
