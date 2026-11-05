// Package environmentservice owns explicitly requested services beyond an
// agent process. A separate supervisor owns the exact process group until an
// environment stop request or a bounded expiry, never an agent Session close.
package environmentservice

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/phodal/pero/harness/go/shell"
)

type Options struct {
	Directory, Workspace, Shell string
	HelperCommand               []string
	Environment                 []string
}
type StartRequest struct {
	Command    string `json:"command"`
	LifetimeMS int64  `json:"lifetime_ms"`
}
type Receipt struct {
	ID              string           `json:"service_id"`
	Status          string           `json:"status"`
	Owner           string           `json:"owner"`
	ExpiresAt       time.Time        `json:"expires_at"`
	OutputFile      string           `json:"output_file"`
	OutputTruncated bool             `json:"output_truncated,omitempty"`
	Result          *shell.RunResult `json:"result,omitempty"`
	Diagnostic      string           `json:"diagnostic,omitempty"`
}
type launchPlan struct {
	Version     int      `json:"version"`
	Receipt     Receipt  `json:"receipt"`
	Workspace   string   `json:"workspace"`
	Shell       string   `json:"shell"`
	Command     string   `json:"command"`
	Environment []string `json:"environment"`
}

func privateDirectory(name string, create bool) error {
	if !filepath.IsAbs(name) {
		return errors.New("environment service directory must be absolute")
	}
	if create {
		if err := os.MkdirAll(name, 0700); err != nil {
			return err
		}
	}
	info, err := os.Lstat(name)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return errors.New("environment service directory must be private and regular")
	}
	return nil
}

func Start(ctx context.Context, options Options, input StartRequest) (Receipt, error) {
	if strings.TrimSpace(input.Command) == "" || len(input.Command) > 16384 || input.LifetimeMS < 100 || input.LifetimeMS > int64((2*time.Hour)/time.Millisecond) || len(options.HelperCommand) == 0 {
		return Receipt{}, errors.New("environment service requires a command and a lifetime between 100ms and 2h")
	}
	if err := privateDirectory(options.Directory, true); err != nil {
		return Receipt{}, err
	}
	// Validate the same executable/workspace/environment seam used by ordinary
	// native shell calls before publishing a launch intent.
	executor, err := shell.NewLocalExecutor(shell.LocalOptions{Shell: options.Shell, CWD: options.Workspace, BaseEnv: options.Environment, TrustedBaseEnvironment: true})
	if err != nil {
		return Receipt{}, err
	}
	if _, err := executor.Resolve(shell.ExecRequest{Command: input.Command}); err != nil {
		return Receipt{}, err
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return Receipt{}, err
	}
	id := hex.EncodeToString(nonce[:])
	dir := filepath.Join(options.Directory, id)
	if err := os.Mkdir(dir, 0700); err != nil {
		return Receipt{}, err
	}
	receipt := Receipt{ID: id, Status: "starting", Owner: "environment", ExpiresAt: time.Now().UTC().Add(time.Duration(input.LifetimeMS) * time.Millisecond), OutputFile: filepath.Join(dir, "output.log")}
	plan := launchPlan{Version: 1, Receipt: receipt, Workspace: options.Workspace, Shell: options.Shell, Command: input.Command, Environment: options.Environment}
	raw, err := json.Marshal(plan)
	if err != nil {
		return receipt, err
	}
	planPath := filepath.Join(dir, "launch.json")
	if err := os.WriteFile(planPath, raw, 0600); err != nil {
		return receipt, err
	}
	if err := writeStatus(dir, receipt); err != nil {
		return receipt, err
	}
	if err := ctx.Err(); err != nil {
		receipt.Status, receipt.Diagnostic = "failed", "launch was canceled before supervisor start"
		_ = writeStatus(dir, receipt)
		return receipt, err
	}
	args := append(append([]string(nil), options.HelperCommand[1:]...), planPath)
	command := exec.Command(options.HelperCommand[0], args...)
	command.Env = []string{"PATH=/usr/bin:/bin"}
	if err := detach(command); err != nil {
		return receipt, err
	}
	if err := command.Start(); err != nil {
		receipt.Status, receipt.Diagnostic = "failed", "supervisor could not start"
		_ = writeStatus(dir, receipt)
		return receipt, err
	}
	go func() { _ = command.Wait() }()
	return receipt, nil
}

func serviceDirectory(root, id string) (string, error) {
	decoded, err := hex.DecodeString(id)
	if err != nil || len(decoded) != 16 || hex.EncodeToString(decoded) != id {
		return "", errors.New("invalid environment service identity")
	}
	if err := privateDirectory(root, false); err != nil {
		return "", err
	}
	dir := filepath.Join(root, id)
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return "", errors.New("environment service is unavailable")
	}
	return dir, nil
}

