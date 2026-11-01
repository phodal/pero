package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/shell"
)

// CloneRequest is a reviewed source selection, not authority or a caller-written receipt.
// Source IDs only link the user's Paper reference; they do not certify its semantics.
type CloneRequest struct {
	URL         string `json:"url"`
	Revision    string `json:"revision"`
	Destination string `json:"destination"`
	License     string `json:"license"`
	SizeBytes   *int64 `json:"sizeBytes"`
	BundleID    string `json:"bundleId"`
	ResourceID  string `json:"resourceId"`
}

type CloneReceipt struct {
	State          string          `json:"state"`
	Source         CloneRequest    `json:"source"`
	ResolvedCommit string          `json:"resolvedCommit,omitempty"`
	Origin         string          `json:"origin,omitempty"`
	Checkout       bool            `json:"checkout"`
	Execution      shell.RunResult `json:"execution"`
}

var githubCloneURL = regexp.MustCompile(`^https://github\.com/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$`)
var cloneCommit = regexp.MustCompile(`^[a-f0-9]{40}$`)
var cloneIdentity = regexp.MustCompile(`^[a-f0-9]{64}$`)
var cloneDirectory = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

func (r CloneRequest) validate() error {
	if !githubCloneURL.MatchString(r.URL) || strings.HasSuffix(r.URL, ".git") {
		return errors.New("clone requires a canonical public github.com HTTPS repository URL")
	}
	if !cloneCommit.MatchString(r.Revision) {
		return errors.New("clone requires the exact 40-character commit observed in source metadata")
	}
	if !cloneDirectory.MatchString(r.Destination) {
		return errors.New("choose a new single directory name inside the configured workspace")
	}
	if !cloneIdentity.MatchString(r.BundleID) || !cloneIdentity.MatchString(r.ResourceID) {
		return errors.New("saved Paper bundle and resource IDs are required")
	}
	if strings.TrimSpace(r.License) == "" || len(r.License) > 256 || strings.ContainsAny(r.License, "\r\n\x00") || (r.SizeBytes != nil && *r.SizeBytes < 0) {
		return errors.New("review license and size; use unknown and null when unavailable")
	}
	return nil
}

// The command is assembled only from validated values and quoted arguments.
// Empty config/template and no checkout prevent hooks, helpers, filters, submodules
// and LFS from executing. This is bounded Git acquisition, not an OS network sandbox.
func cloneCommand(r CloneRequest, transport string) string {
	q := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'" }
	protocol := "https"
	if transport != r.URL {
		protocol = "file"
	} // private fixture seam, never tool input
	git := "git -c protocol.allow=never -c protocol." + protocol + ".allow=always -c http.followRedirects=false -c credential.helper= -c core.hooksPath=/dev/null -c init.templateDir= -c submodule.recurse=false -c filter.lfs.required=false"
	d := q(r.Destination)
	return "export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_LFS_SKIP_SMUDGE=1; " +
		"ulimit -f 131072 && mkdir -- " + d + " && " + git + " init --quiet --template= -- " + d + " && " +
		git + " -C " + d + " config remote.origin.url " + q(r.URL) + " && " +
		git + " -C " + d + " fetch --quiet --no-tags --no-recurse-submodules --depth=1 -- " + q(transport) + " " + q(r.Revision) + " && " +
		git + " -C " + d + " update-ref HEAD FETCH_HEAD && " +
		git + " -C " + d + " rev-parse --verify HEAD && " + git + " -C " + d + " config --get remote.origin.url"
}

func executeClone(ctx context.Context, executor shell.Executor, workspace string, request CloneRequest, transport string) (CloneReceipt, error) {
	receipt := CloneReceipt{State: "not_started", Source: request}
	if err := request.validate(); err != nil {
		return receipt, err
	}
	if _, err := os.Lstat(filepath.Join(workspace, request.Destination)); !os.IsNotExist(err) {
		return receipt, errors.New("clone destination already exists or cannot be inspected; reconcile it before retrying")
	}
	spec, err := executor.Resolve(shell.ExecRequest{Command: cloneCommand(request, transport), Workdir: workspace, Timeout: 120 * time.Second, StdoutMaxBytes: 4096})
	if err != nil {
		return receipt, err
	}
	receipt.State = "incomplete"
	result, err := executor.Run(ctx, spec)
	if len(result.Stdout.Text) > 2048 {
		result.Stdout.Text = boundedTail(result.Stdout.Text, 2048)
		result.Stdout.Truncated = true
	}
	if len(result.Stderr.Text) > 2048 {
		result.Stderr.Text = boundedTail(result.Stderr.Text, 2048)
		result.Stderr.Truncated = true
	}
	receipt.Execution = result
	if err != nil {
		return receipt, err
	}
	if result.ExitCode == nil || *result.ExitCode != 0 || result.Aborted || result.TimedOut || result.CleanupUncertain {
		return receipt, errors.New("clone did not complete; inspect the destination and actual execution result before retrying")
	}
	lines := strings.Split(strings.TrimSpace(result.Stdout.Text), "\n")
	if len(lines) != 2 || lines[0] != request.Revision || lines[1] != request.URL || result.Stdout.Truncated {
		return receipt, errors.New("Git did not confirm the exact selected commit and origin")
	}
	receipt.State = "completed"
	receipt.ResolvedCommit, receipt.Origin = lines[0], lines[1]
	return receipt, nil
}

func mountResearchClone(ctx context.Context, h *harness.Harness, workspace string, executor shell.Executor) error {
	if runtime.GOOS == "windows" {
		return errors.New("controlled research clone currently requires the Unix executor")
	}
	schema := json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"url":{"type":"string"},"revision":{"type":"string","pattern":"^[a-f0-9]{40}$"},"destination":{"type":"string"},"license":{"type":"string"},"sizeBytes":{"type":["integer","null"]},"bundleId":{"type":"string"},"resourceId":{"type":"string"}},"required":["url","revision","destination","license","sizeBytes","bundleId","resourceId"]}`)
	_, err := h.RegisterTool(ctx, "native/clone_repository", harness.Tool{Schema: harness.ToolSchema{Name: "clone_repository", Description: "Acquire a selected public GitHub repository at its metadata-observed exact commit into a NEW workspace directory, without checkout, hooks, submodules, LFS or code execution. First review source, commit, destination, license and size (unknown stays explicit). Always requires Host approval. Returns actual Git observation and execution status, not model-declared success. 120-second execution and 128 MiB per-file limit; not an aggregate disk/network sandbox. Existing directories are never retried or overwritten.", InputSchema: schema}, RequiresApproval: true, AlwaysAskApproval: true, ExecutionMode: harness.ExecutionSerial, Timeout: 125 * time.Second, ExecuteRequest: func(c context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
		if request.Agent == nil {
			return harness.ToolResult{}, errors.New("clone requires an agent session")
		}
		if request.Agent.Session().WorkingDirectory() != workspace {
			return harness.ToolResult{}, errors.New("clone session workspace does not match configured authority")
		}
		var input CloneRequest
		if e := json.Unmarshal(request.Arguments, &input); e != nil {
			return harness.ToolResult{}, e
		}
		receipt, e := executeClone(c, executor, workspace, input, input.URL)
		if e != nil {
			e = fmt.Errorf("repository acquisition: %w", e)
		}
		return renderResult(receipt, e)
	}})
	return err
}
