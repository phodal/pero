package scienceenv

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	"gopkg.in/yaml.v3"
)

const maxSkillBytes = 256 << 10

var skillNamePattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
var versionIDPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

type skillSummary struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type artifactRecord struct {
	VersionID string `json:"version_id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
}

func (e *Env) registerSkillTools(ctx context.Context, h *harness.Harness) error {
	_, err := h.RegisterTool(ctx, "science/skill", harness.Tool{
		Schema: harness.ToolSchema{
			Name:        "skill",
			Description: "Load one science skill from the configured read-only root. Returns its instructions and, when kernel.py is present, defines that file's functions in this session's python kernel. The sidecar may contain only functions, imports, and constants. Requires approval.",
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"skill":{"type":"string","minLength":1,"maxLength":64}},"required":["skill"]}`),
		},
		RequiresApproval: true,
		ExecutionMode:    harness.ExecutionSerial,
		ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			return e.loadSkill(ctx, request)
		},
	})
	if err != nil {
		return err
	}
	_, err = h.RegisterTool(ctx, "science/search-skills", harness.Tool{
		Schema: harness.ToolSchema{
			Name:        "search_skills",
			Description: "List science skills and connected MCP servers whose names match prefix. mcp- also matches mcp_ server names. This does not load a skill.",
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"prefix":{"type":"string","maxLength":64}}}`),
		},
		ExecutionMode: harness.ExecutionSerial,
		ExecuteRequest: func(_ context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			return e.searchSkills(request)
		},
	})
	if err != nil {
		return err
	}
	_, err = h.RegisterTool(ctx, "science/save-artifacts", harness.Tool{
		Schema: harness.ToolSchema{
			Name:        "save_artifacts",
			Description: "Copy workspace files into immutable artifact versions and return each version_id. Later edits to the original path do not change the saved copy. host.artifact_path(version_id) returns that copy. Requires approval.",
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"paths":{"type":"array","minItems":1,"maxItems":16,"items":{"type":"string","minLength":1,"maxLength":512}}},"required":["paths"]}`),
		},
		RequiresApproval: true,
		ExecutionMode:    harness.ExecutionSerial,
		ExecuteRequest: func(_ context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			return e.saveArtifacts(request)
		},
	})
	return err
}

func (e *Env) loadSkill(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
	session, err := e.session(request)
	if err != nil {
		return cellError(err.Error()), nil
	}
	if e.skillRoot == "" {
		return cellError("science skill root is not configured"), nil
	}
	var args struct {
		Skill string `json:"skill"`
	}
	if json.Unmarshal(request.Arguments, &args) != nil || !skillNamePattern.MatchString(args.Skill) {
		return cellError("science skill name is invalid"), nil
	}
	instructions, kernelSource, err := readSkill(e.skillRoot, args.Skill)
	if err != nil {
		return cellError(err.Error()), nil
	}
	if kernelSource != "" {
		kernel, err := e.kernel(session, Python)
		if err != nil {
			return cellError(err.Error()), nil
		}
		out, err := kernel.Load(ctx, kernelSource, e.host(session, Python, request.Agent))
		if err != nil {
			return cellError(err.Error()), nil
		}
		if out.Error != "" {
			return cellError(out.Error), nil
		}
	}
	return cellValue(Output{Stdout: instructions}), nil
}

func (e *Env) searchSkills(request harness.ToolRequest) (harness.ToolResult, error) {
	if _, err := e.session(request); err != nil {
		return cellError(err.Error()), nil
	}
	var args struct {
		Prefix string `json:"prefix"`
	}
	if len(request.Arguments) > 0 && json.Unmarshal(request.Arguments, &args) != nil {
		return cellError("search_skills arguments are invalid"), nil
	}
	var listed []skillSummary
	if e.skillRoot != "" {
		found, err := listSkills(e.skillRoot)
		if err != nil {
			return cellError(err.Error()), nil
		}
		listed = append(listed, found...)
	}
	for _, name := range e.mcpNames {
		listed = append(listed, skillSummary{Name: name, Description: "connected MCP server"})
	}
	matched := make([]skillSummary, 0, len(listed))
	for _, item := range listed {
		if skillPrefixMatches(item.Name, args.Prefix) {
			matched = append(matched, item)
		}
	}
	raw, err := json.Marshal(matched)
	if err != nil {
		return cellError(err.Error()), nil
	}
	return harness.ToolResult{Value: raw, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}}, nil
}

