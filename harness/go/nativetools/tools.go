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
)

type Options struct {
	Sandbox             *sandbox.Config
	Workspace           string
	EnableShell         bool
	EnableResearchClone bool
	Shell               string
	ClaudeTools         bool
	ReadOnlyResource    func(context.Context, string) (fstools.ScopedText, error)
	PluginEnvironment   []string
	BashOutput          BashOutputOptions
	BashTiming          BashTimingOptions
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
		return a.files.CheckCWD(cwd)
	}
	if a.shell != nil {
		return a.shell.CheckCWD(cwd)
	}
	return errors.New("native workspace is unavailable")
}

type arguments struct {
	Path                                           string `json:"path"`
	Content                                        string `json:"content"`
	OldText                                        string `json:"old_text"`
	NewText                                        string `json:"new_text"`
	ReplaceAll                                     bool   `json:"replace_all"`
	Query                                          string `json:"query"`
	Offset                                         int    `json:"offset"`
	Limit                                          int    `json:"limit"`
	Command                                        string `json:"command"`
	TimeoutMS                                      int    `json:"timeout_ms"`
	Pattern                                        string
	Glob                                           string
	FileType                                       string
	OutputMode                                     string
	IgnoreCase                                     bool
	Multiline                                      bool
	LineNumbers                                    *bool
	Before, After, Around, HeadLimit, SearchOffset int
	ResourcePath                                   string
	RunInBackground                                bool
	Description                                    string
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
	defer func() {
		if resultErr != nil && files != nil {
			_ = app.Close()
		}
	}()
	var shellAdmission func(context.Context, harness.ToolRequest) (*harness.NativeApprovalDescriptor, error)
	definitions := []toolDefinition{
		{"read_file", "Read bounded UTF-8 text from an existing workspace-relative file. offset is a 1-based line number.", `"path":{"type":"string"},"offset":{"type":"integer","minimum":1},"limit":{"type":"integer","minimum":1,"maximum":2000}`, `"path"`, false, func(c context.Context, a arguments) (any, error) {
			v, e := files.Read(c, a.Path)
			if e != nil {
				return nil, e
			}
			return fstools.FormatRead(v, a.Offset, a.Limit)
		}},
		{"write_file", "Create or replace a bounded UTF-8 file under the configured workspace. Parent directory must already exist. Requires approval.", `"path":{"type":"string"},"content":{"type":"string","maxLength":1048576}`, `"path","content"`, true, func(c context.Context, a arguments) (any, error) { return files.Write(c, a.Path, a.Content) }},
		{"edit_file", "Replace exact text in an existing workspace file; old_text must match once unless replace_all. Requires approval.", `"path":{"type":"string"},"old_text":{"type":"string","minLength":1,"maxLength":1048576},"new_text":{"type":"string","maxLength":1048576},"replace_all":{"type":"boolean"}`, `"path","old_text","new_text"`, true, func(c context.Context, a arguments) (any, error) {
			return files.Edit(c, a.Path, a.OldText, a.NewText, a.ReplaceAll)
		}},
		{"list_directory", "List up to 256 direct workspace directory entries; does not follow symlinks.", `"path":{"type":"string"}`, ``, false, func(c context.Context, a arguments) (any, error) { return files.List(c, a.Path) }},
		{"search_files", "Find literal query text in bounded workspace files. At most 512 entries, 8 MiB text and 64 matches; symlinks skipped.", `"path":{"type":"string"},"query":{"type":"string","minLength":1,"maxLength":4096}`, `"query"`, false, func(c context.Context, a arguments) (any, error) { return files.Search(c, a.Path, a.Query) }},
	}
	if opts.EnableShell || opts.EnableResearchClone {
		if opts.Shell == "" {
			if windowsShell {
				return nil, errors.New("Windows shell requires an explicit absolute --shell path to pwsh.exe")
			}
			opts.Shell = "/bin/bash"
		}
		shellOptions := shell.LocalOptions{Sandbox: opts.Sandbox, Shell: opts.Shell, CWD: workspace, Timeout: 30 * time.Second, MaxTimeout: 120 * time.Second, MaxOutputBytes: 16 << 10, Grace: 200 * time.Millisecond, BaseEnv: []string{"PATH=/usr/bin:/bin", "LANG=C.UTF-8"}}
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
				app.background, err = mountShellTasks(ctx, h, shellOptions, policy, timing)
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
					if opts.ClaudeTools && app.background != nil {
						selection, timingErr := app.background.timingPolicy.selectTimeout(a.Command, a.TimeoutMS, a.RunInBackground)
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
					if _, err := admissionExecutor.Resolve(shell.ExecRequest{Command: a.Command, Workdir: workspace, Timeout: selectedTimeout}); err != nil {
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
				if e := app.CheckCWD(workspace); e != nil {
					return nil, e
				}
				spec, e := executor.Resolve(shell.ExecRequest{Command: a.Command, Workdir: workspace, Timeout: time.Duration(a.TimeoutMS) * time.Millisecond})
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
		if opts.Sandbox != nil && opts.Sandbox.Mode == sandbox.ReadOnly && (d.name == "write_file" || d.name == "edit_file") {
			continue
		}
		if !files.SupportsReplacement() {
			if d.name == "edit_file" {
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
			if e := app.CheckCWD(request.Agent.Session().WorkingDirectory()); e != nil {
				return harness.ToolResult{}, e
			}
			a, e := decodeNativeArguments(request.Arguments, workspace, opts.ClaudeTools, d.name == "Read" && opts.ReadOnlyResource != nil, opts.Workspace)
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
	if len(raw) > fstools.MaxOutputBytes {
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
	return harness.ToolResult{IsError: operationErr != nil, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}}, nil
}
