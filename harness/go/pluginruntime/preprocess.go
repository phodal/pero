package pluginruntime

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/sandbox"
	"github.com/phodal/pero/harness/go/shell"
	"github.com/phodal/pero/harness/go/skills"
)

var ErrSkillCommandDenied = errors.New("plugin-runtime: skill command permission denied")

type ExpansionOptions struct {
	Shell       string
	Environment []string
	Sandbox     *sandbox.Config
}

type dynamicCommand struct {
	start, end int
	command    string
}

type preparedSkillCommand struct {
	before, command string
}

// ExpandSkill runs only placeholders selected from the original, explicitly
// loaded Claude definition. Neither user arguments nor command output can add
// another executable placeholder to this invocation.
func ExpandSkill(ctx context.Context, h *harness.Harness, agent *harness.Agent, definition skills.Definition, arguments string, options ExpansionOptions) (expandedDefinition skills.Definition, expansionErr error) {
	if !definition.Claude || definition.Rendered {
		return definition, nil
	}
	if ctx == nil {
		return skills.Definition{}, errors.New("plugin-runtime: skill expansion requires context")
	}
	if err := ctx.Err(); err != nil {
		return skills.Definition{}, err
	}
	commands, err := dynamicCommands(definition.Content)
	if err != nil {
		return skills.Definition{}, err
	}
	if len(commands) == 0 {
		return definition, nil
	}
	if h == nil || agent == nil {
		return skills.Definition{}, errors.New("plugin-runtime: executable skill context requires its harness and agent")
	}
	schemas, err := h.Tools().SchemasForAgent(ctx, agent)
	if err != nil {
		return skills.Definition{}, fmt.Errorf("plugin-runtime: resolve skill shell availability: %w", err)
	}
	shellAvailable := false
	for _, schema := range schemas {
		if schema.Name == "Bash" {
			shellAvailable = true
			break
		}
	}
	if !shellAvailable {
		return skills.Definition{}, fmt.Errorf("%w: Bash is unavailable to the invoking agent", ErrSkillCommandDenied)
	}
	project := agent.Session().Header().CWD
	if project == "" {
		project = agent.Session().WorkingDirectory()
	}
	plans, trailing, consumed, err := prepareSkillSource(definition, commands, arguments, string(agent.ID()), project)
	if err != nil {
		return skills.Definition{}, err
	}
	environment := append([]string{}, options.Environment...)
	pluginName, _, _ := strings.Cut(definition.Name, ":")
	if pluginName == "" {
		pluginName = definition.Name
	}
	dataDirectory, err := plugins.EnsurePluginDataDirectory(pluginName)
	if err != nil {
		return skills.Definition{}, err
	}
	environment = append(environment, "CLAUDE_PLUGIN_ROOT="+definition.ResourceBase, "CLAUDE_PLUGIN_DATA="+dataDirectory, "CLAUDE_PROJECT_DIR="+project, "CLAUDE_SESSION_ID="+string(agent.ID()))
	readback, err := shell.ResolveClaudeReadback(environment)
	if err != nil {
		return skills.Definition{}, fmt.Errorf("plugin-runtime: skill command output budget: %w", err)
	}
	shellPath, err := skillShell(options.Shell, definition.Shell)
	if err != nil {
		return skills.Definition{}, err
	}
	localOptions := shell.LocalOptions{Shell: shellPath, CWD: project, Sandbox: options.Sandbox, Timeout: 120 * time.Second, MaxTimeout: 120 * time.Second, MaxOutputBytes: skillCommandInlineBytes, BaseEnv: environment, TrustedBaseEnvironment: true}
	var outputs []*skillCommandOutput
	complete := false
	defer func() {
		for _, output := range outputs {
			if err := output.close(complete && output.spilled); err != nil {
				expandedDefinition = skills.Definition{}
				expansionErr = errors.Join(expansionErr, fmt.Errorf("plugin-runtime: close skill output: %w", err))
			}
		}
	}()
	var expanded strings.Builder
	for _, command := range plans {
		output := &skillCommandOutput{}
		localOptions.OutputSink = output
		executor, err := shell.NewLocalExecutor(localOptions)
		if err != nil {
			return skills.Definition{}, fmt.Errorf("plugin-runtime: prepare skill shell: %w", err)
		}
		spec, err := executor.Resolve(shell.ExecRequest{Command: command.command, Workdir: agent.Session().WorkingDirectory()})
		if err != nil {
			return skills.Definition{}, fmt.Errorf("plugin-runtime: resolve skill command: %w", err)
		}
		toolArguments, err := json.Marshal(struct {
			Command string `json:"command"`
		}{Command: spec.Command})
		if err != nil {
			return skills.Definition{}, err
		}
		outcome, err := h.Approvals().Request(ctx, harness.ApprovalRequest{Agent: agent, CallID: harness.ToolCallID("skill-preprocess-" + rand.Text()), ToolName: "Bash", Reason: spec.Command, NonInteractive: true, Preapproved: skills.AllowsTool(definition.AllowedTools, "Bash", toolArguments)})
		if err != nil {
			return skills.Definition{}, err
		}
		if err := agent.Session().Flush(ctx); err != nil {
			return skills.Definition{}, fmt.Errorf("plugin-runtime: persist skill command permission: %w", err)
		}
		if outcome != harness.ApprovalAllowedOnce {
			if err := ctx.Err(); err != nil {
				return skills.Definition{}, err
			}
			return skills.Definition{}, fmt.Errorf("%w: %s", ErrSkillCommandDenied, outcome)
		}
		if err := ctx.Err(); err != nil {
			return skills.Definition{}, err
		}
		if err := executor.CheckCWD(agent.Session().WorkingDirectory()); err != nil {
			return skills.Definition{}, err
		}
		if err := output.open(project); err != nil {
			return skills.Definition{}, err
		}
		outputs = append(outputs, output)
		result, err := executor.Run(ctx, spec)
		if err != nil {
			return skills.Definition{}, fmt.Errorf("plugin-runtime: skill command failed: %w", err)
		}
		success := shell.ClaudeCommandSucceeded(spec.Command, result.ExitCode)
		text, err := output.projection(success, readback)
		if err != nil {
			return skills.Definition{}, fmt.Errorf("plugin-runtime: read skill command output: %w", err)
		}
		if !success {
			code := "no exit code"
			if result.ExitCode != nil {
				code = fmt.Sprintf("exit %d", *result.ExitCode)
			}
			return skills.Definition{}, fmt.Errorf("plugin-runtime: skill command failed (%s): %s", code, text)
		}
		expanded.WriteString(command.before)
		expanded.WriteString(text)
	}
	expanded.WriteString(trailing)
	if !consumed && arguments != "" {
		expanded.WriteString("\n\nARGUMENTS: " + arguments)
	}
	definition.Content = expanded.String()
	definition.Rendered = true
	complete = true
	return definition, nil
}