func skillPrefixMatches(name, prefix string) bool {
	if prefix == "" {
		return true
	}
	if strings.HasPrefix(name, prefix) {
		return true
	}
	if prefix == "mcp-" && strings.HasPrefix(name, "mcp_") {
		return true
	}
	return false
}

func (e *Env) saveArtifacts(request harness.ToolRequest) (harness.ToolResult, error) {
	session, err := e.session(request)
	if err != nil {
		return cellError(err.Error()), nil
	}
	var args struct {
		Paths []string `json:"paths"`
	}
	if json.Unmarshal(request.Arguments, &args) != nil || len(args.Paths) == 0 || len(args.Paths) > 16 {
		return cellError("save_artifacts requires 1 to 16 workspace paths"), nil
	}
	saved := make([]artifactRecord, 0, len(args.Paths))
	for _, rel := range args.Paths {
		record, err := e.copyArtifact(session, rel)
		if err != nil {
			return cellError(err.Error()), nil
		}
		saved = append(saved, record)
	}
	raw, err := json.Marshal(saved)
	if err != nil {
		return cellError(err.Error()), nil
	}
	return harness.ToolResult{Value: raw, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}}, nil
}

func (e *Env) copyArtifact(session, rel string) (artifactRecord, error) {
	source, err := workspaceFile(e.workspace, rel)
	if err != nil {
		return artifactRecord{}, err
	}
	body, err := os.ReadFile(source)
	if err != nil {
		return artifactRecord{}, err
	}
	if len(body) > 8<<20 {
		return artifactRecord{}, errors.New("artifact exceeds 8 MiB")
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return artifactRecord{}, err
	}
	id := hex.EncodeToString(nonce[:])
	name := filepath.Base(source)
	dir := filepath.Join(e.workspace, ".pero-science", "artifacts", id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return artifactRecord{}, err
	}
	destination := filepath.Join(dir, name)
	if err := os.WriteFile(destination, body, 0o600); err != nil {
		return artifactRecord{}, err
	}
	record := artifactRecord{VersionID: id, Name: name, Path: destination}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.artifacts == nil {
		e.artifacts = map[string]map[string]artifactRecord{}
	}
	if e.artifacts[session] == nil {
		e.artifacts[session] = map[string]artifactRecord{}
	}
	e.artifacts[session][id] = record
	return record, nil
}

