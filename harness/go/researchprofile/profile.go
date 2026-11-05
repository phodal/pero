// Package researchprofile prepares a reproducible local view of the explicitly
// selected upstream research skills. It never installs into a global skill root.
package researchprofile

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path"
	"sort"
	"strings"
)

//go:embed source.json
var inspectedSource []byte

//go:embed bridge.md
var bridge string

//go:embed validate_json.py
var validationLauncher string

const adapterVersion = 1

type sourceFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}
type sourceSpecification struct {
	Repository string       `json:"repository"`
	Revision   string       `json:"revision"`
	License    string       `json:"license"`
	Files      []sourceFile `json:"files"`
}
type selectedFile struct {
	specification sourceFile
	text          string
}
type preparedFile struct{ path, text string }
type Operation struct {
	SourcePath   string `json:"sourcePath,omitempty"`
	TargetPath   string `json:"targetPath"`
	BeforeSHA256 string `json:"beforeSHA256,omitempty"`
	AfterSHA256  string `json:"afterSHA256"`
	Action       string `json:"action"`
}
type Provenance struct {
	AdapterVersion int         `json:"adapterVersion"`
	Repository     string      `json:"repository"`
	Revision       string      `json:"revision"`
	License        string      `json:"license"`
	Python         string      `json:"python"`
	PyYAMLVersion  string      `json:"pyyamlVersion"`
	Operations     []Operation `json:"operations"`
}
type Profile struct {
	Directory  string
	Digest     string
	Provenance Provenance
}

func digest(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}
func quoteShell(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'" }

// assemble is deterministic. Upstream source stays intact in the selected
// checkout; each adapted snapshot records exact before/after hashes.
func assemble(source sourceSpecification, files []selectedFile, python, pyyaml string) ([]preparedFile, Provenance, string, error) {
	provenance := Provenance{AdapterVersion: adapterVersion, Repository: source.Repository, Revision: source.Revision, License: source.License, Python: python, PyYAMLVersion: pyyaml, Operations: []Operation{}}
	prepared := make([]preparedFile, 0, len(files)+4)
	add := func(from, target, text, action, before string) {
		prepared = append(prepared, preparedFile{target, text})
		provenance.Operations = append(provenance.Operations, Operation{SourcePath: from, TargetPath: target, BeforeSHA256: before, AfterSHA256: digest(text), Action: action})
	}
	for _, file := range files {
		if digest(file.text) != file.specification.SHA256 {
			return nil, Provenance{}, "", errors.New("researchprofile: selected source differs from the inspected revision")
		}
		target := file.specification.Path
		action := "copy-unmodified"
		text := file.text
		if strings.HasPrefix(target, "skills/research-zh/") {
			target = "skills/" + strings.TrimPrefix(target, "skills/research-zh/")
		}
		switch file.specification.Path {
		case "agents/web-search-agent.md":
			const old = "~/.claude/agents/web-search-modules/"
			if !strings.Contains(text, old) {
				return nil, Provenance{}, "", errors.New("researchprofile: inspected module path contract is missing")
			}
			text = strings.ReplaceAll(text, old, "${CLAUDE_PLUGIN_ROOT}/agents/web-search-modules/")
			action = "rebase-selected-module-path"
		case "skills/research-zh/research-deep/SKILL.md":
			const old = "python ~/.claude/skills/research/validate_json.py"
			if !strings.Contains(text, old) {
				return nil, Provenance{}, "", errors.New("researchprofile: inspected validator invocation contract is missing")
			}
			text = strings.ReplaceAll(text, old, quoteShell(python)+` -I -B "${CLAUDE_PLUGIN_ROOT}/skills/research/validate_json.py"`)
			action = "rebase-validator-and-select-python"
		case "skills/research-zh/research-report/SKILL.md":
			const old = "python {topic}/generate_report.py"
			if !strings.Contains(text, old) {
				return nil, Provenance{}, "", errors.New("researchprofile: inspected report invocation contract is missing")
			}
			text = strings.ReplaceAll(text, old, quoteShell(python)+" -I -B {topic}/generate_report.py")
			action = "select-report-python"
		case "skills/research-zh/research/validate_json.py":
			target = "skills/research/validate_json.upstream.py"
		}
		if !path.IsAbs(target) && !strings.HasPrefix(target, "../") {
			add(file.specification.Path, target, text, action, file.specification.SHA256)
		} else {
			return nil, Provenance{}, "", errors.New("researchprofile: invalid prepared resource path")
		}
	}
	add("", "skills/research/validate_json.py", validationLauncher, "guard-empty-or-missing-inputs-before-original-validator", "")
	add("", "skills/deep-research/SKILL.md", bridge, "compose-original-research-stages-on-root", "")
	manifest := `{"name":"deep-research","version":"0.1.0","description":"Selected upstream outline, parallel research and report workflow with preserved human gates","license":"MIT","agents":["./agents/web-search-agent.md"]}` + "\n"
	add("", ".claude-plugin/plugin.json", manifest, "declare-explicit-package-view", "")
	sort.Slice(provenance.Operations, func(i, j int) bool { return provenance.Operations[i].TargetPath < provenance.Operations[j].TargetPath })
	encoded, err := json.MarshalIndent(provenance, "", "  ")
	if err != nil {
		return nil, Provenance{}, "", err
	}
	prepared = append(prepared, preparedFile{"SOURCE.json", string(encoded) + "\n"})
	sort.Slice(prepared, func(i, j int) bool { return prepared[i].path < prepared[j].path })
	var key strings.Builder
	for _, file := range prepared {
		key.WriteString(file.path)
		key.WriteByte(0)
		key.WriteString(digest(file.text))
		key.WriteByte('\n')
	}
	return prepared, provenance, digest(key.String()), nil
}
