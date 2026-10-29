// CI-only network canary. It never reads credentials or performs application work.
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
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type target struct {
	Name     string `json:"name"`
	Address  string `json:"address"`
	Protocol string `json:"protocol"`
	Allow    bool   `json:"allow"`
}
type config struct {
	Targets []target `json:"targets"`
}
type result struct {
	Name          string `json:"name"`
	Address       string `json:"address"`
	Protocol      string `json:"protocol"`
	ExpectedAllow bool   `json:"expected_allow"`
	Connected     bool   `json:"connected"`
	Passed        bool   `json:"passed"`
}
type receipt struct {
	Kind           string   `json:"kind"`
	AllPassed      bool     `json:"all_passed"`
	IPv4Only       bool     `json:"ipv4_only"`
	UID            int      `json:"uid"`
	GID            int      `json:"gid"`
	RuntimeVersion string   `json:"runtime_version"`
	Results        []result `json:"results"`
}

func parse(input io.Reader) (config, error) {
	var c config
	data, err := io.ReadAll(io.LimitReader(input, 16385))
	if err != nil {
		return c, err
	}
	if len(data) > 16384 {
		return c, errors.New("oversized config")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return c, err
	}
	if d.Decode(new(any)) != io.EOF {
		return c, errors.New("trailing or oversized config")
	}
	if len(c.Targets) < 1 || len(c.Targets) > 16 {
		return c, errors.New("expected 1..16 targets")
	}
	seen := map[string]bool{}
	for _, t := range c.Targets {
		host, port, err := net.SplitHostPort(t.Address)
		portNumber, portErr := strconv.Atoi(port)
		if err != nil || net.ParseIP(host) == nil || portErr != nil || portNumber < 1 || portNumber > 65535 || len(t.Name) < 1 || len(t.Name) > 64 || seen[t.Name] || (t.Protocol != "tcp" && t.Protocol != "dns") {
			return c, errors.New("targets require unique names and literal IP:port addresses")
		}
		seen[t.Name] = true
	}
	return c, nil
}

// One synthetic DNS NXDOMAIN response proves UDP reachability without recursive
// DNS, an external resolver, or a public query. No supplied domain is resolved.
var dnsQuery = []byte{0x50, 0x45, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 7, 'f', 'i', 'x', 't', 'u', 'r', 'e', 7, 'i', 'n', 'v', 'a', 'l', 'i', 'd', 0, 0, 1, 0, 1}

func dnsResponse(q []byte) []byte {
	if !bytes.Equal(q, dnsQuery) {
		return nil
	}
	out := append([]byte(nil), q...)
	out[2] = 0x81
	out[3] = 0x83
	return out
}
func serveDNS(c net.PacketConn) error {
	buf := make([]byte, 512)
	for {
		n, addr, err := c.ReadFrom(buf)
		if err != nil {
			return err
		}
		if r := dnsResponse(buf[:n]); r != nil {
			if _, err = c.WriteTo(r, addr); err != nil {
				return err
			}
		}
	}
}
func ipv4Only() bool {
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, a := range addresses {
		ip, _, err := net.ParseCIDR(a.String())
		if err != nil {
			return false
		}
		if ip.To4() == nil && !ip.IsLoopback() {
			return false
		}
	}
	return true
}
func probe(c config) receipt {
	version, _ := os.ReadFile("/proc/version")
	onlyIPv4 := ipv4Only()
	r := receipt{Kind: "infrastructure-network-probe", AllPassed: onlyIPv4, IPv4Only: onlyIPv4, UID: os.Getuid(), GID: os.Getgid(), RuntimeVersion: strings.TrimSpace(string(version))}
	for _, t := range c.Targets {
		// A first successful forbidden connection is a failure. Never retry it away.
		protocol := t.Protocol
		if protocol == "dns" {
			protocol = "udp"
		}
		conn, err := net.DialTimeout(protocol, t.Address, 2*time.Second)
		connected := err == nil
		if conn != nil {
			if t.Protocol == "dns" {
				_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
				_, err = conn.Write(dnsQuery)
				if err == nil {
					buf := make([]byte, 512)
					var n int
					n, err = conn.Read(buf)
					connected = err == nil && bytes.Equal(buf[:n], dnsResponse(dnsQuery))
				} else {
					connected = false
				}
			}
			_ = conn.Close()
		}
		passed := connected == t.Allow
		r.Results = append(r.Results, result{t.Name, t.Address, t.Protocol, t.Allow, connected, passed})
		r.AllPassed = r.AllPassed && passed
	}
	return r
}

