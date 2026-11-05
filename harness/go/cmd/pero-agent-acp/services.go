package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"os"
	"runtime"

	"github.com/phodal/pero/harness/go/environmentservice"
	"github.com/phodal/pero/harness/go/harness"
)

func mountEnvironmentServices(ctx context.Context, h *harness.Harness, directory, workspace, shellPath string, environment []string, check func(string) error) error {
	if directory == "" {
		return nil
	}
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		return errors.New("environment service supervision currently requires Unix")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	return environmentservice.Mount(ctx, h, environmentservice.Options{Directory: directory, Workspace: workspace, Shell: shellPath, Environment: environment, HelperCommand: []string{executable, "service-host"}}, check)
}

func runServices(args []string) error {
	if len(args) == 0 || args[0] != "status" && args[0] != "stop" {
		return errors.New("services requires status or stop")
	}
	flags := flag.NewFlagSet("services", flag.ContinueOnError)
	dir := flags.String("dir", "", "explicit environment service directory")
	id := flags.String("id", "", "exact service identity")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected services arguments")
	}
	var receipt environmentservice.Receipt
	var err error
	if args[0] == "stop" {
		receipt, err = environmentservice.Stop(*dir, *id)
	} else {
		receipt, err = environmentservice.Status(*dir, *id)
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(receipt)
}
