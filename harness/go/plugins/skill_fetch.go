package plugins

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// SkillFetchReceipt identifies the generated view and pinned selected source bytes.
type SkillFetchReceipt struct {
	Directory      string `json:"directory"`
	Revision       string `json:"revision"`
	SHA256         string `json:"sha256"`
	Invocation     string `json:"invocation"`
	AdapterVersion uint32 `json:"adapterVersion"`
}

// SkillHead observes an upstream default revision without acquiring or executing it.
func SkillHead(ctx context.Context, source string) (string, error) {
	if err := PublicGitHubSkillSource(source); err != nil {
		return "", err
	}
	command := exec.CommandContext(ctx, "git", "-c", "core.hooksPath=/dev/null", "-c", "credential.interactive=false", "ls-remote", "--exit-code", "--", source, "HEAD")
	command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	configureGitProcess(command)
	output, err := command.Output()
	if err != nil {
		return "", errors.New("plugins: cannot observe upstream revision; check repository access")
	}
	fields := strings.Fields(string(output))
	if len(fields) != 2 || len(fields[0]) != 40 {
		return "", errors.New("plugins: invalid upstream revision")
	}
	return fields[0], nil
}

// FetchSkill acquires one catalog selection without interpreting the repository's
// marketplace, hooks or servers. Resources retain their source-relative locations.
func FetchSkill(ctx context.Context, source, cache, commit, skillPath, namespace, expected string) (SkillFetchReceipt, error) {
	// Absolute local paths remain available to the in-process test harness.
	// Public callers, including the CLI, must use a GitHub HTTPS source.
	if err := validateSkillFetch(source, commit, skillPath, namespace, expected, true); err != nil {
		return SkillFetchReceipt{}, err
	}
	cache, err := filepath.Abs(cache)
	if err != nil {
		return SkillFetchReceipt{}, err
	}
	if err = os.MkdirAll(cache, 0700); err != nil {
		return SkillFetchReceipt{}, err
	}
	stage, err := os.MkdirTemp(cache, ".skill-")
	if err != nil {
		return SkillFetchReceipt{}, err
	}
	defer os.RemoveAll(stage)
	original := filepath.Join(stage, ".original")
	revision, err := fetchGit(ctx, source, original, "", commit, filepath.Dir(skillPath))
	if err != nil {
		return SkillFetchReceipt{}, err
	}
	reader, err := os.OpenRoot(filepath.Join(stage, ".original"))
	if err != nil {
		return SkillFetchReceipt{}, err
	}
	content, err := readConfiguration(reader, skillPath)
	reader.Close()
	if err != nil {
		return SkillFetchReceipt{}, err
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(content))
	if expected != "" && !strings.EqualFold(expected, digest) {
		return SkillFetchReceipt{}, errors.New("plugins: selected skill content differs from catalog digest")
	}
	if err = rejectDynamicSkill(string(content)); err != nil {
		return SkillFetchReceipt{}, err
	}
	if err = bundleSkillResources(ctx, original, filepath.Join(stage, "source"), revision, filepath.ToSlash(skillPath)); err != nil {
		return SkillFetchReceipt{}, err
	}
	// Only the selected source bytes and their linked resources are installed.
	// The staging repository is no longer needed, and must not accumulate per skill.
	if err = os.RemoveAll(original); err != nil {
		return SkillFetchReceipt{}, err
	}
	if err = os.Mkdir(filepath.Join(stage, ".claude-plugin"), 0700); err != nil {
		return SkillFetchReceipt{}, err
	}
	manifest, _ := json.Marshal(map[string]any{"name": namespace, "version": revision, "skills": []string{"./" + filepath.ToSlash(filepath.Join("source", filepath.Dir(skillPath)))}})
	if err = os.WriteFile(filepath.Join(stage, ".claude-plugin", "plugin.json"), manifest, 0600); err != nil {
		return SkillFetchReceipt{}, err
	}
	report, err := Inspect(ctx, stage)
	if err != nil {
		return SkillFetchReceipt{}, err
	}
	if !report.Valid() || len(report.Plugins) != 1 || len(report.Plugins[0].Components) != 1 {
		return SkillFetchReceipt{}, errors.New("plugins: selected skill is not supported; inspect source metadata and dependencies")
	}
	component := report.Plugins[0].Components[0]
	if !component.Visibility.User && !component.Visibility.Model {
		return SkillFetchReceipt{}, errors.New("plugins: selected skill has no supported invocation")
	}
	if len(component.Hooks) > 0 || component.Context != "" {
		return SkillFetchReceipt{}, errors.New("plugins: marketplace supports static skills; dynamic commands, skill hooks and fork contexts need an explicit plugin installation")
	}
	if _, err = LoadPackages(ctx, []string{stage}); err != nil {
		return SkillFetchReceipt{}, err
	}
	if err = ctx.Err(); err != nil {
		return SkillFetchReceipt{}, err
	}
	final, err := os.MkdirTemp(cache, "skill-"+revision[:12]+"-")
	if err != nil {
		return SkillFetchReceipt{}, err
	}
	view := filepath.Join(final, "view")
	if err = os.Rename(stage, view); err != nil {
		os.Remove(final)
		return SkillFetchReceipt{}, err
	}
	receipt := SkillFetchReceipt{Directory: view, Revision: revision, SHA256: digest, Invocation: component.QualifiedName, AdapterVersion: 3}
	data, _ := json.MarshalIndent(receipt, "", "  ")
	if err = os.WriteFile(filepath.Join(final, "receipt.json"), append(data, '\n'), 0600); err != nil {
		_ = os.RemoveAll(final)
		return SkillFetchReceipt{}, err
	}
	return receipt, nil
}

