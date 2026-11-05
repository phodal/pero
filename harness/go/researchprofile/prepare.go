package researchprofile

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/phodal/pero/harness/go/fstools"
)

type Options struct{ SourceRoot, StateDirectory, Python string }

func Prepare(ctx context.Context, options Options) (Profile, error) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return Profile{}, errors.New("researchprofile: managed research source adaptation requires supported Unix shell and filesystem semantics")
	}
	if !filepath.IsAbs(options.SourceRoot) || !filepath.IsAbs(options.StateDirectory) || strings.TrimSpace(options.Python) == "" {
		return Profile{}, errors.New("researchprofile: explicit source, absolute state directory and Python interpreter are required")
	}
	root, err := filepath.EvalSymlinks(options.SourceRoot)
	if err != nil {
		return Profile{}, errors.New("researchprofile: selected source directory is unavailable")
	}
	var specification sourceSpecification
	if err := json.Unmarshal(inspectedSource, &specification); err != nil {
		return Profile{}, err
	}
	paths := make([]string, len(specification.Files))
	for i, file := range specification.Files {
		paths[i] = file.Path
	}
	selected, err := fstools.OpenScopedTextFiles(root, paths, 1<<20)
	if err != nil {
		return Profile{}, errors.New("researchprofile: inspected source resources are missing or unavailable")
	}
	defer selected.Close()
	files := make([]selectedFile, 0, len(specification.Files))
	for _, spec := range specification.Files {
		text, err := selected.Read(ctx, spec.Path)
		if err != nil {
			return Profile{}, errors.New("researchprofile: selected source resource cannot be read")
		}
		if digest(text.Text) != spec.SHA256 {
			return Profile{}, errors.New("researchprofile: selected source differs from the inspected revision")
		}
		files = append(files, selectedFile{specification: spec, text: text.Text})
	}
	python, version, err := resolvePython(ctx, options.Python)
	if err != nil {
		return Profile{}, err
	}
	prepared, provenance, key, err := assemble(specification, files, python, version)
	if err != nil {
		return Profile{}, err
	}
	directory, err := publish(ctx, options.StateDirectory, key, prepared)
	if err != nil {
		return Profile{}, err
	}
	return Profile{Directory: directory, Digest: key, Provenance: provenance}, nil
}

func resolvePython(ctx context.Context, program string) (string, string, error) {
	python, err := exec.LookPath(program)
	if err != nil {
		return "", "", errors.New("researchprofile: explicit Python interpreter is unavailable")
	}
	python, err = filepath.Abs(python)
	if err != nil {
		return "", "", err
	}
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	command := exec.CommandContext(bounded, python, "-I", "-B", "-c", `import json, yaml; print(json.dumps({"pyyaml": yaml.__version__}))`)
	command.Env = []string{}
	for _, name := range []string{"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"} {
		if value, ok := os.LookupEnv(name); ok {
			command.Env = append(command.Env, name+"="+value)
		}
	}
	command.WaitDelay = 250 * time.Millisecond
	output, err := command.Output()
	if err != nil {
		return "", "", errors.New("researchprofile: selected Python must import PyYAML in isolated mode; configure --research-python")
	}
	var result struct {
		Version string `json:"pyyaml"`
	}
	if json.Unmarshal(output, &result) != nil || result.Version == "" {
		return "", "", errors.New("researchprofile: selected Python did not report a usable PyYAML installation")
	}
	return python, result.Version, nil
}
