// pero-acp-bridge is a trusted Worker-side stdio adapter for one admitted Run.
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
	var c remoteacp.Channel
	var cwd string
	flag.StringVar(&c.ControlURL, "control-url", "", "fixed control-plane origin")
	flag.StringVar(&c.RunID, "run-id", "", "Run ID")
	flag.StringVar(&c.SessionID, "session-id", "", "fixed channel session")
	flag.StringVar(&c.CAFile, "ca-file", "", "explicit control-plane CA")
	flag.StringVar(&cwd, "working-directory", "", "remote workspace")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	secret := os.Getenv("PERO_REMOTE_CHANNEL_SECRET")
	os.Unsetenv("PERO_REMOTE_CHANNEL_SECRET")
	if flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "unexpected bridge arguments")
		os.Exit(1)
	}
	if err := remoteacp.Bridge(ctx, c, secret, cwd, os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
