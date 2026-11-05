package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
)

// ModelProfile supplies explicit defaults for one model, with no routing,
// endpoint, credential, tool authority or task deadline configuration.
type ModelProfile struct {
	Version  int                  `json:"version"`
	ID       string               `json:"id"`
	Model    string               `json:"model"`
	Settings ModelProfileSettings `json:"settings"`
}
type ModelProfileSettings struct {
	ToolFormat        *string  `json:"tool_format,omitempty"`
	APIFormat         *string  `json:"api_format,omitempty"`
	DisableStreaming  *bool    `json:"disable_streaming,omitempty"`
	DisableThinking   *bool    `json:"disable_thinking,omitempty"`
	ReasoningEffort   *string  `json:"reasoning_effort,omitempty"`
	MaxTokens         *int     `json:"max_output_tokens,omitempty"`
	ContextWindow     *int     `json:"context_window,omitempty"`
	DisableCompaction *bool    `json:"disable_compaction,omitempty"`
	TriggerTokens     *int     `json:"compaction_trigger_tokens,omitempty"`
	RetainTokens      *int     `json:"compaction_retain_tokens,omitempty"`
	SummaryTokens     *int     `json:"compaction_summary_tokens,omitempty"`
	Threshold         *float64 `json:"compaction_threshold,omitempty"`
	RetainRatio       *float64 `json:"compaction_retain_ratio,omitempty"`
}
type modelProfileIdentity struct {
	ID     string `json:"id"`
	SHA256 string `json:"sha256"`
}

func loadModelProfile(path string, flags *flag.FlagSet) (*modelProfileIdentity, error) {
	if path == "" {
		return nil, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, errors.New("model profile could not be opened")
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, 65537))
	if err != nil || len(raw) > 65536 {
		return nil, errors.New("model profile must be readable and at most 64 KiB")
	}
	var profile ModelProfile
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&profile); err != nil {
		return nil, fmt.Errorf("invalid model profile: %w", err)
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, errors.New("model profile must contain exactly one JSON object")
	}
	if profile.Version != 1 || strings.TrimSpace(profile.ID) == "" || len(profile.ID) > 128 || strings.TrimSpace(profile.Model) == "" || len(profile.Model) > 256 || strings.ContainsAny(profile.ID+profile.Model, "\r\n\x00") {
		return nil, errors.New("model profile requires version 1 and bounded id/model identifiers")
	}
	model := flags.Lookup("model")
	if model == nil {
		return nil, errors.New("model profile requires a model flag")
	}
	if model.Value.String() != "" && model.Value.String() != profile.Model {
		return nil, errors.New("model profile model does not match --model")
	}
	if err = flags.Set("model", profile.Model); err != nil {
		return nil, err
	}
	explicit := make(map[string]bool)
	flags.Visit(func(f *flag.Flag) { explicit[f.Name] = true })
	s := profile.Settings
	for _, err := range []error{
		profileDefault(flags, explicit, "tool-format", s.ToolFormat),
		profileDefault(flags, explicit, "api-format", s.APIFormat),
		profileDefault(flags, explicit, "disable-streaming", s.DisableStreaming),
		profileDefault(flags, explicit, "disable-thinking", s.DisableThinking),
		profileDefault(flags, explicit, "reasoning-effort", s.ReasoningEffort),
		profileDefault(flags, explicit, "max-tokens", s.MaxTokens),
		profileDefault(flags, explicit, "context-window", s.ContextWindow),
		profileDefault(flags, explicit, "disable-compaction", s.DisableCompaction),
		profileDefault(flags, explicit, "compaction-trigger-tokens", s.TriggerTokens),
		profileDefault(flags, explicit, "compaction-retain-tokens", s.RetainTokens),
		profileDefault(flags, explicit, "compaction-summary-tokens", s.SummaryTokens),
		profileDefault(flags, explicit, "compaction-threshold", s.Threshold),
		profileDefault(flags, explicit, "compaction-retain-ratio", s.RetainRatio),
	} {
		if err != nil {
			return nil, err
		}
	}
	hash := sha256.Sum256(raw)
	return &modelProfileIdentity{profile.ID, hex.EncodeToString(hash[:])}, nil
}

func profileDefault[T string | bool | int | float64](flags *flag.FlagSet, explicit map[string]bool, name string, value *T) error {
	if value == nil || explicit[name] {
		return nil
	}
	return flags.Set(name, fmt.Sprint(*value))
}

func resolveToolFormat(format string, plugins bool) (string, error) {
	switch format {
	case "auto":
		if plugins {
			return "claude", nil
		}
		return "native", nil
	case "claude":
		return format, nil
	case "native":
		if !plugins {
			return format, nil
		}
		return "", errors.New("native tool format conflicts with Claude plugin packages")
	default:
		return "", errors.New("tool-format must be auto, native or claude")
	}
}
