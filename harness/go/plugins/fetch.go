package plugins

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// FetchReceipt identifies a new snapshot. Repeating Fetch updates by producing
// another snapshot; existing sessions and user edits are never reset in place.
type FetchReceipt struct {
	Directory string          `json:"directory"`
	Revision  string          `json:"revision"`
	Plugins   []FetchedPlugin `json:"plugins,omitempty"`
}
type FetchedPlugin struct {
	Name     string `json:"name"`
	Revision string `json:"revision"`
}
type gitSource struct {
	Source string `json:"source"`
	Repo   string `json:"repo"`
	URL    string `json:"url"`
	Path   string `json:"path"`
	Ref    string `json:"ref"`
	SHA    string `json:"sha"`
}

// Fetch acquires code only. It never invokes package hooks, MCP, npm install or
// model requests. cache is explicitly selected by the operator, not model input.
func Fetch(ctx context.Context, source, cache, ref string) (FetchReceipt, error) {
	cache, err := filepath.Abs(cache)
	if err != nil {
		return FetchReceipt{}, err
	}
	if err = os.MkdirAll(cache, 0700); err != nil {
		return FetchReceipt{}, err
	}
	stage, err := os.MkdirTemp(cache, ".fetch-")
	if err != nil {
		return FetchReceipt{}, err
	}
	defer os.RemoveAll(stage)
	root := filepath.Join(stage, "source")
	revision, err := fetchGit(ctx, source, root, ref, "")
	if err != nil {
		return FetchReceipt{}, err
	}
	receipt := FetchReceipt{Revision: revision}
	reader, err := os.OpenRoot(root)
	if err != nil {
		return FetchReceipt{}, err
	}
	defer reader.Close()
	manifest := ".claude-plugin/marketplace.json"
	raw, err := readConfiguration(reader, manifest)
	if err == nil {
		if len(raw) > maxConfigurationBytes {
			return FetchReceipt{}, errors.New("plugins: marketplace exceeds configuration limit")
		}
		var document struct {
			Plugins []json.RawMessage `json:"plugins"`
		}
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &document) != nil || json.Unmarshal(raw, &fields) != nil || len(document.Plugins) > maxComponents {
			return FetchReceipt{}, errors.New("plugins: invalid marketplace")
		}
		dependenciesCreated := false
		for i, rawEntry := range document.Plugins {
			var entry marketplaceEntry
			var entryFields map[string]json.RawMessage
			if json.Unmarshal(rawEntry, &entry) != nil || json.Unmarshal(rawEntry, &entryFields) != nil {
				return FetchReceipt{}, errors.New("plugins: invalid marketplace entry")
			}
			var local string
			if json.Unmarshal(entry.Source, &local) == nil {
				continue
			}
			var remote gitSource
			if json.Unmarshal(entry.Source, &remote) != nil {
				return FetchReceipt{}, errors.New("plugins: invalid remote plugin source")
			}
			address := remote.URL
			switch remote.Source {
			case "github":
				if strings.Count(remote.Repo, "/") != 1 || !localPath(remote.Repo) {
					return FetchReceipt{}, errors.New("plugins: invalid GitHub repository")
				}
				address = "https://github.com/" + remote.Repo + ".git"
			case "url", "git-subdir":
				if remote.Source == "git-subdir" && !strings.Contains(address, ":") && !filepath.IsAbs(address) {
					address = "https://github.com/" + address + ".git"
				}
			default:
				return FetchReceipt{}, errors.New("plugins: fetch supports github, url and git-subdir plugin sources")
			}
			if remote.Source == "git-subdir" && remote.Path == "" || remote.Path != "" && (remote.Source != "git-subdir" || !localPath(remote.Path)) {
				return FetchReceipt{}, errors.New("plugins: invalid Git plugin subdirectory")
			}
			if !dependenciesCreated {
				if err := reader.Mkdir(".pero-fetch", 0700); err != nil {
					return FetchReceipt{}, errors.New("plugins: reserved acquisition directory is unavailable")
				}
				dependenciesCreated = true
			}
			relative := fmt.Sprintf(".pero-fetch/%d", i)
			rev, err := fetchGit(ctx, address, filepath.Join(root, relative), remote.Ref, remote.SHA)
			if err != nil {
				return FetchReceipt{}, fmt.Errorf("plugins: fetch entry %d: %w", i, err)
			}
			if remote.Path != "" {
				relative = filepath.ToSlash(filepath.Join(relative, remote.Path))
			}
			entryFields["source"], _ = json.Marshal("./" + relative)
			document.Plugins[i], _ = json.Marshal(entryFields)
			receipt.Plugins = append(receipt.Plugins, FetchedPlugin{Name: entry.Name, Revision: rev})
		}
		fields["plugins"], _ = json.Marshal(document.Plugins)
		raw, _ = json.MarshalIndent(fields, "", "  ")
		if err = reader.WriteFile(manifest, append(raw, '\n'), 0600); err != nil {
			return FetchReceipt{}, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return FetchReceipt{}, err
	}
	report, err := Inspect(ctx, root)
	if err != nil {
		return FetchReceipt{}, err
	}
	if !report.Valid() {
		return FetchReceipt{}, errors.New("plugins: acquired snapshot failed configuration validation")
	}
	if err = ctx.Err(); err != nil {
		return FetchReceipt{}, err
	}
	// Windows cannot rename a directory while its os.Root handle is open.
	// Keep the deferred close for error paths, but release it before publication.
	if err = reader.Close(); err != nil {
		return FetchReceipt{}, err
	}
	// Allocate the final name independently of source metadata. Rename publishes
	// one complete snapshot on the same filesystem; failed updates leave old ones.
	final, err := os.MkdirTemp(cache, "snapshot-"+revision[:12]+"-")
	if err != nil {
		return FetchReceipt{}, err
	}
	if err = os.Rename(root, filepath.Join(final, "source")); err != nil {
		_ = os.Remove(final)
		return FetchReceipt{}, err
	}
	receipt.Directory = filepath.Join(final, "source")
	data, _ := json.MarshalIndent(receipt, "", "  ")
	if err = os.WriteFile(filepath.Join(final, "receipt.json"), append(data, '\n'), 0600); err != nil {
		_ = os.RemoveAll(final)
		return FetchReceipt{}, err
	}
	return receipt, nil
}

