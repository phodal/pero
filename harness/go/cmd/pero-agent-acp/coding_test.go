package main

import (
	"context"
	"flag"
	"testing"
)

func TestCodingExplicitOptIn(t *testing.T) {
	flags := flag.NewFlagSet("test", flag.ContinueOnError)
	opts := bindCodingOptions(flags)
	if err := flags.Parse(nil); err != nil {
		t.Fatal(err)
	}
	if opts.AgentInstructions || opts.HierarchicalInstructions || opts.Todos {
		t.Fatal("implicit coding feature")
	}
	if app, err := mountCoding(context.Background(), nil, "", *opts); err != nil || app != nil {
		t.Fatal("disabled feature mounted")
	}
	if err := flags.Parse([]string{"--enable-agent-instructions", "--enable-hierarchical-instructions", "--enable-todos"}); err != nil {
		t.Fatal(err)
	}
	if !opts.Todos || !opts.AgentInstructions || !opts.HierarchicalInstructions || opts.validate("") == nil || opts.validate("/explicit") != nil {
		t.Fatal("invalid opt in")
	}
	if _, err := mountCoding(context.Background(), nil, "", *opts); err == nil {
		t.Fatal("missing workspace accepted")
	}
}
