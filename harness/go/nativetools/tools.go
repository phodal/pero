// Package nativetools is explicit headless composition, not a sandbox or a
// product profile. Read authority is granted by the configured workspace;
// mutations and every shell invocation additionally require ACP approval.
package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"time"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/sandbox"
	"github.com/phodal/pero/harness/go/shell"
	"github.com/phodal/pero/harness/go/tool"
)

type Options struct {
	// SpillStore enables Session-owned readback of projected tool output.
	SpillStore          *harness.LocalSpillStore
	Sandbox             *sandbox.Config
	Workspace           string
	EnableShell         bool
	EnableResearchClone bool
	Shell               string
	ClaudeTools         bool
	// DeferToolLoading starts with ToolSearch and declares authorized tool
	// schemas on subsequent requests after a successful catalog search.
	DeferToolLoading bool
	// PDFRendererPath selects a probed Poppler pdftoppm/pdfinfo pair. Empty
	// discovers an installed pair; "-" disables PDF page rendering.
	PDFRendererPath string
	// BackgroundNotifications enables root Bash completion delivery and recovery.
	// The selected plugin CLI enables it; library hosts opt in explicitly.
	BackgroundNotifications bool
	ReadOnlyResource        func(context.Context, string) (fstools.ScopedText, error)
	PluginEnvironment       []string
	BashOutput              BashOutputOptions
	BashTiming              BashTimingOptions
	// BashEnvFile is sourced before each Bash command when it has content.
	BashEnvFile func(*harness.Agent) string
	// OnShellDirectory runs after a Bash command leaves the shell in another directory.
	OnShellDirectory func(*harness.Agent, string, string)
}
type App struct {
	files      *fstools.Workspace
	shell      *shell.LocalExecutor
	background *shellTasks
}

func (a *App) Close() error {
	if a == nil || a.files == nil {
		return nil
	}
	var err error
	if a.background != nil && a.background.instance != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		err = a.background.instance.Dispose(ctx)
	}
	return errors.Join(err, a.files.Close())
}

// CheckCWD reuses the launch-time workspace authority for early ACP admission.
// Tool bodies still recheck it before execution to catch later changes.
func (a *App) CheckCWD(cwd string) error {
	if a == nil {
		return errors.New("native workspace is unavailable")
	}
	if a.files != nil {
		if err := a.files.CheckCWD(cwd); err == nil {
			return nil
		}
		if value, ok := boundWorkspaces.Load(cwd); ok {
			return value.(*fstools.Workspace).CheckCWD(cwd)
		}
		return a.files.CheckCWD(cwd)
	}
	if a.shell != nil {
		return a.shell.CheckCWD(cwd)
	}
	return errors.New("native workspace is unavailable")
}

type arguments struct {
	Patch                                          string             `json:"patch"`
	Path                                           string             `json:"path"`
	Content                                        string             `json:"content"`
	OldText                                        string             `json:"old_text"`
	NewText                                        string             `json:"new_text"`
	ReplaceAll                                     bool               `json:"replace_all"`
	Edits                                          []fstools.TextEdit `json:"edits"`
	Query                                          string             `json:"query"`
	Cursor                                         string             `json:"cursor"`
	Offset                                         int                `json:"offset"`
	Limit                                          int                `json:"limit"`
	Command                                        string             `json:"command"`
	Workdir                                        string             `json:"workdir"`
	TimeoutMS                                      int                `json:"timeout_ms"`
	TerminateOnTimeout                             bool               `json:"terminate_on_timeout"`
	Pattern                                        string             `json:"pattern"`
	Glob                                           string             `json:"glob"`
	FileType                                       string
	OutputMode                                     string `json:"output_mode"`
	IgnoreCase                                     bool   `json:"ignore_case"`
	Multiline                                      bool   `json:"multiline"`
	LineNumbers                                    *bool
	Before, After, Around, HeadLimit, SearchOffset int
	ResourcePath                                   string
	RunInBackground                                bool
	Description                                    string
	CellID                                         string
	CellType                                       string
	EditMode                                       string
}

type toolDefinition struct {
	name, description, properties, required string
	approval                                bool
	run                                     func(context.Context, arguments) (any, error)
}