// Traverse fixed components without following either ancestor or final symlinks.
// O_NONBLOCK and regular-file fstat keep a swapped FIFO/device from hanging or
// turning this bounded fixture read into credential/device instrumentation.
func readGenerated(root string) ([]byte, error) {
	fd, err := syscall.Open(root, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	for _, name := range []string{"repo", "artifacts"} {
		next, openErr := syscall.Openat(fd, name, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
		_ = syscall.Close(fd)
		if openErr != nil {
			return nil, openErr
		}
		fd = next
	}
	fileFD, err := syscall.Openat(fd, "generated.txt", syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	_ = syscall.Close(fd)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fileFD), "generated.txt")
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !stat.Mode().IsRegular() || stat.Size() > 4096 {
		return nil, errors.New("invalid generated artifact type/size")
	}
	return io.ReadAll(io.LimitReader(file, 4097))
}

func run() error {
	mode := flag.String("mode", "probe", "probe or serve")
	path := flag.String("config", "", "bounded probe JSON file")
	inline := flag.String("config-json", "", "bounded synthetic config for host-only fixture exec")
	address := flag.String("listen", ":8080", "synthetic fixture listener")
	flag.Parse()
	if flag.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	if *mode == "artifact" {
		data, err := readGenerated("/workspace")
		if err != nil || len(data) > 4096 {
			return errors.New("invalid synthetic artifact")
		}
		var a struct {
			RunID string `json:"run_id"`
			Nonce string `json:"nonce"`
		}
		d := json.NewDecoder(bytes.NewReader(data))
		d.DisallowUnknownFields()
		if err = d.Decode(&a); err != nil {
			return err
		}
		nonce, err := hex.DecodeString(a.Nonce)
		if err != nil || len(nonce) != 32 || a.RunID == "" {
			return errors.New("invalid generated artifact identity")
		}
		hash := sha256.Sum256(data)
		return json.NewEncoder(os.Stdout).Encode(struct {
			RunID  string `json:"run_id"`
			Nonce  string `json:"nonce"`
			SHA256 string `json:"sha256"`
			Bytes  int    `json:"bytes"`
		}{a.RunID, a.Nonce, fmt.Sprintf("sha256:%x", hash), len(data)})
	}
	if *mode == "serve" {
		mux := http.NewServeMux()
		mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "synthetic-fixture\n") })
		server := &http.Server{Addr: *address, Handler: mux, ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 3 * time.Second, WriteTimeout: 3 * time.Second, IdleTimeout: 3 * time.Second}
		udp, err := net.ListenPacket("udp", ":18053")
		if err != nil {
			return err
		}
		defer udp.Close()
		defer server.Close()
		done := make(chan error, 2)
		go func() { done <- serveDNS(udp) }()
		go func() { done <- server.ListenAndServe() }()
		return <-done
	}
	if *mode != "probe" || (*path == "") == (*inline == "") {
		return errors.New("probe requires exactly one config source")
	}
	var input io.Reader = strings.NewReader(*inline)
	if *path != "" {
		file, err := os.Open(*path)
		if err != nil {
			return err
		}
		defer file.Close()
		input = file
	}
	c, err := parse(input)
	if err != nil {
		return err
	}
	r := probe(c)
	if err = json.NewEncoder(os.Stdout).Encode(r); err != nil {
		return err
	}
	if !r.AllPassed {
		return errors.New("network expectation failed")
	}
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
