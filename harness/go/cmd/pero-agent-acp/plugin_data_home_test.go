package main

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	directory := os.Getenv("PERO_PLUGIN_DATA_HOME")
	owned := directory == ""
	if owned {
		var err error
		directory, err = os.MkdirTemp("", "pero-plugin-data")
		if err != nil {
			panic(err)
		}
		if err := os.Setenv("PERO_PLUGIN_DATA_HOME", directory); err != nil {
			panic(err)
		}
	}
	code := m.Run()
	if owned {
		_ = os.RemoveAll(directory)
	}
	os.Exit(code)
}
