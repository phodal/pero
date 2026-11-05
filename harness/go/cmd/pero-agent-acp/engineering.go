package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/phodal/pero/harness/go/engineeringprofile"
	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type engineeringOptions struct{ Mode, ContractFile string }

type engineeringLaunch struct {
	mode     engineeringprofile.Mode
	contract *engineeringprofile.Contract
}

func bindEngineeringOptions(flags *flag.FlagSet) *engineeringOptions {
	options := &engineeringOptions{}
	flags.StringVar(&options.Mode, "engineering-profile", "off", "engineering guidance and verification: off, observe, or feedback; never grants tools")
	flags.StringVar(&options.ContractFile, "engineering-contract", "", "trusted JSON WorkContract for each new session's first human prompt; requires engineering-profile")
	return options
}

func (options engineeringOptions) config() (*engineeringLaunch, error) {
	if options.Mode == "off" {
		if options.ContractFile != "" {
			return nil, errors.New("--engineering-contract requires --engineering-profile observe or feedback")
		}
		return nil, nil
	}
	if options.Mode != string(engineeringprofile.Observe) && options.Mode != string(engineeringprofile.Feedback) {
		return nil, errors.New("--engineering-profile must be off, observe, or feedback")
	}
	launch := &engineeringLaunch{mode: engineeringprofile.Mode(options.Mode)}
	if options.ContractFile == "" {
		return launch, nil
	}
	file, err := os.Open(options.ContractFile)
	if err != nil {
		return nil, fmt.Errorf("engineering contract: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	const maxBytes = 64 << 10
	if !info.Mode().IsRegular() || info.Size() > maxBytes {
		return nil, errors.New("engineering contract must be a regular JSON file of at most 65536 bytes")
	}
	raw, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxBytes {
		return nil, errors.New("engineering contract exceeds 65536 bytes")
	}
	contract, err := point.DecodeJSON[engineeringprofile.Contract](raw)
	if err != nil {
		return nil, fmt.Errorf("engineering contract: %w", err)
	}
	if contract.Revision == 0 {
		contract.Revision = 1
	}
	if err := contract.Validate(); err != nil {
		return nil, err
	}
	launch.contract = &contract
	return launch, nil
}

func (launch *engineeringLaunch) mount(ctx context.Context, h *harness.Harness) (*engineeringprofile.App, error) {
	if launch == nil {
		return nil, nil
	}
	return engineeringprofile.Mount(ctx, h, engineeringprofile.Options{Mode: launch.mode})
}

// preparePrompt applies only explicit launch configuration. Natural-language
// ACP input and model-written task metadata never manufacture a WorkContract.
func (launch *engineeringLaunch) preparePrompt(app *engineeringprofile.App) func(context.Context, *harness.Agent, *harness.Message) (func(), error) {
	if launch == nil || launch.contract == nil || app == nil {
		return nil
	}
	return func(_ context.Context, agent *harness.Agent, message *harness.Message) (func(), error) {
		if _, found, err := engineeringprofile.Current(agent.Session()); err != nil || found {
			return nil, err
		}
		for _, event := range agent.Session().Events() {
			if event.Type != "turn/start" {
				continue
			}
			var start struct {
				Source harness.TurnSource `json:"source"`
			}
			if err := json.Unmarshal(event.Data, &start); err != nil {
				return nil, err
			}
			if start.Source == harness.TurnSourceHuman {
				return nil, nil
			}
		}
		contract := *launch.contract
		contract.MessageID = message.ID
		if err := app.StageContract(agent, contract); err != nil {
			return nil, err
		}
		return func() { app.DiscardContract(agent, message.ID) }, nil
	}
}
