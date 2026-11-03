package main

import (
	"context"
	"flag"
	"os"
	"path/filepath"
	"testing"

	"github.com/phodal/pero/harness/go/engineeringprofile"
	"github.com/phodal/pero/harness/go/harness"
)

func TestEngineeringProfileExplicitLaunchConfiguration(t *testing.T) {
	flags := flag.NewFlagSet("engineering", flag.ContinueOnError)
	options := bindEngineeringOptions(flags)
	if err := flags.Parse(nil); err != nil {
		t.Fatal(err)
	}
	if launch, err := options.config(); err != nil || launch != nil {
		t.Fatal("engineering profile enabled implicitly", err)
	}
	path := filepath.Join(t.TempDir(), "contract.json")
	for _, test := range []struct {
		name, mode, body string
		valid            bool
	}{
		{"observe", "observe", `{"id":"diagnose","kind":"diagnose","goal":"Explain the failure"}`, true},
		{"feedback", "feedback", `{"id":"fix","revision":2,"kind":"change","goal":"Fix the failure","checks":[{"id":"target","tool":"shell","command":"go test ./target","required":true,"files":["go.mod"]}]}`, true},
		{"disabled contract", "off", `{}`, false},
		{"unknown mode", "automatic", `{}`, false},
		{"unknown field", "observe", `{"id":"diagnose","kind":"diagnose","goal":"Explain","newAuthority":true}`, false},
		{"invalid domain", "observe", `{"kind":"diagnose","goal":"Explain"}`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(test.body), 0600); err != nil {
				t.Fatal(err)
			}
			launch, err := (engineeringOptions{Mode: test.mode, ContractFile: path}).config()
			if (err == nil) != test.valid {
				t.Fatalf("valid=%v err=%v", test.valid, err)
			}
			if test.valid && (launch.contract == nil || launch.contract.Revision < 1) {
				t.Fatal("missing validated launch contract")
			}
		})
	}
}

func TestEngineeringContractBindsOnlyNewSessionFirstHumanPrompt(t *testing.T) {
	ctx := t.Context()
	var first *harness.Agent
	bound := false
	h, err := harness.Boot(ctx, harness.Options{Adapter: harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if request.Agent == first {
			contract, found, err := engineeringprofile.Current(first.Session())
			if err != nil {
				return harness.Completion{}, err
			}
			bound = found && contract.ID == "diagnose" && contract.MessageID == "first-message"
		}
		return harness.Completion{Finish: harness.FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
	launch := &engineeringLaunch{mode: engineeringprofile.Observe, contract: &engineeringprofile.Contract{ID: "diagnose", Revision: 1, Kind: "diagnose", Goal: "Explain the failure"}}
	app, err := launch.mount(ctx, h)
	if err != nil {
		t.Fatal(err)
	}
	prepare := launch.preparePrompt(app)
	first, err = h.Agents().Create(ctx, harness.AgentOptions{ID: "new-session", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	message := harness.Message{ID: "first-message", Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Explain the failure"}}}
	cleanup, err := prepare(ctx, first, &message)
	if err != nil || cleanup == nil {
		t.Fatal("launch contract was not staged", err)
	}
	if _, err := first.Prompt(ctx, message); err != nil {
		t.Fatal(err)
	}
	cleanup()
	if !bound {
		t.Fatal("contract was not active at the first provider request")
	}
	message.ID = "next-message"
	if cleanup, err := prepare(ctx, first, &message); err != nil || cleanup != nil {
		t.Fatal("existing contract was rebound", err)
	}
	previous, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "previous-session", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := previous.Prompt(ctx, message); err != nil {
		t.Fatal(err)
	}
	message.ID = "resume-message"
	if cleanup, err := prepare(ctx, previous, &message); err != nil || cleanup != nil {
		t.Fatal("historical human session received a new launch contract", err)
	}
}