func (e *Env) artifactPath(session, versionID string) (string, error) {
	if !versionIDPattern.MatchString(versionID) {
		return "", errors.New("unknown artifact version")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	record, ok := e.artifacts[session][versionID]
	if !ok {
		return "", errors.New("unknown artifact version")
	}
	return record.Path, nil
}

func workspaceFile(root, rel string) (string, error) {
	if filepath.IsAbs(rel) || strings.Contains(rel, "\x00") {
		return "", errors.New("artifact path must stay inside the workspace")
	}
	cleaned := filepath.Clean(rel)
	if cleaned == "." || strings.HasPrefix(cleaned, "..") {
		return "", errors.New("artifact path must stay inside the workspace")
	}
	absolute := filepath.Join(root, cleaned)
	relative, err := filepath.Rel(root, absolute)
	if err != nil || strings.HasPrefix(relative, "..") {
		return "", errors.New("artifact path must stay inside the workspace")
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", errors.New("artifact path must be a regular file")
	}
	return absolute, nil
}

func (e *Env) session(request harness.ToolRequest) (string, error) {
	if request.Agent == nil || request.Agent.Session() == nil {
		return "", errors.New("science kernel requires an agent session")
	}
	if !sameDir(request.Agent.Session().WorkingDirectory(), e.workspace) {
		return "", fmt.Errorf("science kernel is bound to %s", e.workspace)
	}
	return string(request.Agent.ID()), nil
}

func (e *Env) host(session string, language Language, agent *harness.Agent) Host {
	host := Host{
		Email: func() (string, error) { return e.email, nil },
		ArtifactPath: func(versionID string) (string, error) {
			return e.artifactPath(session, versionID)
		},
	}
	if language == Repl && e.mcp != nil {
		host.MCP = func(ctx context.Context, call MCPCall) (json.RawMessage, error) {
			return e.mcp(ctx, agent, call)
		}
	}
	return host
}

func readSkill(root, name string) (string, string, error) {
	instructions, err := readSkillFile(root, name, "SKILL.md")
	if err != nil {
		return "", "", err
	}
	front, body, err := splitFrontmatter(string(instructions))
	if err != nil {
		return "", "", err
	}
	if front.Name != name {
		return "", "", fmt.Errorf("science skill %s frontmatter name must match its directory", name)
	}
	kernel, err := readSkillFile(root, name, "kernel.py")
	if errors.Is(err, os.ErrNotExist) {
		kernel = nil
		err = nil
	}
	if err != nil {
		return "", "", err
	}
	text := strings.TrimSpace(body)
	if text == "" {
		text = strings.TrimSpace(front.Description)
	}
	return text, string(kernel), nil
}

func listSkills(root string) ([]skillSummary, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	var listed []skillSummary
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !skillNamePattern.MatchString(entry.Name()) {
			continue
		}
		instructions, _, err := readSkill(root, entry.Name())
		if err != nil {
			return nil, err
		}
		front, _, err := splitFrontmatterFile(root, entry.Name())
		if err != nil {
			return nil, err
		}
		description := strings.TrimSpace(front.Description)
		if description == "" {
			description = firstLine(instructions)
		}
		listed = append(listed, skillSummary{Name: entry.Name(), Description: description})
	}
	return listed, nil
}

func splitFrontmatterFile(root, name string) (skillFront, string, error) {
	body, err := readSkillFile(root, name, "SKILL.md")
	if err != nil {
		return skillFront{}, "", err
	}
	return splitFrontmatter(string(body))
}

type skillFront struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

func splitFrontmatter(text string) (skillFront, string, error) {
	trimmed := strings.TrimPrefix(text, "\uFEFF")
	if !strings.HasPrefix(trimmed, "---\n") && !strings.HasPrefix(trimmed, "---\r\n") {
		return skillFront{}, trimmed, errors.New("science skill is missing frontmatter")
	}
	rest := strings.TrimPrefix(strings.TrimPrefix(trimmed, "---\r\n"), "---\n")
	front, body, ok := strings.Cut(rest, "\n---")
	if !ok {
		return skillFront{}, "", errors.New("science skill frontmatter is not closed")
	}
	var parsed skillFront
	if err := yaml.Unmarshal([]byte(front), &parsed); err != nil {
		return skillFront{}, "", err
	}
	body = strings.TrimPrefix(body, "\r")
	body = strings.TrimPrefix(body, "\n")
	return parsed, body, nil
}

func readSkillFile(root, name, file string) ([]byte, error) {
	directory, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer directory.Close()
	relative := name + "/" + file
	info, err := directory.Lstat(relative)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, errors.New("science skill file must be a regular file")
	}
	if info.Size() > maxSkillBytes {
		return nil, errors.New("science skill file exceeds 256 KiB")
	}
	opened, err := directory.Open(relative)
	if err != nil {
		return nil, err
	}
	defer opened.Close()
	body, err := io.ReadAll(io.LimitReader(opened, maxSkillBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxSkillBytes {
		return nil, errors.New("science skill file exceeds 256 KiB")
	}
	return body, nil
}

func firstLine(text string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(text), "\n")
	if len(line) > 240 {
		return line[:240]
	}
	return line
}
