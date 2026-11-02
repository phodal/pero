// Package lsp implements selected read-only language-server queries over stdio.
package lsp

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strings"
	"time"
)

// JSONValue is a frozen, validated protocol value. Accessors return fresh bytes.
type JSONValue struct{ value string }

func (v JSONValue) MarshalJSON() ([]byte, error) {
	if v.value == "" {
		return []byte("null"), nil
	}
	return []byte(v.value), nil
}
func (v JSONValue) Bytes() []byte { raw, _ := v.MarshalJSON(); return raw }
func frozen(raw json.RawMessage) JSONValue {
	if len(raw) == 0 {
		return JSONValue{}
	}
	return JSONValue{value: string(raw)}
}

type LanguageMapping struct{ Extension, Language string }
type EnvironmentVariable struct{ Name, Value string }

// Config is decoded at the configuration boundary. Runtime construction copies
// its slices; execution cannot be configured by model tool arguments.
type Config struct {
	Command                                         string   `json:"-"`
	Args                                            []string `json:"-"`
	ExtensionToLanguage                             []LanguageMapping
	Env                                             []EnvironmentVariable `json:"-"`
	InitializationOptions, Settings                 JSONValue             `json:"-"`
	WorkspaceFolder                                 string                `json:"-"`
	StartupTimeout, ShutdownTimeout, RequestTimeout time.Duration
	RestartOnCrash                                  bool
	MaxRestarts                                     int
}
type Server struct {
	Name   string
	Config Config `json:"-"`
}

// DecodeServers accepts the official server-name map, not an extra wrapper.
// Unimplemented transport and post-edit diagnostics are rejected explicitly.
func DecodeServers(content []byte) ([]Server, error) {
	var entries map[string]json.RawMessage
	if json.Unmarshal(content, &entries) != nil || entries == nil || len(entries) > 32 {
		return nil, errors.New("lsp: expected a map of at most 32 named server configurations")
	}
	names := make([]string, 0, len(entries))
	for name := range entries {
		names = append(names, name)
	}
	sort.Strings(names)
	servers := make([]Server, 0, len(names))
	for _, name := range names {
		if strings.TrimSpace(name) == "" || strings.ContainsAny(name, "\x00\r\n") {
			return nil, errors.New("lsp: server names must not be empty")
		}
		var fields map[string]json.RawMessage
		if json.Unmarshal(entries[name], &fields) != nil || fields == nil {
			return nil, errors.New("lsp: server configuration must be an object")
		}
		for field, value := range fields {
			if bytes.Equal(bytes.TrimSpace(value), []byte("null")) && field != "settings" && field != "initializationOptions" {
				return nil, errors.New("lsp: a declared server configuration field must not be null")
			}
		}
		var wire struct {
			Command               string            `json:"command"`
			Args                  []string          `json:"args"`
			Extensions            map[string]string `json:"extensionToLanguage"`
			Transport             string            `json:"transport"`
			Env                   map[string]string `json:"env"`
			InitializationOptions json.RawMessage   `json:"initializationOptions"`
			Settings              json.RawMessage   `json:"settings"`
			WorkspaceFolder       string            `json:"workspaceFolder"`
			StartupTimeout        *int64            `json:"startupTimeout"`
			ShutdownTimeout       *int64            `json:"shutdownTimeout"`
			RequestTimeout        *int64            `json:"requestTimeout"`
			RestartOnCrash        *bool             `json:"restartOnCrash"`
			MaxRestarts           *int              `json:"maxRestarts"`
			Diagnostics           *bool             `json:"diagnostics"`
		}
		decoder := json.NewDecoder(bytes.NewReader(entries[name]))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&wire); err != nil {
			return nil, errors.New("lsp: invalid or unknown server configuration field")
		}
		if err := decoder.Decode(new(json.RawMessage)); err != io.EOF {
			return nil, errors.New("lsp: invalid server configuration")
		}
		if wire.Command == "" || strings.ContainsRune(wire.Command, 0) || (!strings.HasPrefix(wire.Command, "/") && strings.ContainsAny(wire.Command, " \t\r\n")) {
			return nil, errors.New("lsp: command must name one executable; put arguments in args")
		}
		if wire.Transport != "" && wire.Transport != "stdio" {
			return nil, errors.New("lsp: only stdio transport is implemented")
		}
		if wire.Diagnostics != nil && *wire.Diagnostics {
			return nil, errors.New("lsp: post-edit diagnostics injection is not implemented; diagnostics must be false when declared")
		}
		if len(wire.Extensions) == 0 {
			return nil, errors.New("lsp: extensionToLanguage requires at least one mapping")
		}
		config := Config{Command: wire.Command, Args: append([]string(nil), wire.Args...), InitializationOptions: frozen(wire.InitializationOptions), Settings: frozen(wire.Settings), WorkspaceFolder: wire.WorkspaceFolder, StartupTimeout: 10 * time.Second, ShutdownTimeout: 5 * time.Second, RequestTimeout: 60 * time.Second, RestartOnCrash: true, MaxRestarts: 3}
		for _, arg := range config.Args {
			if strings.ContainsRune(arg, 0) {
				return nil, errors.New("lsp: args must not contain null bytes")
			}
		}
		for extension, language := range wire.Extensions {
			if !strings.HasPrefix(extension, ".") || len(extension) < 2 || strings.ContainsAny(extension, "/\\\x00") || strings.TrimSpace(language) == "" || strings.ContainsRune(language, 0) {
				return nil, errors.New("lsp: invalid file extension or language identifier")
			}
			config.ExtensionToLanguage = append(config.ExtensionToLanguage, LanguageMapping{extension, language})
		}
		sort.Slice(config.ExtensionToLanguage, func(i, j int) bool {
			return config.ExtensionToLanguage[i].Extension < config.ExtensionToLanguage[j].Extension
		})
		for key, value := range wire.Env {
			if key == "" || strings.ContainsAny(key, "=\x00") || strings.ContainsRune(value, 0) {
				return nil, errors.New("lsp: invalid environment binding")
			}
			config.Env = append(config.Env, EnvironmentVariable{key, value})
		}
		sort.Slice(config.Env, func(i, j int) bool { return config.Env[i].Name < config.Env[j].Name })
		for _, duration := range []struct {
			wire   *int64
			target *time.Duration
		}{{wire.StartupTimeout, &config.StartupTimeout}, {wire.ShutdownTimeout, &config.ShutdownTimeout}, {wire.RequestTimeout, &config.RequestTimeout}} {
			if duration.wire != nil {
				if *duration.wire < 1 || *duration.wire > int64((1<<63-1)/time.Millisecond) {
					return nil, errors.New("lsp: timeouts must be positive milliseconds")
				}
				*duration.target = time.Duration(*duration.wire) * time.Millisecond
			}
		}
		if wire.RestartOnCrash != nil {
			config.RestartOnCrash = *wire.RestartOnCrash
		}
		if wire.MaxRestarts != nil {
			if *wire.MaxRestarts < 0 {
				return nil, errors.New("lsp: maxRestarts must not be negative")
			}
			config.MaxRestarts = *wire.MaxRestarts
		}
		servers = append(servers, Server{Name: name, Config: config})
	}
	return servers, nil
}
