package plugins

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestPluginDataDirectorySanitizesTheName(t *testing.T) {
	t.Setenv("PERO_PLUGIN_DATA_HOME", t.TempDir())
	directory, err := PluginDataDirectory("Sample.Plugin/Name")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(directory) != "Sample-Plugin-Name" {
		t.Fatalf("directory=%s", directory)
	}
	created, err := EnsurePluginDataDirectory("Sample.Plugin/Name")
	if err != nil || created != directory {
		t.Fatalf("created=%s error=%v", created, err)
	}
	info, err := os.Lstat(created)
	if err != nil || !info.IsDir() {
		t.Fatalf("data directory=%v %v", info, err)
	}
	// Windows mode bits do not represent ACL privacy. Unix permissions remain strict.
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0700 {
		t.Fatalf("data directory mode=%v", info.Mode())
	}
}
