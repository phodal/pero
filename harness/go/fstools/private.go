package fstools

import (
	"errors"
	"path/filepath"
	"strings"
	"sync"
)

// Host-private directories are outside model file-tool authority, even when a
// workspace or an added directory contains their parent (for example /tmp).
var privateDirectories sync.Map

// ProtectDirectory reserves a fresh, canonical host-owned directory until its
// owner removes it and calls the returned release function.
func ProtectDirectory(directory string) func() {
	privateDirectories.Store(directory, true)
	return func() { privateDirectories.Delete(directory) }
}

func checkPrivatePath(name string) error {
	blocked := false
	privateDirectories.Range(func(key, _ any) bool {
		directory := key.(string)
		relative, err := filepath.Rel(directory, name)
		if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			blocked = true
			return false
		}
		return true
	})
	if blocked {
		return errors.New("host-private files are outside file-tool authority")
	}
	return nil
}
