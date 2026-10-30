// pero-agent-connect starts the fixed ACP executable only after Run admission.
package main

import (
	"context"
	"flag"
	"fmt"
	"github.com/phodal/pero/server/internal/remoteacp"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	c := remoteacp.AgentConfig{Channel: remoteacp.Channel{ControlURL: os.Getenv("PERO_AGENT_CONTROL_URL"), RunID: os.Getenv("PERO_AGENT_RUN_ID"), SessionID: os.Getenv("PERO_AGENT_SESSION_ID"), CAFile: os.Getenv("PERO_AGENT_CA_FILE")}, TokenFile: os.Getenv("PERO_AGENT_TOKEN_FILE"), Workspace: os.Getenv("PERO_AGENT_WORKSPACE"), Model: os.Getenv("PERO_AGENT_MODEL"), Executable: "/usr/local/bin/pero-agent-acp", SessionDir: "/workspace/.pero-sessions"}
	flag.StringVar(&c.Channel.ControlURL, "control-url", c.Channel.ControlURL, "fixed control-plane origin")
	flag.StringVar(&c.Channel.RunID, "run-id", c.Channel.RunID, "Run ID")
	flag.StringVar(&c.Channel.SessionID, "session-id", c.Channel.SessionID, "fixed channel session")
	flag.StringVar(&c.Channel.CAFile, "ca-file", c.Channel.CAFile, "explicit control-plane CA")
	flag.StringVar(&c.TokenFile, "token-file", c.TokenFile, "projected Pod-bound token")
	flag.StringVar(&c.Workspace, "workspace", c.Workspace, "prepared remote workspace")
	flag.StringVar(&c.Executable, "agent", c.Executable, "operator-fixed executable")
	flag.StringVar(&c.Model, "model", c.Model, "fixed provider model")
	flag.StringVar(&c.SessionDir, "session-dir", c.SessionDir, "private Agent session directory")
	flag.Parse()
	c.Args = flag.Args()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := remoteacp.Connect(ctx, c); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
