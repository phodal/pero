package subagents

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
)

const agentMemoryLimit = 16 << 10

func prepareAgentMemory(parent *harness.Agent, definition AgentDefinition) (string, func(), error) {
	if definition.Memory == "" {
		return "", nil, nil
	}
	if parent == nil || parent.Session() == nil || parent.Session().WorkingDirectory() == "" {
		return "", nil, fmt.Errorf("subagents: agent %q memory requires a workspace", definition.Name)
	}
	directory, err := agentMemoryDirectory(parent.Session().WorkingDirectory(), definition)
	if err != nil {
		return "", nil, err
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", nil, err
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", nil, fmt.Errorf("subagents: agent memory directory must be a real directory")
	}
	var release func()
	if definition.Memory == "user" {
		bound, err := nativetools.BindIsolatedWorkspace(directory)
		if err != nil {
			return "", nil, err
		}
		directory = bound
		release = func() { nativetools.ReleaseIsolatedWorkspace(bound) }
	}
	body, err := readAgentMemory(filepath.Join(directory, "MEMORY.md"))
	if err != nil {
		if release != nil {
			release()
		}
		return "", nil, err
	}
	note := "Persistent memory for this agent is " + filepath.Join(directory, "MEMORY.md") + ". Read it and update it when the task changes something later sessions should remember. Keep it short."
	if body == "" {
		note += "\nCurrent memory is empty."
	} else {
		note += "\nCurrent memory:\n" + body
	}
	return note, release, nil
}

func agentMemoryDirectory(workspace string, definition AgentDefinition) (string, error) {
	name := agentMemoryName(definition.Name)
	switch definition.Memory {
	case "project":
		return filepath.Join(workspace, ".claude", "agent-memory", name), nil
	case "local":
		return filepath.Join(workspace, ".claude", "agent-memory-local", name), nil
	case "user":
		root := os.Getenv("PERO_PLUGIN_DATA_HOME")
		if root == "" {
			home, err := os.UserHomeDir()
			if err != nil || home == "" {
				return "", fmt.Errorf("subagents: user memory requires a home directory")
			}
			root = filepath.Join(home, ".claude")
		} else if !filepath.IsAbs(root) {
			return "", fmt.Errorf("subagents: PERO_PLUGIN_DATA_HOME must be absolute")
		}
		return filepath.Join(root, "agent-memory", name), nil
	default:
		return "", fmt.Errorf("subagents: agent %q memory must be user, project, or local", definition.Name)
	}
}

func agentMemoryName(name string) string {
	var cleaned []rune
	for _, r := range name {
		if r == ':' || r == '/' || r == '\\' {
			cleaned = append(cleaned, '-')
			continue
		}
		if r > 127 || !utf8.ValidRune(r) {
			cleaned = append(cleaned, '-')
			continue
		}
		cleaned = append(cleaned, r)
	}
	if len(cleaned) == 0 {
		return "agent"
	}
	return string(cleaned)
}

func readAgentMemory(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 || info.IsDir() {
		return "", fmt.Errorf("subagents: MEMORY.md must be a regular file")
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	text := string(body)
	if len(text) > agentMemoryLimit {
		text = text[:agentMemoryLimit] + "\n[memory truncated]"
	}
	return strings.TrimSpace(text), nil
}