// ObserveSkill records the upstream HEAD revision and the exact SKILL.md digest.
// It does not publish an installed snapshot.
func ObserveSkill(ctx context.Context, source, skillPath string) (string, string, error) {
	if !supportedSkillPath(skillPath) {
		return "", "", errors.New("plugins: invalid pinned skill selection")
	}
	if !(filepath.IsAbs(source) && !strings.HasPrefix(source, "-") && !strings.ContainsAny(source, "\x00\r\n")) {
		if err := PublicGitHubSkillSource(source); err != nil {
			return "", "", err
		}
	}
	stage, err := os.MkdirTemp("", "pero-skill-observe-")
	if err != nil {
		return "", "", err
	}
	defer os.RemoveAll(stage)
	original := filepath.Join(stage, "source")
	revision, err := fetchGit(ctx, source, original, "HEAD", "", filepath.Dir(skillPath))
	if err != nil {
		return "", "", err
	}
	reader, err := os.OpenRoot(original)
	if err != nil {
		return "", "", err
	}
	content, readErr := readConfiguration(reader, skillPath)
	closeErr := reader.Close()
	if readErr != nil {
		return "", "", readErr
	}
	if closeErr != nil {
		return "", "", closeErr
	}
	if err = rejectDynamicSkill(string(content)); err != nil {
		return "", "", err
	}
	return revision, fmt.Sprintf("%x", sha256.Sum256(content)), nil
}

// PublicGitHubSkillSource is the source form Host uses for marketplace Git.
func PublicGitHubSkillSource(source string) error {
	if !strings.HasPrefix(source, "https://github.com/") || strings.ContainsAny(source, "\x00\r\n ?#@") {
		return errors.New("plugins: expected a public GitHub source")
	}
	repository := strings.TrimSuffix(strings.TrimPrefix(source, "https://github.com/"), ".git")
	parts := strings.Split(repository, "/")
	if len(parts) != 2 || strings.Contains(repository, ".git") {
		return errors.New("plugins: expected a public GitHub source")
	}
	for _, part := range parts {
		if part == "" || strings.HasPrefix(part, ".") || strings.Contains(part, "..") {
			return errors.New("plugins: expected a public GitHub source")
		}
		for _, char := range part {
			if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_' || char == '.') {
				return errors.New("plugins: expected a public GitHub source")
			}
		}
	}
	return nil
}

func validateSkillFetch(source, commit, skillPath, namespace, expected string, allowLocal bool) error {
	if !regexp.MustCompile(`^[a-fA-F0-9]{40}$`).MatchString(commit) || !supportedSkillPath(skillPath) || !regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`).MatchString(namespace) || len(namespace) > 64 {
		return errors.New("plugins: invalid pinned skill selection")
	}
	if expected != "" {
		if decoded, err := hex.DecodeString(expected); err != nil || len(decoded) != 32 {
			return errors.New("plugins: invalid skill digest")
		}
	}
	if allowLocal && filepath.IsAbs(source) && !strings.HasPrefix(source, "-") && !strings.ContainsAny(source, "\x00\r\n") {
		return nil
	}
	return PublicGitHubSkillSource(source)
}

func supportedSkillPath(path string) bool {
	return localPath(path) && filepath.Base(path) == "SKILL.md" && !strings.ContainsAny(path, "\\!\x00:")
}

func rejectDynamicSkill(content string) error {
	if strings.Contains(content, "!`") || hasDynamicFence(content) {
		return errors.New("plugins: marketplace supports static skills; dynamic commands, skill hooks and fork contexts need an explicit plugin installation")
	}
	return nil
}

func hasDynamicFence(content string) bool {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSuffix(line, "\r")
		trimmed := strings.TrimLeft(line, " ")
		if len(line)-len(trimmed) <= 3 && strings.TrimRight(trimmed, " \t") == "```!" {
			return true
		}
	}
	return false
}
