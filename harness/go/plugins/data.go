package plugins

import (
	"errors"
	"os"
	"path/filepath"
	"unicode"
)

// PluginDataDirectory is Claude's persistent plugin data path. PERO_PLUGIN_DATA_HOME,
// when set to an absolute directory, replaces the default parent ~/.claude/plugins/data.
func PluginDataDirectory(name string) (string, error) {
	if name == "" || stringsContainsNul(name) {
		return "", errors.New("plugins: plugin data requires a plugin name")
	}
	root := os.Getenv("PERO_PLUGIN_DATA_HOME")
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return "", errors.New("plugins: home directory is required for plugin data")
		}
		root = filepath.Join(home, ".claude", "plugins", "data")
	} else if !filepath.IsAbs(root) {
		return "", errors.New("plugins: PERO_PLUGIN_DATA_HOME must be absolute")
	}
	return filepath.Join(root, pluginDataName(name)), nil
}

// EnsurePluginDataDirectory creates the data directory on first reference.
func EnsurePluginDataDirectory(name string) (string, error) {
	directory, err := PluginDataDirectory(name)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("plugins: plugin data directory is not a real directory")
	}
	return directory, nil
}

func pluginDataName(name string) string {
	var cleaned []rune
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' {
			cleaned = append(cleaned, r)
			continue
		}
		cleaned = append(cleaned, '-')
	}
	if len(cleaned) == 0 {
		return "plugin"
	}
	return string(cleaned)
}

func stringsContainsNul(value string) bool {
	for _, r := range value {
		if r == 0 {
			return true
		}
	}
	return false
}