func Status(root, id string) (Receipt, error) {
	dir, err := serviceDirectory(root, id)
	if err != nil {
		return Receipt{}, err
	}
	file, err := os.Open(filepath.Join(dir, "status.json"))
	if err != nil {
		return Receipt{}, err
	}
	defer file.Close()
	var receipt Receipt
	decoder := json.NewDecoder(io.LimitReader(file, 65536))
	if err := decoder.Decode(&receipt); err != nil {
		return receipt, err
	}
	if receipt.ID != id || receipt.Owner != "environment" {
		return Receipt{}, errors.New("environment service receipt identity mismatch")
	}
	if (receipt.Status == "starting" || receipt.Status == "running") && time.Now().After(receipt.ExpiresAt.Add(5*time.Second)) {
		receipt.Status, receipt.Diagnostic = "unverified", "supervisor has not recorded termination after expiry"
	}
	return receipt, nil
}

func Stop(root, id string) (Receipt, error) {
	receipt, err := Status(root, id)
	if err != nil {
		return receipt, err
	}
	if receipt.Status != "running" && receipt.Status != "starting" && receipt.Status != "unverified" {
		return receipt, nil
	}
	dir, err := serviceDirectory(root, id)
	if err != nil {
		return receipt, err
	}
	if err := os.WriteFile(filepath.Join(dir, "stop"), []byte("environment stop requested\n"), 0600); err != nil {
		return receipt, err
	}
	receipt.Status = "stop_requested"
	return receipt, nil
}

func writeStatus(dir string, receipt Receipt) error {
	raw, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".status-")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	_, writeErr := file.Write(raw)
	if err := errors.Join(writeErr, file.Close()); err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(dir, "status.json"))
}

// Supervise is an internal executable entrypoint, not a session worker.
func Supervise(planPath string) (resultErr error) {
	info, err := os.Lstat(planPath)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 1<<20 {
		return errors.New("invalid private service launch plan")
	}
	raw, err := os.ReadFile(planPath)
	if err != nil {
		return err
	}
	var plan launchPlan
	if err := json.Unmarshal(raw, &plan); err != nil {
		return err
	}
	dir := filepath.Dir(planPath)
	if plan.Version != 1 || filepath.Base(dir) != plan.Receipt.ID || plan.Receipt.Owner != "environment" || plan.Receipt.OutputFile != filepath.Join(dir, "output.log") || time.Until(plan.Receipt.ExpiresAt) > 2*time.Hour {
		return errors.New("invalid service launch identity or expiry")
	}
	defer func() {
		if resultErr != nil && plan.Receipt.Result == nil {
			plan.Receipt.Status, plan.Receipt.Diagnostic = "failed", "supervisor setup did not complete"
			_ = writeStatus(dir, plan.Receipt)
		}
	}()
	ctx, cancel := context.WithDeadline(context.Background(), plan.Receipt.ExpiresAt)
	defer cancel()
	log, err := os.OpenFile(plan.Receipt.OutputFile, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer log.Close()
	output := &boundedLog{file: log, remaining: 4 << 20}
	started := make(chan struct{})
	executor, err := shell.NewLocalExecutor(shell.LocalOptions{Shell: plan.Shell, CWD: plan.Workspace, BaseEnv: plan.Environment, TrustedBaseEnvironment: true, Timeout: 2 * time.Hour, MaxTimeout: 2 * time.Hour, MaxOutputBytes: 8192, OutputSink: output, ProcessStarted: func() { close(started) }})
	if err != nil {
		return err
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-started:
				started = nil
				running := plan.Receipt
				running.Status = "running"
				if writeStatus(dir, running) != nil {
					cancel()
					return
				}
			case <-ticker.C:
				if _, err := os.Stat(filepath.Join(dir, "stop")); err == nil {
					cancel()
					return
				}
			}
		}
	}()
	spec, err := executor.Resolve(shell.ExecRequest{Command: plan.Command})
	if err != nil {
		cancel()
		<-done
		return err
	}
	result, runErr := executor.Run(ctx, spec)
	cancel()
	<-done
	plan.Receipt.Result = &result
	plan.Receipt.OutputTruncated = output.truncated
	plan.Receipt.Status = "exited"
	if runErr != nil || result.ExitCode == nil || *result.ExitCode != 0 {
		plan.Receipt.Status = "failed"
	}
	if _, err := os.Stat(filepath.Join(dir, "stop")); err == nil {
		plan.Receipt.Status = "stopped"
	} else if time.Now().After(plan.Receipt.ExpiresAt) {
		plan.Receipt.Status = "expired"
	}
	if runErr != nil {
		plan.Receipt.Diagnostic = "service execution did not complete successfully"
	}
	if result.CleanupUncertain {
		plan.Receipt.Status, plan.Receipt.Diagnostic = "unverified", "service process group cleanup could not be confirmed"
	}
	return writeStatus(dir, plan.Receipt)
}

type boundedLog struct {
	file      *os.File
	remaining int
	truncated bool
}

func (w *boundedLog) Write(data []byte) (int, error) {
	n := min(len(data), w.remaining)
	w.truncated = w.truncated || n < len(data)
	if n > 0 {
		written, err := w.file.Write(data[:n])
		w.remaining -= written
		if err != nil {
			return written, err
		}
	}
	return len(data), nil
}
