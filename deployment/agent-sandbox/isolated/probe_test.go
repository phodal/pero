package main

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestProbe(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	addr := listener.Addr().String()
	r := probe(config{Targets: []target{{"allowed", addr, "tcp", true}, {"forbidden", addr, "tcp", false}}})
	if r.AllPassed || !r.Results[0].Passed || r.Results[1].Passed {
		t.Fatalf("reachable forbidden target must fail: %+v", r)
	}
}
func TestConfig(t *testing.T) {
	for _, s := range []string{`{"targets":[]}`, `{"targets":[{"name":"x","address":"127.0.0.1:http"}]}`, `{"targets":[{"name":"x","address":"127.0.0.1:65536"}]}`, `{"targets":[{"name":"x","address":"127.0.0.1:80"}]}` + strings.Repeat(" ", 16384), `{"targets":[{"name":"dns","address":"example.com:80","allow":false}]}`, `{"targets":[{"name":"x","address":"127.0.0.1:80","unknown":true}]}`, `{"targets":[{"name":"x","address":"127.0.0.1:80"},{"name":"x","address":"127.0.0.1:81"}]}`} {
		if _, err := parse(strings.NewReader(s)); err == nil {
			t.Fatalf("accepted %s", s)
		}
	}
	if _, err := parse(strings.NewReader(`{"targets":[{"name":"x","address":"127.0.0.1:80","protocol":"tcp","allow":true}]}`)); err != nil {
		t.Fatal(err)
	}
}

func TestDNSProbe(t *testing.T) {
	c, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	go func() { _ = serveDNS(c) }()
	r := probe(config{Targets: []target{{"dns-positive", c.LocalAddr().String(), "dns", true}, {"dns-forbidden", c.LocalAddr().String(), "dns", false}}})
	if r.AllPassed || !r.Results[0].Passed || r.Results[1].Passed {
		t.Fatalf("reachable forbidden DNS must fail: %+v", r)
	}
}

func TestGeneratedArtifactCannotReadSymlinksOrSpecialFiles(t *testing.T) {
	for _, kind := range []string{"regular", "symlink", "parent-symlink", "fifo"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			dir := filepath.Join(root, "repo", "artifacts")
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			outside := filepath.Join(root, "unrelated")
			if err := os.WriteFile(outside, []byte("must-not-read"), 0600); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(dir, "generated.txt")
			var err error
			switch kind {
			case "regular":
				err = os.WriteFile(file, []byte("synthetic"), 0600)
			case "symlink":
				err = os.Symlink(outside, file)
			case "fifo":
				err = syscall.Mkfifo(file, 0600)
			case "parent-symlink":
				if err = os.Remove(dir); err == nil {
					err = os.Symlink(root, dir)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			data, err := readGenerated(root)
			if kind == "regular" {
				if err != nil || string(data) != "synthetic" {
					t.Fatal("regular fixture rejected", err)
				}
			} else if err == nil {
				t.Fatal("unsafe generated path accepted")
			}
		})
	}
}
