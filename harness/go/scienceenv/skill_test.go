package scienceenv

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	runtime "github.com/phodal/pero/harness/go/runtime"
)

func TestSkillLoadRejectsStatementsAndKeepsHelpers(t *testing.T) {
	python := pythonBin(t)
	root := t.TempDir()
	kernel, err := Start(Config{Language: Python, Interpreter: python, Workspace: root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { kernel.Close() })
	rejected, err := kernel.Load(t.Context(), "print('no')\n", Host{})
	if err != nil || !strings.Contains(rejected.Error, "not a function or constant") {
		t.Fatalf("rejected skill: %+v %v", rejected, err)
	}
	loaded, err := kernel.Load(t.Context(), "VALUE = 3\ndef add(x):\n    return x + VALUE\n", Host{})
	if err != nil || loaded.Error != "" {
		t.Fatalf("load: %+v %v", loaded, err)
	}
	out, err := kernel.Exec(t.Context(), "print(add(1))", Host{})
	if err != nil || !strings.Contains(out.Stdout, "4") || out.Error != "" {
		t.Fatalf("helper: %+v %v", out, err)
	}
}

func TestLiteratureSkillSidecarLoads(t *testing.T) {
	path := filepath.Join(os.Getenv("HOME"), ".claude-science/runtime/0.1.60-release/skills/literature-review/kernel.py")
	source, err := os.ReadFile(path)
	if err != nil {
		t.Skip("installed literature-review skill is absent")
	}
	kernel, err := Start(Config{Language: Python, Interpreter: pythonBin(t), Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { kernel.Close() })
	loaded, err := kernel.Load(t.Context(), string(source), Host{})
	if err != nil || loaded.Error != "" {
		t.Fatalf("literature sidecar: %+v %v", loaded, err)
	}
	out, err := kernel.Exec(t.Context(), "print('verify_dois' in dir() and 'style_pass' in dir())", Host{})
	if err != nil || !strings.Contains(out.Stdout, "True") || out.Error != "" {
		t.Fatalf("helpers missing: %+v %v", out, err)
	}
}

func TestScienceSkillArtifactAndSearch(t *testing.T) {
	root := t.TempDir()
	skills := filepath.Join(root, "skills")
	skillDir := filepath.Join(skills, "literature-review")
	if err := os.MkdirAll(skillDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("---\nname: literature-review\ndescription: Find papers.\n---\n\nRetrieve first.\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "kernel.py"), []byte("MARK = 'loaded'\ndef marker():\n    return MARK\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx := t.Context()
	h, err := harness.Boot(ctx, harness.Options{ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		h.Dispose(context.Background())
		h.Drain(context.Background())
	})
	env, err := Mount(ctx, h, Options{Workspace: root, Python: pythonBin(t), SkillRoot: skills, ContactEmail: "person@example.com", MCP: AgentMCP(h)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { env.Close() })
	agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "science-skill", CWD: root, Configure: func(_ context.Context, run *runtime.Run, _ *harness.Agent) error {
		_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
			return harness.ApprovalAllowedOnce, nil
		})
		return err
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Session().Append("turn/start", map[string]int{"turn": 1}); err != nil {
		t.Fatal(err)
	}
	seq := 0
	call := func(name, args string) harness.ToolResult {
		t.Helper()
		seq++
		out, err := h.Tools().Execute(ctx, harness.ToolRequest{Agent: agent, Name: name, CallID: harness.ToolCallID(fmt.Sprintf("%s-%d", name, seq)), Arguments: json.RawMessage(args)})
		if err != nil {
			t.Fatal(err)
		}
		return out.Result
	}
	found := call("search_skills", `{"prefix":"literature"}`)
	if found.IsError || !strings.Contains(found.Content[0].Text, "Find papers.") {
		t.Fatalf("search: %+v", found)
	}
	loaded := call("skill", `{"skill":"literature-review"}`)
	if loaded.IsError || !strings.Contains(loaded.Content[0].Text, "Retrieve first.") {
		t.Fatalf("skill: %+v", loaded)
	}
	ran := call("python", `{"code":"import host\nprint(marker())\nprint(host.get_user_email())"}`)
	if ran.IsError || !strings.Contains(ran.Content[0].Text, "loaded") || !strings.Contains(ran.Content[0].Text, "person@example.com") {
		t.Fatalf("python after skill: %+v", ran)
	}
	saved := call("save_artifacts", `{"paths":["note.md"]}`)
	if saved.IsError {
		t.Fatalf("save: %+v", saved)
	}
	var records []struct {
		VersionID string `json:"version_id"`
	}
	if err := json.Unmarshal(saved.Value, &records); err != nil || len(records) != 1 {
		t.Fatalf("records: %s %v", saved.Value, err)
	}
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	opened := call("python", `{"code":"import host\nprint(open(host.artifact_path('`+records[0].VersionID+`')).read())"}`)
	if opened.IsError || !strings.Contains(opened.Content[0].Text, "hello") || strings.Contains(opened.Content[0].Text, "changed") {
		t.Fatalf("artifact: %+v", opened)
	}
}

func TestInstalledLiteratureMCPConnects(t *testing.T) {
	python := filepath.Join(os.Getenv("HOME"), ".claude-science/conda/envs/claude-science-mcp/bin/python")
	root := filepath.Join(os.Getenv("HOME"), ".claude-science/runtime/0.1.60-release/mcp-servers/bio-tools")
	if _, err := os.Stat(python); err != nil {
		t.Skip("installed science MCP interpreter is absent")
	}
	if _, err := os.Stat(filepath.Join(root, "run_server.py")); err != nil {
		t.Skip("installed bio-tools MCP root is absent")
	}
	ctx := t.Context()
	h, err := harness.Boot(ctx, harness.Options{ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		h.Dispose(context.Background())
		h.Drain(context.Background())
	})
	workspace := t.TempDir()
	env, err := Mount(ctx, h, Options{Workspace: workspace, Python: pythonBin(t), MCPPython: python, MCPServersRoot: root, MCP: AgentMCP(h)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { env.Close() })
	agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "science-mcp", CWD: workspace})
	if err != nil {
		t.Fatal(err)
	}
	expected, err := BioServers(python, root, workspace)
	if err != nil {
		t.Fatal(err)
	}
	schemas, err := h.Tools().SchemasForAgent(ctx, agent)
	if err != nil {
		t.Fatal(err)
	}
	joined := ""
	for _, schema := range schemas {
		joined += schema.Name + "\n"
	}
	var missing []string
	for _, server := range expected {
		if !strings.Contains(joined, server.Name) {
			missing = append(missing, server.Name)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("servers without published tools: %s", strings.Join(missing, ", "))
	}
	t.Logf("connected %d bio MCP servers", len(expected))
}

func TestLiteratureServerConfig(t *testing.T) {
	root := t.TempDir()
	python := pythonBin(t)
	if err := os.WriteFile(filepath.Join(root, "run_server.py"), []byte("print('no')\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"mcp_pubmed", "mcp_literature", "mcp_zinc"} {
		dir := filepath.Join(root, "lib", name)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "server.py"), []byte("def main():\n    pass\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(root, "lib", "mcp_servers_common"), 0o700); err != nil {
		t.Fatal(err)
	}
	servers, err := BioServers(python, root, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(servers) != 3 || servers[0].Name != "mcp_literature" || servers[1].Name != "mcp_pubmed" || servers[2].Name != "mcp_zinc" || !filepath.IsAbs(servers[0].Command) {
		t.Fatalf("servers: %+v", servers)
	}
}
