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

func TestIPFamilyEvidencePreservesFailClosedCriterion(t *testing.T) {
	for _, tt := range []struct {
		name      string
		addresses []string
		err       string
		allowed   bool
		scope     string
	}{
		{"IPv4 with isolated IPv6 loopback", []string{"10.244.0.2/32", "::1/128"}, "", true, "loopback"},
		{"link-local is not proof of isolation", []string{"10.244.0.2/32", "fe80::1/64"}, "", false, "link_local"},
		{"unspecified IPv6", []string{"10.244.0.2/32", "::/128"}, "", false, "unspecified"},
		{"ULA unicast", []string{"10.244.0.2/32", "fd00::1/64"}, "", false, "unicast"},
		{"global unicast", []string{"10.244.0.2/32", "2001:db8::1/64"}, "", false, "unicast"},
		{"multicast", []string{"10.244.0.2/32", "ff02::1/128"}, "", false, "multicast"},
		{"malformed address", []string{"10.244.0.2/32", "not-a-CIDR"}, "", false, "invalid"},
		{"enumeration unavailable", []string{"10.244.0.2/32"}, "netlink unavailable", false, "unicast"},
		{"empty inventory is not evidence", nil, "", false, ""},
		{"loopback alone is not evidence", []string{"127.0.0.1/8", "::1/128"}, "", false, "loopback"},
		{"unspecified IPv4 is not evidence", []string{"0.0.0.0/0"}, "", false, "unspecified"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			allowed, observed := classifyAddresses(tt.addresses, tt.err)
			if allowed != tt.allowed {
				t.Fatalf("allowed=%t want %t", allowed, tt.allowed)
			}
			if len(observed) != len(tt.addresses) {
				t.Fatal("address evidence lost")
			}
			if len(observed) > 0 && observed[len(observed)-1].Scope != tt.scope {
				t.Fatalf("scope %+v", observed)
			}
		})
	}
}

func TestIPv6RouteEvidenceProjection(t *testing.T) {
	data := []byte("00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00000001 00000000 00000000 00000003 eth0\n")
	routes, err := parseIPv6Routes(data)
	if err != nil || len(routes) != 1 {
		t.Fatal("route projection failed", err)
	}
	r := routes[0]
	if r.Destination != "::/0" || r.Source != "::/0" || r.Gateway != "fe80::1" || r.Interface != "eth0" || r.Flags != "00000003" {
		t.Fatalf("lost route fields: %+v", r)
	}
	for _, bad := range []string{"raw unexpected payload", strings.Replace(string(data), " 00 ", " ff ", 1), strings.Repeat(string(data), 129)} {
		if _, err = parseIPv6Routes([]byte(bad)); err == nil {
			t.Fatal("malformed/excess routes accepted")
		}
	}
	if queryError(&os.PathError{Op: "open", Path: "not-logged", Err: syscall.EACCES}) != "permission_denied" {
		t.Fatal("query error did not use fixed code")
	}
}
