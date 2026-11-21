package sandbox

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// StrictProfile is an explicit operator provisioned runtime allowlist. These
// mounts must contain trusted redistributable tools/dependencies, not user data.
// No repository file, HTTP request or Agent can add paths to this profile.
type StrictProfile struct {
	ReadOnlyPaths []string `json:"readOnlyPaths"`
}
type strictMount struct{ source, destination string }

func StrictEnvironment(policy Policy) []string {
	home, tmp := "/tmp", "/tmp"
	if runtime.GOOS == "darwin" {
		home, tmp = policy.WorkspaceRoot, policy.WorkspaceRoot
	}
	return []string{"PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TZ=UTC", "HOME=" + home, "TMPDIR=" + tmp}
}

// ValidateStrictProfile checks the native mount boundary and original source
// roots without opening file contents. HOME, source repositories and their
// parents can never be exported as runtime trees, even by a broad declaration.
func ValidateStrictProfile(profile StrictProfile, workspaceRoot string, excluded ...string) error {
	_, err := strictMounts(profile, workspaceRoot, excluded...)
	return err
}
func strictRuntimeLocation(name string) bool {
	for _, family := range []string{"/usr", "/bin", "/sbin", "/lib", "/lib64", "/System/Library", "/Library/Apple"} {
		if withinRoot(family, name) {
			return true
		}
	}
	return strings.HasPrefix(name, "/opt/")
}

// A read-only bind of a host socket/FIFO is still an IPC capability, not inert
// runtime data. Refuse such trees; do not follow symlinks into unmounted paths.
func strictRuntimeFileType(mode os.FileMode) bool {
	return mode.IsDir() || mode&os.ModeSymlink != 0 || mode.IsRegular()
}
func strictRuntimeFiles(root string) error {
	deadline := time.Now().Add(5 * time.Second)
	count := 0
	return filepath.WalkDir(root, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		count++
		if count > 500000 || time.Now().After(deadline) {
			return errors.New("runtime tree inspection exceeded strict mount budget")
		}
		mode := entry.Type()
		if mode == 0 {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			mode = info.Mode()
		}
		if !strictRuntimeFileType(mode) {
			return errors.New("runtime mounts cannot contain sockets, FIFOs or devices")
		}
		return nil
	})
}
func strictMounts(profile StrictProfile, workspaceRoot string, excluded ...string) ([]strictMount, error) {
	if len(profile.ReadOnlyPaths) == 0 || len(profile.ReadOnlyPaths) > 32 {
		return nil, errors.New("strict sandbox requires 1–32 explicit runtime mounts")
	}
	if workspaceRoot != "" && (!filepath.IsAbs(workspaceRoot) || filepath.Clean(workspaceRoot) != workspaceRoot || workspaceRoot == "/") {
		return nil, errors.New("strict workspace must be an exact absolute directory")
	}
	excluded = append(append([]string(nil), excluded...), workspaceRoot)
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		excluded = append(excluded, home)
	}
	mounts := []strictMount{}
	seen := map[string]bool{}
	for _, name := range profile.ReadOnlyPaths {
		if !filepath.IsAbs(name) || filepath.Clean(name) != name || len(name) > 4096 || strings.ContainsAny(name, "\x00\r\n\t") || seen[name] {
			return nil, errors.New("strict runtime mounts must be unique clean absolute paths")
		}
		if !strictRuntimeLocation(name) {
			return nil, fmt.Errorf("strict runtime mount %q is not a system runtime location", name)
		}
		source, err := filepath.EvalSymlinks(name)
		if err != nil {
			return nil, fmt.Errorf("strict runtime mount unavailable: %w", err)
		}
		if !strictRuntimeLocation(source) {
			return nil, errors.New("runtime mount resolves outside allowed system runtime locations")
		}
		info, err := os.Stat(source)
		if err != nil || (!info.IsDir() && !info.Mode().IsRegular()) {
			return nil, errors.New("strict runtime mount must be a directory or regular file")
		}
		for _, blocked := range excluded {
			if blocked == "" {
				continue
			}
			canonical, err := filepath.EvalSymlinks(blocked)
			if err == nil {
				blocked = canonical
			}
			if withinRoot(source, blocked) || withinRoot(blocked, source) || withinRoot(name, blocked) || withinRoot(blocked, name) {
				return nil, errors.New("strict runtime mount overlaps HOME, workspace or original source")
			}
		}
		if err := strictRuntimeFiles(source); err != nil {
			return nil, fmt.Errorf("unsafe strict runtime mount: %w", err)
		}
		seen[name] = true
		mounts = append(mounts, strictMount{source: source, destination: name})
	}
	sort.Slice(mounts, func(i, j int) bool { return mounts[i].destination < mounts[j].destination })
	return mounts, nil
}

