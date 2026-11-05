package environmentservice

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// The launcher exits before the caller checks HTTP, proving ownership across
// a real parent-process exit, rather than just a cancelled goroutine.
func TestEnvironmentServiceProcess(t *testing.T) {
	index := -1
	for i, arg := range os.Args {
		if arg == "--" {
			index = i
			break
		}
	}
	if index < 0 {
		return
	}
	args := os.Args[index+1:]
	if args[0] == "host" {
		if err := Supervise(args[1]); err != nil {
			t.Fatal(err)
		}
		return
	}
	if args[0] != "launch" {
		t.Fatal("invalid test subprocess mode")
	}
	input := StartRequest{Command: args[4], LifetimeMS: 30000}
	options := Options{Directory: args[1], Workspace: args[2], Shell: args[3], HelperCommand: []string{os.Args[0], "-test.run=^TestEnvironmentServiceProcess$", "--", "host"}}
	receipt, err := Start(context.Background(), options, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(receipt); err != nil {
		t.Fatal(err)
	}
}

func TestEnvironmentServiceSurvivesLauncherAndStops(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("Unix supervisor")
	}
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("Python is needed for the independent HTTP fixture")
	}
	root, workspace := filepath.Join(t.TempDir(), "services"), t.TempDir()
	script := "import http.server; s=http.server.HTTPServer(('127.0.0.1',0),http.server.SimpleHTTPRequestHandler); open('port','w').write(str(s.server_port)); s.serve_forever()"
	command := "exec '" + strings.ReplaceAll(python, "'", "'\\''") + "' -u -c '" + strings.ReplaceAll(script, "'", "'\\''") + "'"
	launcher := exec.Command(os.Args[0], "-test.run=^TestEnvironmentServiceProcess$", "--", "launch", root, workspace, "/bin/bash", command)
	raw, err := launcher.Output()
	if err != nil {
		t.Fatalf("launcher: %v", err)
	}
	var receipt Receipt
	if err := json.NewDecoder(strings.NewReader(string(raw))).Decode(&receipt); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = Stop(root, receipt.ID) })
	client := &http.Client{Timeout: 200 * time.Millisecond}
	deadline := time.Now().Add(10 * time.Second)
	var url string
	for {
		port, err := os.ReadFile(filepath.Join(workspace, "port"))
		if err == nil {
			url = "http://127.0.0.1:" + strings.TrimSpace(string(port)) + "/"
			response, err := client.Get(url)
			if err == nil {
				response.Body.Close()
				status, statusErr := Status(root, receipt.ID)
				if response.StatusCode == 200 && statusErr == nil && status.Status == "running" {
					break
				}
			}
		}
		if time.Now().After(deadline) {
			status, _ := Status(root, receipt.ID)
			t.Fatalf("service did not become independently ready: %+v", status)
		}
		time.Sleep(20 * time.Millisecond)
	}
	status, err := Status(root, receipt.ID)
	if err != nil || status.Status != "running" {
		t.Fatalf("status=%+v err=%v", status, err)
	}
	stop, err := Stop(root, receipt.ID)
	if err != nil || stop.Status != "stop_requested" {
		t.Fatalf("stop=%+v err=%v", stop, err)
	}
	for {
		status, err = Status(root, receipt.ID)
		if err == nil && status.Status == "stopped" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("stop unconfirmed: %+v %v", status, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if response, err := client.Get(url); err == nil {
		response.Body.Close()
		t.Fatal("HTTP service survived confirmed cleanup")
	}
	if _, err := Stop(root, "../other"); err == nil {
		t.Fatal("accepted non-service identity")
	}
}

func TestEnvironmentServiceExpiry(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("Unix supervisor")
	}
	root := filepath.Join(t.TempDir(), "services")
	options := Options{Directory: root, Workspace: t.TempDir(), Shell: "/bin/bash", HelperCommand: []string{os.Args[0], "-test.run=^TestEnvironmentServiceProcess$", "--", "host"}}
	receipt, err := Start(t.Context(), options, StartRequest{Command: "exec sleep 20", LifetimeMS: 600})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = Stop(root, receipt.ID) })
	deadline := time.Now().Add(6 * time.Second)
	for {
		status, err := Status(root, receipt.ID)
		if err == nil && status.Status == "expired" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal(fmt.Sprintf("expiry unconfirmed: %+v %v", status, err))
		}
		time.Sleep(20 * time.Millisecond)
	}
}
