//go:build linux || darwin

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func pluginShellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

// This owns a real ACP process; the only fake is its loopback model provider.
type pluginWireProcess struct {
	t           *testing.T
	command     *exec.Cmd
	input       io.WriteCloser
	scanner     *bufio.Scanner
	diagnostics bytes.Buffer
	sequence    int
	approvals   int
	sessionID   string
	waited      bool
}

func startPluginWireProcess(t *testing.T, ctx context.Context, base string, arguments []string) *pluginWireProcess {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(arguments)
	p := &pluginWireProcess{t: t, command: exec.CommandContext(ctx, executable, "-test.run=^TestWebCLIProcess$")}
	p.command.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + base, "TMPDIR=" + base, "LANG=C.UTF-8", "PERO_WEB_TEST_CHILD=1", "PERO_WEB_TEST_ARGS=" + string(encoded), "PERO_WORKTREE_KEY=loopback-only"}
	p.input, err = p.command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := p.command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	p.command.Stderr = &p.diagnostics
	p.scanner = bufio.NewScanner(output)
	p.scanner.Buffer(make([]byte, 4096), 4<<20)
	if err := p.command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = p.input.Close()
		if !p.waited {
			_ = p.command.Process.Kill()
			_ = p.command.Wait()
		}
	})
	return p
}

func (p *pluginWireProcess) rpc(method string, params any) map[string]any {
	p.t.Helper()
	p.sequence++
	encoder := json.NewEncoder(p.input)
	if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": p.sequence, "method": method, "params": params}); err != nil {
		p.t.Fatal(err)
	}
	for p.scanner.Scan() {
		var reply map[string]any
		if err := json.Unmarshal(p.scanner.Bytes(), &reply); err != nil {
			p.t.Fatal(err)
		}
		if reply["method"] == "session/request_permission" {
			p.approvals++
			if reply["params"].(map[string]any)["sessionId"] != p.sessionID {
				p.t.Error("worktree approval lost its controlling ACP session")
			}
			if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": reply["id"], "result": map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": "allow-once"}}}); err != nil {
				p.t.Fatal(err)
			}
		}
		if reply["id"] == float64(p.sequence) {
			if reply["error"] != nil {
				p.t.Fatalf("%s: %v", method, reply["error"])
			}
			return reply["result"].(map[string]any)
		}
	}
	p.t.Fatalf("%s EOF: %v", method, p.scanner.Err())
	return nil
}

func shellStdout(t *testing.T, receipt string) string {
	t.Helper()
	var result struct {
		ExitCode *int                  `json:"exitCode"`
		Stdout   struct{ Text string } `json:"stdout"`
	}
	if err := json.Unmarshal([]byte(receipt), &result); err != nil || result.ExitCode == nil || *result.ExitCode != 0 {
		t.Errorf("real worktree command failed: %s", receipt)
	}
	return result.Stdout.Text
}