func prepareSkillSource(definition skills.Definition, commands []dynamicCommand, arguments, sessionID, project string) ([]preparedSkillCommand, string, bool, error) {
	var plans []preparedSkillCommand
	previous, consumed := 0, false
	for _, command := range commands {
		fragment := definition
		fragment.Content = definition.Content[previous:command.start]
		before, usedBefore, err := skills.RenderInvocationFragment(fragment, arguments, sessionID, project)
		if err != nil {
			return nil, "", false, err
		}
		fragment.Content = command.command
		rendered, usedCommand, err := skills.RenderInvocationFragment(fragment, arguments, sessionID, project)
		if err != nil {
			return nil, "", false, err
		}
		plans = append(plans, preparedSkillCommand{before: before.Content, command: rendered.Content})
		consumed = consumed || usedBefore || usedCommand
		previous = command.end
	}
	fragment := definition
	fragment.Content = definition.Content[previous:]
	after, usedAfter, err := skills.RenderInvocationFragment(fragment, arguments, sessionID, project)
	return plans, after.Content, consumed || usedAfter, err
}

func skillShell(host, requested string) (string, error) {
	switch requested {
	case "", "bash":
		return host, nil
	case "powershell":
		for _, name := range []string{"pwsh", "powershell"} {
			found, err := exec.LookPath(name)
			if err != nil {
				continue
			}
			absolute, err := filepath.Abs(found)
			if err != nil {
				return "", err
			}
			return absolute, nil
		}
		return "", errors.New("plugin-runtime: skill shell powershell was not found")
	default:
		return "", fmt.Errorf("plugin-runtime: skill shell %q must be bash or powershell", requested)
	}
}

// dynamicCommands selects spans before any parameter or output substitution.
// Inline placeholders must begin at a whitespace boundary and stay on one line.
func dynamicCommands(source string) ([]dynamicCommand, error) {
	var commands []dynamicCommand
	for position := 0; position < len(source); {
		if position == 0 || source[position-1] == '\n' {
			lineEnd := strings.IndexByte(source[position:], '\n')
			if lineEnd < 0 {
				lineEnd = len(source)
			} else {
				lineEnd += position
			}
			line := strings.TrimSuffix(source[position:lineEnd], "\r")
			trimmed := strings.TrimLeft(line, " ")
			if len(line)-len(trimmed) <= 3 && strings.TrimRight(trimmed, " \t") == "```!" {
				bodyStart := lineEnd
				if bodyStart < len(source) {
					bodyStart++
				}
				closingStart, closingEnd := -1, -1
				for cursor := bodyStart; cursor < len(source); {
					end := strings.IndexByte(source[cursor:], '\n')
					if end < 0 {
						end = len(source)
					} else {
						end += cursor
					}
					closing := strings.TrimSpace(source[cursor:end])
					if len(closing) >= 3 && strings.Trim(closing, "`") == "" {
						closingStart, closingEnd = cursor, end
						break
					}
					cursor = end + 1
				}
				if closingStart < 0 {
					return nil, errors.New("plugin-runtime: dynamic skill command fence is not closed")
				}
				command := source[bodyStart:closingStart]
				if strings.TrimSpace(command) == "" {
					return nil, errors.New("plugin-runtime: dynamic skill command is empty")
				}
				commands = append(commands, dynamicCommand{start: position, end: closingEnd, command: command})
				position = closingEnd
				continue
			}
		}
		if source[position] != '!' || position+1 >= len(source) || source[position+1] != '`' {
			position++
			continue
		}
		if position > 0 {
			previous, _ := utf8.DecodeLastRuneInString(source[:position])
			if !unicode.IsSpace(previous) {
				position++
				continue
			}
		}
		end := position + 2
		for end < len(source) && source[end] != '`' && source[end] != '\n' && source[end] != '\r' {
			end++
		}
		if end == len(source) || source[end] != '`' {
			position++
			continue
		}
		command := source[position+2 : end]
		if strings.TrimSpace(command) == "" {
			return nil, errors.New("plugin-runtime: dynamic skill command is empty")
		}
		commands = append(commands, dynamicCommand{start: position, end: end + 1, command: command})
		position = end + 1
	}
	return commands, nil
}