func fetchGit(ctx context.Context, source, destination, ref, sha string) (string, error) {
	if source == "" || strings.HasPrefix(source, "-") || strings.ContainsAny(source, "\x00\r\n") {
		return "", errors.New("plugins: invalid Git source")
	}
	if !filepath.IsAbs(source) {
		parsed, err := url.Parse(source)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "ssh") || parsed.RawQuery != "" || parsed.Fragment != "" {
			return "", errors.New("plugins: Git source must be an absolute local path or HTTPS/SSH URL")
		}
		if parsed.User != nil && (parsed.Scheme != "ssh" || strings.Contains(parsed.User.String(), ":")) {
			return "", errors.New("plugins: use Git credential configuration rather than URL credentials")
		}
	}
	if ref == "" {
		ref = "HEAD"
	}
	if strings.HasPrefix(ref, "-") || strings.ContainsAny(ref, "\x00\r\n :~^?*[]\\") {
		return "", errors.New("plugins: invalid Git ref")
	}
	if sha != "" {
		if len(sha) != 40 && len(sha) != 64 {
			return "", errors.New("plugins: SHA must be a complete Git object id")
		}
		for _, c := range sha {
			if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
				return "", errors.New("plugins: invalid Git SHA")
			}
		}
		ref = sha
	}
	run := func(args ...string) (string, error) {
		command := exec.CommandContext(ctx, "git", append([]string{"-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never", "-c", "credential.interactive=false"}, args...)...)
		command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		command.WaitDelay = time.Second
		configureGitProcess(command)
		out, err := command.Output()
		if err != nil {
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			return "", errors.New("plugins: Git acquisition failed; check repository access and selected ref")
		}
		return strings.TrimSpace(string(out)), nil
	}
	if _, err := run("init", "--quiet", destination); err != nil {
		return "", err
	}
	if _, err := run("-C", destination, "fetch", "--quiet", "--depth=1", "--no-tags", "--", source, ref); err != nil {
		return "", err
	}
	revision, err := run("-C", destination, "rev-parse", "--verify", "FETCH_HEAD^{commit}")
	if err != nil {
		return "", err
	}
	if sha != "" && !strings.EqualFold(sha, revision) {
		return "", errors.New("plugins: fetched revision does not match pinned SHA")
	}
	if _, err := run("-C", destination, "checkout", "--quiet", "--detach", revision); err != nil {
		return "", err
	}
	return revision, nil
}
