//go:build linux || darwin

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewCodeCLIMultiRepositoryLifecycleOptIn(t *testing.T) {
	source := os.Getenv("PERO_NEW_CODE_SOURCE")
	if source == "" {
		t.Skip("PERO_NEW_CODE_SOURCE selects the inspected original new-code package")
	}
	source, err := filepath.Abs(source)
	if err != nil {
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
	git := func(directory string, args ...string) string {
		t.Helper()
		output, err := exec.Command("git", append([]string{"-C", directory}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("Git fixture %v: %v %s", args, err, output)
		}
		return strings.TrimSpace(string(output))
	}
	var repositories, remotes []string
	for _, name := range []string{"repo-a", "repo-b"} {
		repo, remote := filepath.Join(workspace, name), filepath.Join(base, name+".git")
		for _, directory := range []string{repo, remote} {
			if err := os.Mkdir(directory, 0700); err != nil {
				t.Fatal(err)
			}
		}
		git(remote, "init", "--bare")
		git(repo, "init", "-b", "main")
		git(repo, "config", "user.name", "Fixture")
		git(repo, "config", "user.email", "fixture@example.invalid")
		git(repo, "remote", "add", "origin", remote)
		if err := os.WriteFile(filepath.Join(repo, "seed.txt"), []byte("original"), 0600); err != nil {
			t.Fatal(err)
		}
		git(repo, "add", ".")
		git(repo, "commit", "-m", "fixture baseline")
		repositories, remotes = append(repositories, repo), append(remotes, remote)
	}
	const requestID = "feed1234"
	var worktrees []string
	var sessionID string
	var parents, children atomic.Int32
	// All state transitions use the package's actual CLIs. This fixture program
	// only joins their JSON outputs; it never writes state or test receipts.
	prefix := fmt.Sprintf(`const {spawnSync}=require('node:child_process');const {join}=require('node:path');const fs=require('node:fs');
const root=%q,plugin=%q,node=process.execPath,id=%q;
function run(name,args){const r=spawnSync(node,[join(plugin,'scripts',name),...args],{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error(name+' '+args[0]+': '+r.status+' signal='+r.signal+' '+(r.error||r.stderr||r.stdout));return JSON.parse(r.stdout)}
function git(cwd,args){const r=spawnSync('git',args,{cwd,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout.trim()}
function payload(value){const file=join(root,'.new-code',id,'fixture-input.json');fs.writeFileSync(file,JSON.stringify(value));return file}
function state(){return run('state-store.mjs',['read','--root',root,'--request-id',id])}
function verify(){const results=state().worktrees.map(w=>({...run('test-runner.mjs',['run','--cwd',w.path,'--output-dir',join(root,'.new-code',id,'tests',w.repo_id),'--',node,'--test']),repo_id:w.repo_id}));return run('state-store.mjs',['annotate','--root',root,'--request-id',id,'--type','verification','--payload-file',payload({verification:{passed:results.every(r=>r.passed),results}})])}
`, workspace, source, requestID)
	command := func(body string) string {
		return "cd " + pluginShellQuote(workspace) + " && " + pluginShellQuote(node) + " -e " + pluginShellQuote(prefix+body)
	}
	answer := func(w http.ResponseWriter, text string) {
		chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]string{"content": text}, "finish_reason": "stop"}}})
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", chunk)
	}
	sessionPattern := regexp.MustCompile(`new-code session_id: ([A-Za-z0-9-]+)`)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request pluginExecutionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		text, receipt := request.text()
		if request.Model == "fixture-review" {
			switch stage := children.Add(1); stage {
			case 1, 2:
				if stage == 2 && !strings.Contains(receipt, "value = 1") {
					t.Error("independent reviewer did not read the first actual feature")
				}
				executionTool(w, "Read", map[string]string{"file_path": filepath.Join(worktrees[stage-1], "feature.mjs")}, stage)
			case 3:
				if !strings.Contains(receipt, "value = 1") {
					t.Error("independent reviewer did not read the second actual feature")
				}
				answer(w, "independent fixture reads complete")
			default:
				t.Errorf("unexpected child request %d", stage)
			}
			return
		}
		switch stage := parents.Add(1); stage {
		case 1:
			match := sessionPattern.FindStringSubmatch(text)
			if len(match) != 2 || strings.Contains(text, "${CLAUDE_SESSION_ID}") {
				t.Error("original SessionStart or skill session substitution is missing")
				return
			}
			sessionID = match[1]
			setup := fmt.Sprintf(`const repos=run('repo-discovery.mjs',['discover','--root',root]);run('state-store.mjs',['create','--root',root,'--request-id',id,'--request','two local fixture features','--repos-json',JSON.stringify(repos)]);run('state-store.mjs',['bind-session','--root',root,'--request-id',id,'--session-id',%q]);const worktrees=run('worktree-manager.mjs',['create-all','--project-root',root,'--request-id',id,'--repos-json',JSON.stringify(repos)]);console.log(JSON.stringify(run('state-store.mjs',['transition','--root',root,'--request-id',id,'--to','in_progress','--payload-file',payload({worktrees})])));`, sessionID)
			executionTool(w, "Bash", map[string]string{"command": command(setup)}, stage)
		case 2:
			var state struct{ Worktrees []struct{ Path string } }
			if err := json.Unmarshal([]byte(shellStdout(t, receipt)), &state); err != nil || len(state.Worktrees) != 2 {
				t.Errorf("original setup did not create two worktrees: %s", receipt)
				return
			}
			for _, entry := range state.Worktrees {
				worktrees = append(worktrees, entry.Path)
			}
			executionTool(w, "Write", map[string]string{"file_path": filepath.Join(repositories[0], "seed.txt"), "content": "must be rejected"}, stage)
		case 3:
			if !strings.Contains(receipt, "bound to "+requestID) {
				t.Error("original write guard did not reject the main repository")
			}
			executionTool(w, "Write", map[string]string{"file_path": filepath.Join(worktrees[0], "feature.mjs"), "content": "export const value = 0;\n"}, stage)
		case 4, 6:
			repo := 0
			if stage == 6 {
				repo = 1
			}
			executionTool(w, "Write", map[string]string{"file_path": filepath.Join(worktrees[repo], "feature.test.mjs"), "content": "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from './feature.mjs';\ntest('new fixture contract',()=>assert.equal(value,1));\n"}, stage)
		case 5:
			executionTool(w, "Write", map[string]string{"file_path": filepath.Join(worktrees[1], "feature.mjs"), "content": "export const value = 1;\n"}, stage)
		case 7:
			body := `const s=state();for(const w of s.worktrees){git(w.path,['add','.']);git(w.path,['commit','-m','fixture feature'])}const w=s.worktrees[0];const result=run('test-runner.mjs',['run','--cwd',w.path,'--output-dir',join(root,'.new-code',id,'tests',w.repo_id),'--',node,'--test']);console.log(JSON.stringify(run('state-store.mjs',['annotate','--root',root,'--request-id',id,'--type','verification','--payload-file',payload({verification:{passed:result.passed,results:[{...result,repo_id:w.repo_id}]}})])));`
			executionTool(w, "Bash", map[string]string{"command": command(body)}, stage)
		case 8:
			if !strings.Contains(shellStdout(t, receipt), `"passed":false`) {
				t.Error("actual failing test was not recorded")
			}
			answer(w, "I will stop with the failing test still recorded.")
		case 9:
			if !strings.Contains(text, "has a recorded failing test") {
				t.Error("original Stop hook did not require a real continuation")
			}
			executionTool(w, "Edit", map[string]string{"file_path": filepath.Join(worktrees[0], "feature.mjs"), "old_string": "value = 0", "new_string": "value = 1"}, stage)
		case 10:
			executionTool(w, "Bash", map[string]string{"command": command(`const w=state().worktrees[0];git(w.path,['add','.']);git(w.path,['commit','-m','fix actual failing test']);console.log(JSON.stringify(verify()));`)}, stage)
		case 11:
			if !strings.Contains(shellStdout(t, receipt), `"passed":true`) {
				t.Error("per-repository tests did not pass after the actual edit")
			}
			executionTool(w, "Agent", map[string]string{"subagent_type": "new-code:fresh-reviewer", "model": "sonnet", "description": "independent two repository check", "prompt": "Read the two fixture feature files and report their actual value."}, stage)
		case 12:
			if !strings.Contains(receipt, "independent fixture reads complete") {
				t.Error("parent did not receive the actual review result")
			}
			executionTool(w, "Write", map[string]string{"file_path": filepath.Join(worktrees[0], "release.txt"), "content": "verify this new commit before local publication\n"}, stage)
		case 13:
			executionTool(w, "Bash", map[string]string{"command": command(`const w=state().worktrees[0];git(w.path,['add','.']);git(w.path,['commit','-m','new unverified commit']);console.log(JSON.stringify(run('branch-manager.mjs',['publish-all','--root',root,'--request-id',id,'--confirm'])));`)}, stage)
		case 14:
			if !strings.Contains(receipt, "re-run tests on the current code") {
				t.Error("original publish gate did not reject stale HEAD evidence")
			}
			body := `verify();const result=run('branch-manager.mjs',['publish-all','--root',root,'--request-id',id,'--confirm']);if(!result.published||result.verification_waived)throw Error('publication failed or waived');const publications=result.receipts.filter(r=>r.status==='pushed').map(r=>({...r,pushed_at:new Date().toISOString()}));console.log(JSON.stringify(run('state-store.mjs',['transition','--root',root,'--request-id',id,'--to','published_testing','--payload-file',payload({publications})])));`
			executionTool(w, "Bash", map[string]string{"command": command(body)}, stage)
		case 15:
			if !strings.Contains(shellStdout(t, receipt), `"published_testing"`) {
				t.Error("publication did not retain the testing lifecycle")
			}
			answer(w, "published_testing; both local branches are retained")
		case 16:
			if !strings.Contains(text, "完结是唯一") {
				t.Error("the explicit done command was not expanded")
			}
			body := fmt.Sprintf(`run('state-store.mjs',['transition','--root',root,'--request-id',id,'--to','completed']);run('state-store.mjs',['unbind-session','--root',root,'--session-id',%q]);run('worktree-manager.mjs',['remove-all','--project-root',root,'--request-id',id]);console.log(JSON.stringify(state()));`, sessionID)
			executionTool(w, "Bash", map[string]string{"command": command(body)}, stage)
		case 17:
			if !strings.Contains(shellStdout(t, receipt), `"completed"`) {
				t.Error("explicit done did not complete the request")
			}
			answer(w, "explicit completion and cleanup verified")
		default:
			t.Errorf("unexpected parent request %d", stage)
		}
	}))
	defer provider.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	process := startPluginWireProcess(t, ctx, base, []string{"new-code-fixture", "--endpoint", provider.URL + "/v1", "--model", "fixture", "--plugin-model", "sonnet=fixture-review", "--session-dir", sessions, "--workspace", workspace, "--plugin-dir", source, "--enable-shell", "--api-key-env", "PERO_WORKTREE_KEY", "--max-requests", "32", "--max-tokens", "2048", "--max-retries", "0"})
	process.rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	process.sessionID = process.rpc("session/new", map[string]any{"cwd": workspace, "mcpServers": []any{}})["sessionId"].(string)
	process.rpc("session/set_config_option", map[string]any{"sessionId": process.sessionID, "configId": "permission", "value": "full-access"})
	prompt := func(text string) {
		t.Helper()
		if result := process.rpc("session/prompt", map[string]any{"sessionId": process.sessionID, "prompt": []any{map[string]string{"type": "text", "text": text}}}); result["stopReason"] != "end_turn" {
			t.Fatal(result)
		}
	}
	prompt("/new-code:new-code Implement and verify both fixture features; publication is authorized only to the two disposable local bare remotes. Keep published_testing active.")
	statePath := filepath.Join(workspace, ".new-code", requestID, "state.json")
	readState := func() string {
		t.Helper()
		data, err := os.ReadFile(statePath)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	if !strings.Contains(readState(), `"status": "published_testing"`) || sessionID != process.sessionID {
		t.Fatal("publication completed or lost its actual session binding")
	}
	binding := filepath.Join(workspace, ".new-code", "sessions", sessionID+".json")
	if _, err := os.Stat(binding); err != nil {
		t.Fatal("publication unbound the session")
	}
	for _, path := range worktrees {
		if _, err := os.Stat(path); err != nil {
			t.Fatal("publication removed an active worktree")
		}
	}
	prompt("/new-code:new-code-done feed1234 Explicitly confirm completion of this disposable fixture and cleanup of its clean worktrees; retain local and bare-remote feature branches.")
	if !strings.Contains(readState(), `"status": "completed"`) || parents.Load() != 17 || children.Load() != 3 || process.approvals != 12 {
		t.Fatalf("lifecycle counts parent=%d child=%d approvals=%d state=%s", parents.Load(), children.Load(), process.approvals, readState())
	}
	if _, err := os.Stat(binding); !os.IsNotExist(err) {
		t.Fatal("completed request retained its session binding")
	}
	for i, repo := range repositories {
		if data, err := os.ReadFile(filepath.Join(repo, "seed.txt")); err != nil || string(data) != "original" || git(repo, "status", "--porcelain") != "" {
			t.Fatal("the original repository changed")
		}
		if _, err := os.Stat(worktrees[i]); !os.IsNotExist(err) {
			t.Fatal("explicit done did not clean up the worktree")
		}
		if git(repo, "show", "new-code/"+requestID+":feature.mjs") != "export const value = 1;" || git(remotes[i], "show", "new-code/"+requestID+":feature.mjs") != "export const value = 1;" {
			t.Fatal("local publication or cleanup lost a feature branch")
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
