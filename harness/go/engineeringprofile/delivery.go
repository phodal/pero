package engineeringprofile

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"reflect"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
)

// DeliverySpec contains only host-bound public acceptance requirements.
// It never infers a specification from model output or executes hidden tests.
type DeliverySpec struct {
	Artifacts      []ArtifactSpec `json:"artifacts,omitempty"`
	FileSet        *FileSetSpec   `json:"fileSet,omitempty"`
	NoGitConflicts bool           `json:"noGitConflicts,omitempty"`
}
type ArtifactSpec struct {
	Path      string `json:"path"`
	NonEmpty  bool   `json:"nonEmpty,omitempty"`
	Runes     *int   `json:"runes,omitempty"`
	TrimSpace bool   `json:"trimSpace,omitempty"`
}
type FileSetSpec struct {
	Directory string   `json:"directory"`
	Files     []string `json:"files"`
}
type DeliveryAssessment struct {
	Requirement string      `json:"requirement"`
	Status      CheckStatus `json:"status"`
	Reason      string      `json:"reason,omitempty"`
}

func (d *DeliverySpec) validate() error {
	if d == nil {
		return nil
	}
	if len(d.Artifacts) > 32 {
		return errors.New("engineeringprofile: at most 32 delivery artifacts")
	}
	seen := make(map[string]bool)
	for _, artifact := range d.Artifacts {
		if !fs.ValidPath(artifact.Path) || artifact.Path == "." || strings.Contains(artifact.Path, "\\") || len(artifact.Path) > 1024 || seen[artifact.Path] || artifact.Runes != nil && (*artifact.Runes < 0 || *artifact.Runes > fstools.MaxFileBytes) {
			return errors.New("engineeringprofile: invalid or duplicate delivery artifact")
		}
		seen[artifact.Path] = true
	}
	if d.FileSet != nil {
		if !fs.ValidPath(d.FileSet.Directory) || strings.Contains(d.FileSet.Directory, "\\") || len(d.FileSet.Files) > 256 {
			return errors.New("engineeringprofile: invalid delivery file-set directory or size")
		}
		seen = make(map[string]bool)
		for _, name := range d.FileSet.Files {
			if !fs.ValidPath(name) || name == "." || strings.Contains(name, "\\") || seen[name] {
				return errors.New("engineeringprofile: invalid or duplicate delivery file-set member")
			}
			seen[name] = true
		}
	}
	return nil
}

func evaluateDelivery(ctx context.Context, cwd string, d *DeliverySpec) []DeliveryAssessment {
	if d == nil {
		return nil
	}
	var results []DeliveryAssessment
	workspace, openErr := fstools.OpenWorkspace(cwd)
	if openErr == nil {
		defer workspace.Close()
	}
	for _, artifact := range d.Artifacts {
		row := DeliveryAssessment{Requirement: "artifact:" + artifact.Path, Status: Unverified, Reason: "artifact could not be read"}
		if openErr == nil {
			content, err := workspace.Read(ctx, artifact.Path)
			if err == nil {
				text := content.Text
				if artifact.TrimSpace {
					text = strings.TrimSpace(text)
				}
				row.Status, row.Reason = Passed, ""
				if artifact.NonEmpty && text == "" || artifact.Runes != nil && utf8.RuneCountInString(text) != *artifact.Runes {
					row.Status, row.Reason = Failed, "artifact does not match its explicit content length requirement"
				}
			}
		}
		results = append(results, row)
	}
	if d.FileSet != nil {
		row := DeliveryAssessment{Requirement: "file-set:" + d.FileSet.Directory, Status: Unverified, Reason: "file set could not be inspected"}
		root, err := os.OpenRoot(cwd)
		if err == nil {
			var actual []string
			visited := 0
			err = fs.WalkDir(root.FS(), d.FileSet.Directory, func(name string, entry fs.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if err := ctx.Err(); err != nil {
					return err
				}
				visited++
				if visited > 1024 {
					return errors.New("delivery file set exceeds traversal limit")
				}
				if entry.Type()&os.ModeSymlink != 0 {
					return errors.New("delivery file set contains a symlink")
				}
				if !entry.IsDir() {
					if len(actual) >= 256 {
						return errors.New("delivery file set exceeds inspection limit")
					}
					if d.FileSet.Directory != "." {
						name = strings.TrimPrefix(name, d.FileSet.Directory+"/")
					}
					actual = append(actual, name)
				}
				return nil
			})
			_ = root.Close()
			if err == nil {
				expected := append([]string{}, d.FileSet.Files...)
				sort.Strings(expected)
				sort.Strings(actual)
				row.Status, row.Reason = Passed, ""
				if len(actual) != len(expected) || len(actual) > 0 && !reflect.DeepEqual(actual, expected) {
					row.Status, row.Reason = Failed, "file set differs from the explicit required list"
				}
			}
		}
		results = append(results, row)
	}
	if d.NoGitConflicts {
		row := DeliveryAssessment{Requirement: "git-conflicts", Status: Unverified, Reason: "Git index could not be inspected"}
		deadline, cancel := context.WithTimeout(ctx, 3*time.Second)
		command := exec.CommandContext(deadline, "git", "-C", cwd, "-c", "core.fsmonitor=false", "ls-files", "--unmerged", "-z")
		command.Env = []string{"PATH=/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}
		output, err := command.StdoutPipe()
		if err == nil {
			err = command.Start()
		}
		if err == nil {
			data, readErr := io.ReadAll(io.LimitReader(output, 65537))
			if len(data) > 65536 {
				_ = command.Process.Kill()
			}
			waitErr := command.Wait()
			if readErr == nil && len(data) <= 65536 && waitErr == nil {
				row.Status, row.Reason = Passed, ""
				if len(data) != 0 {
					row.Status, row.Reason = Failed, "Git index contains unresolved merge entries"
				}
			}
		}
		cancel()
		results = append(results, row)
	}
	return results
}

// With no machine contract, feedback requests one public-requirement review.
// It never upgrades the agent's claims into acceptance evidence.
func (a *App) reviewUnboundDelivery(input harness.TurnStoppingInput) error {
	events := input.Agent.Session().Events()
	usedTools := false
	for _, event := range events {
		if event.Type == "turn/start" {
			usedTools = false
		}
		if event.Type == "tool/call" {
			usedTools = true
		}
		if event.Type == "engineering/delivery-review" {
			var row struct {
				Turn int `json:"turn"`
			}
			if json.Unmarshal(event.Data, &row) == nil && row.Turn == input.Turn {
				return nil
			}
		}
	}
	if !usedTools {
		return nil
	}
	if _, err := input.Agent.Session().Append("engineering/delivery-review", struct {
		Turn int `json:"turn"`
	}{input.Turn}); err != nil {
		return err
	}
	return input.Agent.Inject(contextMessage("engineering/delivery-review", "Before finishing, review the user's public requirements against the actual deliverables: exact output paths and file set, requested format or length, unresolved Git conflicts, and observed verification results. Check server availability across the required lifecycle if the task delivers a service. Preserve the original specification when writing self-tests. Correct any concrete gap; if already satisfied, finish with the evidence. No machine acceptance contract is bound to this review."))
}
