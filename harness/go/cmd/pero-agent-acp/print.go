package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/pluginruntime"
)

func runPrint(ctx context.Context, h *harness.Harness, hooks *pluginruntime.HookApp, model, workspace, prompt string) error {
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
	var turns []string
	if strings.TrimSpace(initial) != "" {
		turns = append(turns, strings.TrimSpace(initial))
	}
	if strings.TrimSpace(prompt) != "" {
		turns = append(turns, strings.TrimSpace(prompt))
	}
	if len(turns) == 0 {
		return fmt.Errorf("--print requires a prompt or a SessionStart initialUserMessage")
	}
	for _, text := range turns {
		if _, err := agent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}); err != nil {
			return err
		}
		fmt.Fprintln(os.Stdout, lastAssistantText(agent))
	}
	return nil
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