func TestCoderCLIMultiRepositoryWorktreeOptIn(t *testing.T) {
	source := os.Getenv("PERO_CODER_SOURCE")
	if source == "" {
		t.Skip("PERO_CODER_SOURCE selects the inspected original coder package")
	}
	source, err := filepath.Abs(source)
	if err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(source, "scripts", "multi-repo-worktree.mjs")
	if _, err := os.Stat(script); err != nil {
		t.Fatal(err)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	node, _ = filepath.Abs(node)
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	workspace, sessions := filepath.Join(base, "outer workspace"), filepath.Join(base, "sessions")
	for _, directory := range []string{workspace, sessions} {
		if err := os.Mkdir(directory, 0700); err != nil {
			t.Fatal(err)
		}
	}
	var repositories []string
	for _, name := range []string{"repo-a", "repo-b"} {
		repo := filepath.Join(workspace, name)
		if err := os.Mkdir(repo, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(repo, "seed.txt"), []byte("original "+name), 0600); err != nil {
			t.Fatal(err)
		}
		for _, args := range [][]string{{"init", "-b", "main"}, {"config", "user.name", "Fixture"}, {"config", "user.email", "fixture@example.invalid"}, {"add", "."}, {"commit", "-m", "fixture baseline"}} {
			command := exec.Command("git", append([]string{"-C", repo}, args...)...)
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("Git fixture: %v %s", err, output)
			}
		}
		repositories = append(repositories, repo)
	}
	var worktrees []string
	var parentCalls, childCalls atomic.Int32
	commandPrefix := pluginShellQuote(node) + " " + pluginShellQuote(script)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request pluginExecutionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		_, receipt := request.text()
		if request.Model == "fixture-analysis" {
			switch stage := childCalls.Add(1); stage {
			case 1:
				executionTool(w, "Read", map[string]string{"file_path": filepath.Join(worktrees[0], "seed.txt")}, stage)
				return
			case 2, 3:
				if stage == 2 && !strings.Contains(receipt, "original repo-a") {
					t.Error("child could not read the actual registered worktree")
				}
				executionTool(w, "Write", map[string]string{"file_path": filepath.Join(worktrees[stage-2], "feature.txt"), "content": "child wrote once"}, stage)
				return
			case 4:
				if !strings.Contains(receipt, "applied") {
					t.Error("child worktree write was not applied")
				}
			default:
				t.Errorf("unexpected child request %d", stage)
			}
		} else {
			switch stage := parentCalls.Add(1); stage {
			case 1:
				command := commandPrefix + " --create cli-worktree --repos " + pluginShellQuote(strings.Join(repositories, ",")) + " --workspace " + pluginShellQuote(workspace) + " --branch codex/worktree-fixture"
				executionTool(w, "Bash", map[string]string{"command": command}, stage)
				return
			case 2:
				var created struct {
					Repos []struct {
						Worktree string `json:"worktree_path"`
					} `json:"repos"`
				}
				if err := json.Unmarshal([]byte(shellStdout(t, receipt)), &created); err != nil || len(created.Repos) != 2 {
					t.Error("original script did not register two actual worktrees")
					return
				}
				for _, repo := range created.Repos {
					worktrees = append(worktrees, repo.Worktree)
				}
				executionTool(w, "Agent", map[string]string{"subagent_type": "general-purpose", "model": "analysis", "description": "write selected worktrees", "prompt": "Perform the fixture worktree reads and writes."}, stage)
				return
			case 3:
				var commands []string
				for _, repo := range worktrees {
					commands = append(commands, "git -C "+pluginShellQuote(repo)+" add feature.txt && git -C "+pluginShellQuote(repo)+" commit -m fixture-change")
				}
				commands = append(commands, "cd "+pluginShellQuote(worktrees[0])+" && "+commandPrefix+" --resume cli-worktree --project-root .")
				executionTool(w, "Bash", map[string]string{"command": strings.Join(commands, " && ")}, stage)
				return
			case 4:
				output := shellStdout(t, receipt)
				if !strings.Contains(output, `"action": "resume"`) || !strings.Contains(output, `"worktree_path"`) {
					t.Error("original registry did not resume from inside its Git worktree")
				}
				command := commandPrefix + " --cleanup cli-worktree --repos " + pluginShellQuote(strings.Join(repositories, ",")) + " --workspace " + pluginShellQuote(workspace)
				executionTool(w, "Bash", map[string]string{"command": command}, stage)
				return
			case 5:
				if output := shellStdout(t, receipt); strings.Count(output, `"status": "removed"`) != 2 {
					t.Error("original cleanup did not remove both clean worktrees")
				}
			default:
				t.Errorf("unexpected parent request %d", stage)
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"actual worktree effects verified\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer provider.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	process := startPluginWireProcess(t, ctx, base, []string{"coder-worktree-fixture", "--endpoint", provider.URL + "/v1", "--model", "fixture", "--selectable-model", "fixture-analysis", "--plugin-model", "analysis=fixture-analysis", "--session-dir", sessions, "--workspace", workspace, "--plugin-dir", source, "--enable-shell", "--api-key-env", "PERO_WORKTREE_KEY", "--max-requests", "16", "--max-tokens", "2048", "--max-retries", "0"})
	process.rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	process.sessionID = process.rpc("session/new", map[string]any{"cwd": workspace, "mcpServers": []any{}})["sessionId"].(string)
	process.rpc("session/set_config_option", map[string]any{"sessionId": process.sessionID, "configId": "permission", "value": "full-access"})
	if result := process.rpc("session/prompt", map[string]any{"sessionId": process.sessionID, "prompt": []any{map[string]string{"type": "text", "text": "Run the original selected worktree script in the fixture."}}}); result["stopReason"] != "end_turn" {
		t.Fatal(result)
	}
	if parentCalls.Load() != 5 || childCalls.Load() != 4 || process.approvals != 5 {
		t.Fatalf("execution/approval counts: parent=%d child=%d approvals=%d", parentCalls.Load(), childCalls.Load(), process.approvals)
	}
	for i, repo := range repositories {
		if data, err := os.ReadFile(filepath.Join(repo, "seed.txt")); err != nil || string(data) != "original "+filepath.Base(repo) {
			t.Fatal("the original repository changed")
		}
		if _, err := os.Stat(filepath.Join(repo, "feature.txt")); !os.IsNotExist(err) {
			t.Fatal("child wrote the original repository instead of its worktree")
		}
		if _, err := os.Stat(worktrees[i]); !os.IsNotExist(err) {
			t.Fatal("worktree directory survived cleanup")
		}
		contents, err := exec.Command("git", "-C", repo, "show", "codex/worktree-fixture:feature.txt").CombinedOutput()
		if err != nil || string(contents) != "child wrote once" {
			t.Fatalf("the worktree commit was lost or not executed: %v %s", err, contents)
		}
	}
	process.rpc("session/close", map[string]string{"sessionId": process.sessionID})
	_ = process.input.Close()
	err = process.command.Wait()
	process.waited = true
	if err != nil {
		t.Fatalf("CLI cleanup: %v %s", err, process.diagnostics.String())
	}
}
