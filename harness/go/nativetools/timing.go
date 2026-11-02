package nativetools

import (
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type BashHostMode string

const (
	BashUnattended  BashHostMode = "unattended"
	BashInteractive BashHostMode = "interactive"
)

// BashTimingOptions is trusted host composition, never a model parameter.
// An omitted mode means unattended; the caller explicitly chooses interactive.
type BashTimingOptions struct {
	HostMode          BashHostMode
	DisableBackground bool
	Bare              bool
}

type bashTimingPolicy struct {
	mode                                 BashHostMode
	disabled                             bool
	foregroundDefault, foregroundMaximum time.Duration
	backgroundDefault, backgroundMaximum time.Duration
}

type bashTimingSelection struct {
	wait, runtime, resolveTimeout time.Duration
	promote, noDeadline           bool
}

func resolveBashTimingPolicy(options BashTimingOptions, environment []string) (bashTimingPolicy, error) {
	mode := options.HostMode
	if mode == "" {
		mode = BashUnattended
	}
	if mode != BashUnattended && mode != BashInteractive {
		return bashTimingPolicy{}, errors.New("Bash host mode must be unattended or interactive")
	}
	var defaultValue, maximumValue string
	disabled := options.DisableBackground || options.Bare
	for _, entry := range environment {
		name, value, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		switch name {
		case "BASH_DEFAULT_TIMEOUT_MS":
			defaultValue = value
		case "BASH_MAX_TIMEOUT_MS":
			maximumValue = value
		case "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS":
			disabled = options.DisableBackground || options.Bare || value == "1"
		}
	}
	parse := func(value, name string) (time.Duration, error) {
		if value == "" {
			return 0, nil
		}
		milliseconds, err := strconv.ParseInt(value, 10, 64)
		if err != nil || milliseconds < 0 || milliseconds > math.MaxInt64/int64(time.Millisecond) {
			return 0, fmt.Errorf("%s is outside the supported millisecond range", name)
		}
		return time.Duration(milliseconds) * time.Millisecond, nil
	}
	defaultTimeout, err := parse(defaultValue, "BASH_DEFAULT_TIMEOUT_MS")
	if err != nil {
		return bashTimingPolicy{}, err
	}
	maximumTimeout, err := parse(maximumValue, "BASH_MAX_TIMEOUT_MS")
	if err != nil {
		return bashTimingPolicy{}, err
	}
	foregroundDefault := max(120*time.Second, defaultTimeout)
	backgroundDefault := max(backgroundShellDefault, defaultTimeout)
	return bashTimingPolicy{mode, disabled, foregroundDefault, max(600*time.Second, foregroundDefault, maximumTimeout),
		backgroundDefault, max(backgroundShellMaximum, backgroundDefault, maximumTimeout)}, nil
}

func (policy bashTimingPolicy) selectTimeout(command string, milliseconds int, background bool) (bashTimingSelection, error) {
	if milliseconds < 0 || int64(milliseconds) > math.MaxInt64/int64(time.Millisecond) {
		return bashTimingSelection{}, errors.New("Bash timeout is outside the supported millisecond range")
	}
	requested := time.Duration(milliseconds) * time.Millisecond
	if background {
		if policy.disabled {
			return bashTimingSelection{}, errors.New("Bash background execution is disabled by the host")
		}
		if policy.mode == BashInteractive {
			return bashTimingSelection{resolveTimeout: policy.backgroundDefault, noDeadline: true}, nil
		}
		if requested == 0 {
			requested = policy.backgroundDefault
		}
		runtime := min(requested, policy.backgroundMaximum)
		return bashTimingSelection{runtime: runtime, resolveTimeout: runtime}, nil
	}
	if requested == 0 {
		requested = policy.foregroundDefault
	}
	wait := min(requested, policy.foregroundMaximum)
	promote := !policy.disabled && !commandStartsWithSleep(command)
	return bashTimingSelection{wait: wait, runtime: wait, resolveTimeout: wait, promote: promote}, nil
}

func commandStartsWithSleep(command string) bool {
	command = strings.TrimLeft(command, " \t\r\n")
	end := strings.IndexAny(command, " \t\r\n;&|<>()")
	if end >= 0 {
		command = command[:end]
	}
	return filepath.Base(command) == "sleep"
}
