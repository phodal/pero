package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/pluginruntime"
)

func runPrint(ctx context.Context, h *harness.Harness, hooks *pluginruntime.HookApp, model, workspace, prompt string) error {
	return runPrintPrepared(ctx, h, hooks, model, workspace, prompt, nil)
}

func runPrintPrepared(ctx context.Context, h *harness.Harness, hooks *pluginruntime.HookApp, model, workspace, prompt string, prepare func(context.Context, *harness.Agent, *harness.Message) (func(), error)) error {
	agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "print", CWD: workspace, Provider: "configured", Model: model})
	if err != nil {
		return err
	}
	var initial string
	if hooks != nil {
		initial, err = hooks.Startup(ctx, agent)
		if err != nil {
			return err
		}
	}
	type printTurn struct {
		text  string
		human bool
	}
	var turns []printTurn
	if strings.TrimSpace(initial) != "" {
		turns = append(turns, printTurn{text: strings.TrimSpace(initial)})
	}
	if strings.TrimSpace(prompt) != "" {
		turns = append(turns, printTurn{text: strings.TrimSpace(prompt), human: true})
	}
	if len(turns) == 0 {
		return fmt.Errorf("--print requires a prompt or a SessionStart initialUserMessage")
	}
	for _, turn := range turns {
		message := harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: turn.text}}}
		var cleanup func()
		if turn.human && prepare != nil {
			var id [16]byte
			if _, err := rand.Read(id[:]); err != nil {
				return err
			}
			message.ID = hex.EncodeToString(id[:])
			cleanup, err = prepare(ctx, agent, &message)
		}
		if err == nil {
			if turn.human {
				_, err = agent.Prompt(ctx, message)
			} else {
				var outcome <-chan harness.TurnOutcome
				outcome, err = agent.FollowupResultContext(ctx, message)
				if err == nil {
					select {
					case settled := <-outcome:
						err = settled.Err
					case <-ctx.Done():
						// Accepted plugin turns outlive their admission context.
						err = errors.Join(ctx.Err(), agent.CancelDSH(context.WithoutCancel(ctx), ctx.Err(), false))
					}
				}
			}
			if ctx.Err() != nil {
				err = errors.Join(err, ctx.Err(), agent.WhenIdle(context.WithoutCancel(ctx)))
			}
		}
		if cleanup != nil {
			cleanup()
		}
		if err != nil {
			return err
		}
		fmt.Fprintln(os.Stdout, lastAssistantText(agent))
	}
	return nil
}

func writeControllingTerminal(sequence string) {
	if sequence == "" {
		return
	}
	file, err := os.OpenFile("/dev/tty", os.O_WRONLY, 0)
	if err != nil {
		info, statErr := os.Stderr.Stat()
		if statErr == nil && info.Mode()&os.ModeCharDevice != 0 {
			_, _ = io.WriteString(os.Stderr, sequence)
		}
		return
	}
	defer file.Close()
	_, _ = io.WriteString(file, sequence)
}

func lastAssistantText(agent *harness.Agent) string {
	messages, err := agent.Session().DeriveMessages()
	if err != nil {
		return ""
	}
	var text string
	for _, message := range messages {
		if message.Role != harness.RoleAssistant {
			continue
		}
		var parts []string
		for _, block := range message.Content {
			if block.Type == harness.BlockText && block.Text != "" {
				parts = append(parts, block.Text)
			}
		}
		if len(parts) > 0 {
			text = strings.Join(parts, "")
		}
	}
	return text
}
