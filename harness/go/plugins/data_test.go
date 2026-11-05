package plugins

import (
	"os"
	"path/filepath"
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
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		t.Fatalf("data directory=%v %v", info, err)
	}
}