func Mount(ctx context.Context, h *harness.Harness, opts Options) (app *App, resultErr error) {
	if h == nil {
		return nil, errors.New("native tools require harness")
	}
	if opts.Sandbox != nil {
		if !opts.EnableShell {
			return nil, errors.New("sandbox requires enabled shell")
		}
		copyConfig := *opts.Sandbox
		copyConfig.RuntimePaths = append([]string(nil), opts.Sandbox.RuntimePaths...)
		opts.Sandbox = &copyConfig
		if err := opts.Sandbox.Validate(); err != nil {
			return nil, err
		}
	}
	windowsShell := runtime.GOOS == "windows" && opts.Sandbox != nil && opts.Sandbox.Backend == sandbox.BackendWindowsACL
	files, err := fstools.OpenWorkspace(opts.Workspace)
	if err != nil {
		return nil, err
	}
	workspace := files.Path()
	app = &App{files: files}
	// Capture ownership now: an error return replaces the named app with nil.
	defer func(owned *App) {
		if resultErr != nil {
			_ = owned.Close()
		}
	}(app)
	var shellAdmission func(context.Context, harness.ToolRequest) (*harness.NativeApprovalDescriptor, error)
	definitions := []toolDefinition{
		{"notebook_read", "Read saved Jupyter nbformat 4 cell source, IDs, execution counts, outputs and attachments from a workspace .ipynb file. offset is a 1-based cell number (default 1), limit defaults to 20. Results have a 48 KiB cell budget, explicit truncation and next_offset. No code execution or image/HTML rendering; large cells omit outputs and shorten source.", `"path":{"type":"string","minLength":1},"offset":{"type":"integer","minimum":1},"limit":{"type":"integer","minimum":1,"maximum":100}`, `"path"`, false, func(c context.Context, a arguments) (any, error) {
			return readNotebook(c, workspaceFrom(c, files), a)
		}},
		{"read_file", "Read bounded UTF-8 text from an existing workspace-relative file. offset is a 1-based line number.", `"path":{"type":"string"},"offset":{"type":"integer","minimum":1},"limit":{"type":"integer","minimum":1,"maximum":2000}`, `"path"`, false, func(c context.Context, a arguments) (any, error) {
			v, e := workspaceFrom(c, files).Read(c, a.Path)
			if e != nil {
				return nil, e
			}
			window, err := fstools.FormatRead(v, a.Offset, a.Limit)
			if err != nil {
				return nil, err
			}
			return nativeReadResult(window, a.Offset, a.Limit, ""), nil
		}},
		{"write_file", "Create or replace a bounded UTF-8 file under the configured workspace. Parent directory must already exist. Requires approval.", `"path":{"type":"string"},"content":{"type":"string","maxLength":1048576}`, `"path","content"`, true, func(c context.Context, a arguments) (any, error) {
			return workspaceFrom(c, files).Write(c, a.Path, a.Content)
		}},
		{"edit_file", "Edit exact text in an existing workspace file. Use old_text/new_text or edits with 1..64 disjoint replacements matched against the original file; never combine both forms. All replacements validate before one write. Requires approval.", `"path":{"type":"string"},"old_text":{"type":"string","minLength":1,"maxLength":1048576},"new_text":{"type":"string","maxLength":1048576},"replace_all":{"type":"boolean"},"edits":{"type":"array","minItems":1,"maxItems":64,"items":{"type":"object","additionalProperties":false,"properties":{"old_text":{"type":"string","minLength":1},"new_text":{"type":"string"},"replace_all":{"type":"boolean"}},"required":["old_text","new_text"]}}`, `"path"`, true, func(c context.Context, a arguments) (any, error) {
			if a.Edits != nil {
				return workspaceFrom(c, files).EditBatch(c, a.Path, a.Edits)
			}
			return workspaceFrom(c, files).Edit(c, a.Path, a.OldText, a.NewText, a.ReplaceAll)
		}},
		{"list_directory", "List up to 256 direct workspace directory entries; does not follow symlinks.", `"path":{"type":"string"}`, ``, false, func(c context.Context, a arguments) (any, error) { return workspaceFrom(c, files).List(c, a.Path) }},
		{"search_files", "Find literal query text in bounded workspace files. At most 512 entries, 8 MiB text and 64 matches; symlinks skipped.", `"path":{"type":"string"},"query":{"type":"string","minLength":1,"maxLength":4096}`, `"query"`, false, func(c context.Context, a arguments) (any, error) {
			return workspaceFrom(c, files).Search(c, a.Path, a.Query)
		}},
	}
	if !opts.ClaudeTools {
		definitions = append(definitions, genericSearchDefinitions(files)...)
	}
	if files.SupportsReplacement() {
		definitions = append(definitions, toolDefinition{"apply_patch", "Apply an approved multi-file text patch. Format: *** Begin Patch, then *** Add File: path (+lines), *** Update File: path (@@ hunks with space context, -removed, +added), or *** Delete File: path, ending *** End Patch. Updates may include *** Move to: new-path and @@ exact anchor or *** End of File. Paths are workspace-relative; parents must exist, add/move targets must be absent, and context must match uniquely. At most 32 files/1 MiB patch. All files are preflighted; commits are ordered, not transactional. Inspect per-file applied/unknown/not-applied receipts before retrying a partial failure.", `"patch":{"type":"string","minLength":1,"maxLength":1048576}`, `"patch"`, true, func(ctx context.Context, input arguments) (any, error) {
			return workspaceFrom(ctx, files).ApplyPatch(ctx, input.Patch)
		}})
	}
	if opts.ClaudeTools && files.SupportsReplacement() {
		definitions = append(definitions, toolDefinition{
			"notebook_edit",
			"Modify one Jupyter notebook cell by cell_id. edit_mode is replace, insert or delete. Requires approval.",
			`"notebook_path":{"type":"string","minLength":1},"cell_id":{"type":"string"},"new_source":{"type":"string","maxLength":1048576},"cell_type":{"type":"string","enum":["code","markdown"]},"edit_mode":{"type":"string","enum":["replace","insert","delete"]}`,
			`"notebook_path","new_source"`,
			true,
			func(c context.Context, a arguments) (any, error) { return editNotebook(c, workspaceFrom(c, files), a) },
		})
	}
	if opts.EnableShell || opts.EnableResearchClone {
		if opts.Shell == "" {
			if windowsShell {
				return nil, errors.New("Windows shell requires an explicit absolute --shell path to pwsh.exe")
			}
			opts.Shell = "/bin/bash"
		}
		shellOptions := shell.LocalOptions{Sandbox: opts.Sandbox, Shell: opts.Shell, CWD: workspace, Timeout: 30 * time.Second, MaxTimeout: 120 * time.Second, MaxOutputBytes: 16 << 10, Grace: 200 * time.Millisecond, BaseEnv: []string{"PATH=/usr/bin:/bin", "LANG=C.UTF-8"}, AllowWorkdir: isolatedWorkdir}
		if opts.ClaudeTools && opts.PluginEnvironment != nil {
			shellOptions.BaseEnv = opts.PluginEnvironment
			shellOptions.TrustedBaseEnvironment = true
		}
		if opts.ClaudeTools {
			shellOptions.Timeout, shellOptions.MaxTimeout = 120*time.Second, 600*time.Second
			if opts.EnableShell {
				timing, timingErr := resolveBashTimingPolicy(opts.BashTiming, opts.PluginEnvironment)
				if timingErr != nil {
					return nil, timingErr
				}
				shellOptions.Timeout, shellOptions.MaxTimeout = timing.foregroundDefault, timing.foregroundMaximum
				policy, policyErr := resolveBashOutputPolicy(opts.BashOutput, opts.PluginEnvironment)
				if policyErr != nil {
					return nil, policyErr
				}
				app.background, err = mountShellTasks(ctx, h, shellOptions, policy, timing, opts.BackgroundNotifications, opts.BashEnvFile, opts.OnShellDirectory)
				if err != nil {
					return nil, err
				}
			}
		}
		executor, e := shell.NewLocalExecutor(shellOptions)
		if e != nil {
			return nil, e
		}
		app.shell = executor
		if opts.EnableResearchClone {
			if err := mountResearchClone(ctx, h, workspace, executor); err != nil {
				return nil, err
			}
		}
		if opts.EnableShell {
			if opts.Sandbox != nil && opts.Sandbox.Backend != sandbox.BackendWindowsACL {
				shellAdmission = func(c context.Context, request harness.ToolRequest) (*harness.NativeApprovalDescriptor, error) {
					if request.Agent == nil {
						return nil, errors.New("native shell admission requires agent")
					}
					if err := app.CheckCWD(request.Agent.Session().WorkingDirectory()); err != nil {
						return nil, err
					}
					a, err := decodeNativeArguments(request.Arguments, workspace, opts.ClaudeTools, false, opts.Workspace)
					if err != nil {
						return nil, err
					}
					admissionExecutor := executor
					selectedTimeout := time.Duration(a.TimeoutMS) * time.Millisecond
					workdir := workspace
					if opts.ClaudeTools && app.background != nil {
						workdir, _ = app.background.directoryForCommand(c, request.Agent, a.Workdir)
						selection, timingErr := app.background.timingPolicy.selectTimeout(a.Command, a.TimeoutMS, a.RunInBackground, a.TerminateOnTimeout)
						if timingErr != nil {
							return nil, timingErr
						}
						selectedTimeout = selection.resolveTimeout
					}
					if a.RunInBackground && app.background != nil {
						backgroundOptions := app.background.options
						admissionExecutor, err = shell.NewLocalExecutor(backgroundOptions)
						if err != nil {
							return nil, err
						}
					}
					if _, err := admissionExecutor.Resolve(shell.ExecRequest{Command: a.Command, Workdir: workdir, Timeout: selectedTimeout}); err != nil {
						return nil, err
					}
					if err := admissionExecutor.CheckConfinement(c); err != nil {
						return nil, err
					}
					return &harness.NativeApprovalDescriptor{Version: 1, Operation: "shell", Workspace: workspace, SandboxMode: string(opts.Sandbox.Mode), Enforcement: "required", Network: "deny"}, nil
				}
			}
			description := "Run an approved foreground Bash command with a minimal environment, bounded output and timeout. NOT an OS sandbox: may access outside workspace or network. No background jobs."
			if opts.Sandbox != nil {
				if windowsShell {
					description = "Run an approved bounded foreground PowerShell command with partial Windows ACL write isolation. Outside reads and network are NOT isolated. Workspace mode: " + string(opts.Sandbox.Mode) + ". File tools remain independently workspace-confined."
				} else {
					description = "Run an approved bounded foreground command in a strict native sandbox. Network denied; only declared runtime files and workspace readable. Workspace mode: " + string(opts.Sandbox.Mode)
				}
			}
			definitions = append(definitions, toolDefinition{"shell", description, `"command":{"type":"string","minLength":1,"maxLength":16384},"timeout_ms":{"type":"integer","minimum":1,"maximum":120000}`, `"command"`, true, func(c context.Context, a arguments) (any, error) {
				root := workspaceFrom(c, files)
				if e := root.CheckCWD(root.Path()); e != nil {
					return nil, e
				}
				spec, e := executor.Resolve(shell.ExecRequest{Command: a.Command, Workdir: root.Path(), Timeout: time.Duration(a.TimeoutMS) * time.Millisecond})
				if e != nil {
					return nil, e
				}
				result, runErr := executor.Run(c, spec)
				if runErr == nil && result.ExitCode != nil && *result.ExitCode != 0 && (!opts.ClaudeTools || !shell.ClaudeCommandSucceeded(spec.Command, result.ExitCode)) {
					runErr = fmt.Errorf("shell exited with code %d", *result.ExitCode)
				}
				return result, runErr
			}})
		}
	}
	// Registered contributions are owned by the Harness and drain before App.Close.
	for _, d := range definitions {
		if opts.Sandbox != nil && opts.Sandbox.Mode == sandbox.ReadOnly && d.approval && d.name != "shell" {
			continue
		}
		if !files.SupportsReplacement() {
			if d.name == "edit_file" || d.name == "notebook_edit" {
				continue
			}
			if d.name == "write_file" {
				d.description = "Create a NEW bounded UTF-8 file under the configured workspace. Windows create-only: existing files are never replaced; edit is unavailable. Parent directory must exist. Requires approval."
			}
		}
		var admission func(context.Context, harness.ToolRequest) (*harness.NativeApprovalDescriptor, error)
		if d.name == "shell" {
			admission = shellAdmission
		}
		if opts.ClaudeTools {
			d = claudeToolDefinition(d, files, opts.ReadOnlyResource)
		}
		schema := json.RawMessage(fmt.Sprintf(`{"type":"object","additionalProperties":false,"properties":{%s},"required":[%s]}`, d.properties, d.required))
		if d.name == "Edit" || d.name == "edit_file" {
			schema = editInputSchema(d.properties, d.required, opts.ClaudeTools)
		}
		toolTimeout := 125 * time.Second
		if opts.ClaudeTools && d.name == "Bash" {
			// The owned execution separates foreground waiting from background
			// deadlines; an outer fixed timer would truncate trusted host limits.
			toolTimeout = 0
		}
		_, err = h.RegisterTool(ctx, "native/"+d.name, harness.Tool{Schema: harness.ToolSchema{Name: d.name, Description: d.description, InputSchema: schema}, RequiresApproval: d.approval, ApprovalDescriptor: admission, Timeout: toolTimeout, ExecutionMode: harness.ExecutionSerial, ExecuteRequest: func(c context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			if request.Agent == nil {
				return harness.ToolResult{}, errors.New("native tools require an agent")
			}
			selected := WorkspaceForToolRequest(request, app.files)
			if e := app.CheckCWD(request.Agent.Session().WorkingDirectory()); e != nil {
				return harness.ToolResult{}, e
			}
			c = withWorkspace(c, selected)
			alias := opts.Workspace
			if selected != app.files {
				alias = selected.Path()
			}
			a, e := decodeNativeArguments(request.Arguments, selected.Path(), opts.ClaudeTools, d.name == "Read" && opts.ReadOnlyResource != nil, alias)
			if e != nil {
				return harness.ToolResult{}, e
			}
			if d.name == "Bash" && app.background != nil {
				return app.background.start(c, request, a)
			}
			value, operationErr := d.run(c, a)
			return renderResult(value, operationErr)

		}})
		if err != nil {
			return nil, err
		}
	}
	if err := mountNativeGuidance(ctx, h, app, opts.Shell); err != nil {
		return nil, err
	}
	if err := mountToolOutputReadback(ctx, h, opts.SpillStore); err != nil {
		return nil, err
	}
	if err := mountPlanTools(ctx, h); err != nil {
		return nil, err
	}
	if err := mountToolSearch(ctx, h, opts.ClaudeTools, opts.DeferToolLoading); err != nil {
		return nil, err
	}
	if err := mountDocumentTools(ctx, h, app, opts.PDFRendererPath, opts.ClaudeTools); err != nil {
		return nil, err
	}
	if err := mountRootWorktreeTools(ctx, h, app, opts); err != nil {
		return nil, err
	}
	if err := MountTerminals(ctx, h, app, opts); err != nil {
		return nil, err
	}
	return app, nil
}

