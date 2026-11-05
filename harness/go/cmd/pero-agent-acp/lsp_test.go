package main

import (
	"context"
	"flag"
	"testing"

	"github.com/phodal/pero/harness/go/lsp"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestLSPSelectionFollowsExplicitOperatorAndPluginGrants(t *testing.T) {
	options := bindLSPOptions(flag.NewFlagSet("lsp-test", flag.ContinueOnError))
	if app, err := mountLSP(context.Background(), nil, "", nil, nil, *options); app != nil || err != nil {
		t.Fatal("unselected LSP must remain absent")
	}
	packages := []plugins.Package{{LSP: []lsp.Server{{Name: "bundled"}}}}
	if _, err := mountLSP(context.Background(), nil, "", packages, nil, *options); err == nil {
		t.Fatal("selected bundled LSP failed to require workspace authority")
	}
	options.DisablePluginServers = true
	if app, err := mountLSP(context.Background(), nil, "", packages, nil, *options); app != nil || err != nil {
		t.Fatal("disabled bundled servers must not be prepared or started")
	}
	options.Files = []string{"unread-config"}
	if _, err := mountLSP(context.Background(), nil, "", packages, nil, *options); err == nil {
		t.Fatal("operator LSP config failed to require workspace authority")
	}
}
