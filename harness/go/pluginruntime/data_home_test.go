package pluginruntime

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	directory, err := os.MkdirTemp("", "pero-plugin-data")
	if err != nil {
		panic(err)
	}
	if err := os.Setenv("PERO_PLUGIN_DATA_HOME", directory); err != nil {
		panic(err)
	}
	code := m.Run()
	_ = os.RemoveAll(directory)
	os.Exit(code)
}