func boundedText(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	text = text[:limit]
	for !utf8.ValidString(text) {
		text = text[:len(text)-1]
	}
	return text
}

// Keep the shell collector's trailing-output contract when applying the smaller
// JSON presentation budget, so final compiler/test diagnostics remain visible.
func boundedTail(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	text = text[len(text)-limit:]
	for !utf8.ValidString(text) {
		text = text[1:]
	}
	return text
}

func renderResult(value any, operationErr error) (harness.ToolResult, error) {
	if media, ok := value.(mediaReadResult); ok && operationErr == nil {
		return harness.ToolResult{Content: []harness.ContentBlock{{
			Type: harness.BlockImage, MIMEType: media.MIMEType, Data: append([]byte(nil), media.Data...),
		}}}, nil
	}
	// JSON escaping may multiply captured shell bytes by six. Keep status and
	// receipts even when textual output must be reduced further.
	switch v := value.(type) {
	case shell.RunResult:
		if len(v.Stdout.Text) > 4096 {
			v.Stdout.Text = boundedTail(v.Stdout.Text, 4096)
			v.Stdout.Truncated = true
		}
		if len(v.Stderr.Text) > 4096 {
			v.Stderr.Text = boundedTail(v.Stderr.Text, 4096)
			v.Stderr.Truncated = true
		}
		value = v
	case fstools.ScopedTextReceipt:
		v.Path = boundedText(v.Path, 1024)
		value = v
	}
	output := value
	if operationErr != nil {
		output = map[string]any{"result": value, "error": boundedText(operationErr.Error(), 1024), "warning": "An operation can have partial effects; inspect reported state before retrying. Unknown effects must be reconciled, not blindly retried."}
	}
	raw, e := json.Marshal(output)
	if e != nil {
		return harness.ToolResult{}, e
	}
	var readMeta json.RawMessage
	if read, ok := value.(reusableReadWindow); ok && operationErr == nil {
		readMeta = tool.ReusableReadMetadata(read.Path, read.Digest, string(raw))
	}
	if len(raw) > fstools.MaxOutputBytes {
		readMeta = nil
		// Read/list/search can have huge escaped names. This fallback never asserts
		// completion or discards a mutation receipt/shell status (bounded above).
		fallback := map[string]any{"truncated": true, "message": "Result exceeds encoded output budget; narrow the request. Do not infer mutation completion from this response."}
		if operationErr != nil {
			fallback["error"] = boundedText(operationErr.Error(), 1024)
		}
		raw, e = json.Marshal(fallback)
		if e != nil {
			return harness.ToolResult{}, e
		}
	}
	return harness.ToolResult{IsError: operationErr != nil, Meta: readMeta, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}}, nil
}