func (p *LocalProvider) confineStrict(argv []string, policy Policy) (Confined, error) {
	unavailable := func(err error) (Confined, error) {
		return Confined{}, &UnavailableError{Mode: policy.Mode, Detail: "strict read/network sandbox unavailable: " + err.Error(), Cause: err}
	}
	if len(p.options.RunnerCommand) > 0 {
		return unavailable(errors.New("custom runners cannot attest strict isolation"))
	}
	mounts, err := strictMounts(*policy.Strict, policy.WorkspaceRoot)
	if err != nil {
		return unavailable(err)
	}
	root, err := filepath.EvalSymlinks(policy.WorkspaceRoot)
	if err != nil || root != policy.WorkspaceRoot {
		return unavailable(errors.New("strict workspace must exist without symbolic ancestors"))
	}
	if len(policy.WritableSubpaths) > 0 {
		return unavailable(errors.New("strict profile requires a separate whole isolated workspace, not narrowed host paths"))
	}
	var program string
	var profile, probe []string
	switch p.options.Platform {
	case "linux":
		program = p.options.BwrapCommand
		profile = strictBwrapProfile(policy, mounts, true)
		probe = append(strictBwrapProfile(policy, mounts, false), "--", "/usr/bin/true")
	case "darwin":
		program = p.options.SeatbeltCommand
		profile = []string{"-p", strictSeatbeltProfile(policy, mounts, true)}
		probe = []string{"-p", strictSeatbeltProfile(policy, mounts, false), "--", "/usr/bin/true"}
	default:
		return unavailable(fmt.Errorf("no strict backend for %s", p.options.Platform))
	}
	// Probe only a fixed trusted runtime command, never candidate code. No source
	// or candidate mount/read permission enters the probe policy.
	ctx, cancel := context.WithTimeout(context.Background(), p.options.ProbeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, program, probe...)
	cmd.Env = StrictEnvironment(Policy{})
	cmd.Dir = "/"
	if err := cmd.Run(); err != nil {
		return unavailable(err)
	}
	if p.options.Platform == "darwin" {
		// Defence in depth for callers other than LocalExecutor: the inner command
		// cannot receive ambient secrets. LocalExecutor also clears the launcher env.
		profile = append(profile, "--", "/usr/bin/env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TZ=UTC", "HOME="+root, "TMPDIR="+root)
	} else {
		profile = append(profile, "--")
	}
	return Confined{Argv: append(append([]string{program}, profile...), argv...), Enforcement: EnforcementFull, ReadIsolated: true, NetworkIsolated: true, DenialSignatures: []string{"permission denied", "operation not permitted", "read-only file system"}, RunnerFailureRules: []RunnerFailureRule{{FatalSignatures: []string{"bwrap: ", "sandbox-exec: "}}}}, nil
}
func strictBwrapProfile(policy Policy, mounts []strictMount, workspace bool) []string {
	args := []string{"--die-with-parent", "--new-session", "--unshare-user", "--unshare-pid", "--unshare-net", "--unshare-ipc", "--unshare-uts", "--cap-drop", "ALL", "--clearenv", "--tmpfs", "/", "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev"}
	// bwrap consumes Linux paths, even when a profile is inspected on another OS.
	// It creates destination leaves, but parents must exist before RO mounts.
	parents := map[string]bool{}
	for _, mount := range mounts {
		for parent := path.Dir(mount.destination); parent != "/" && parent != "."; parent = path.Dir(parent) {
			parents[parent] = true
		}
	}
	if workspace {
		for parent := path.Dir(policy.WorkspaceRoot); parent != "/" && parent != "."; parent = path.Dir(parent) {
			parents[parent] = true
		}
	}
	names := []string{}
	for name := range parents {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		if len(names[i]) != len(names[j]) {
			return len(names[i]) < len(names[j])
		}
		return names[i] < names[j]
	})
	for _, name := range names {
		args = append(args, "--dir", name)
	}
	for _, mount := range mounts {
		args = append(args, "--ro-bind", mount.source, mount.destination)
	}
	cwd := "/"
	if workspace {
		mode := "--bind"
		if policy.Mode == ReadOnly {
			mode = "--ro-bind"
		}
		args = append(args, mode, policy.WorkspaceRoot, policy.WorkspaceRoot)
		cwd = policy.WorkspaceRoot
	}
	args = append(args, "--remount-ro", "/", "--chdir", cwd)
	for _, entry := range StrictEnvironment(policy) {
		name, value, _ := strings.Cut(entry, "=")
		args = append(args, "--setenv", name, value)
	}
	return args
}

// Seatbelt starts deny-all: no network, process-info, broad filesystem or Mach
// lookup grants. Only runtime files and the isolated candidate are readable.
// Scratch must stay in the owned workspace on macOS; there is no host /tmp grant.
func strictSeatbeltProfile(policy Policy, mounts []strictMount, workspace bool) string {
	// dyld opens the root directory as an openat base on macOS 27.
	// The literal matches only the directory itself, never its descendants.
	forms := []string{"(version 1)", "(deny default)", "(deny network*)", "(allow process-exec)", "(allow process-fork)", `(allow file-read-metadata file-read-data (literal "/"))`, `(allow file-read* file-write* (literal "/dev/null"))`}
	for _, mount := range mounts {
		forms = append(forms, "(allow file-read* file-map-executable (subpath "+sbplString(mount.source)+") (subpath "+sbplString(mount.destination)+"))")
	}
	if workspace {
		forms = append(forms, "(allow file-read* file-map-executable (subpath "+sbplString(policy.WorkspaceRoot)+"))")
		if policy.Mode == WorkspaceWrite {
			forms = append(forms, "(allow file-write* (subpath "+sbplString(policy.WorkspaceRoot)+"))")
		}
	}
	return strings.Join(forms, " ")
}
