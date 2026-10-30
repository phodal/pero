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
	Kind           string           `json:"kind"`
	AllPassed      bool             `json:"all_passed"`
	IPv4Only       bool             `json:"ipv4_only"`
	IPFamily       ipFamilyEvidence `json:"ip_family_evidence"`
	UID            int              `json:"uid"`
	GID            int              `json:"gid"`
	RuntimeVersion string           `json:"runtime_version"`
	Results        []result         `json:"results"`
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

type addressEvidence struct {
	CIDR   string `json:"cidr"`
	Family string `json:"family"`
	Scope  string `json:"scope"`
}
type interfaceEvidence struct {
	Name      string   `json:"name"`
	Flags     string   `json:"flags"`
	Addresses []string `json:"addresses"`
	Error     string   `json:"error,omitempty"`
}
type ipv6RouteEvidence struct {
	Destination string `json:"destination"`
	Source      string `json:"source"`
	Gateway     string `json:"gateway"`
	Interface   string `json:"interface"`
	Flags       string `json:"flags"`
}
type ipFamilyEvidence struct {
	Addresses        []addressEvidence   `json:"addresses"`
	EnumerationError string              `json:"enumeration_error,omitempty"`
	Interfaces       []interfaceEvidence `json:"interfaces"`
	InterfaceError   string              `json:"interface_error,omitempty"`
	IPv6Routes       []ipv6RouteEvidence `json:"ipv6_routes"`
	IPv6RoutesError  string              `json:"ipv6_routes_error,omitempty"`
}

// Keep the original fail-closed criterion. Link-local/unspecified IPv6 is not
// silently whitelisted: an address category alone proves no route isolation.
func classifyAddresses(addresses []string, enumerationError string) (bool, []addressEvidence) {
	onlyIPv4 := enumerationError == ""
	haveIPv4 := false
	observations := make([]addressEvidence, 0, len(addresses))
	for _, a := range addresses {
		e := addressEvidence{CIDR: a, Family: "unknown", Scope: "invalid"}
		ip, _, err := net.ParseCIDR(a)
		if err != nil {
			onlyIPv4 = false
			observations = append(observations, e)
			continue
		}
		e.Family = "ipv6"
		if ip.To4() != nil {
			e.Family = "ipv4"
			if !ip.IsLoopback() && !ip.IsUnspecified() && !ip.IsMulticast() {
				haveIPv4 = true
			}
		}
		switch {
		case ip.IsLoopback():
			e.Scope = "loopback"
		case ip.IsUnspecified():
			e.Scope = "unspecified"
		case ip.IsLinkLocalUnicast():
			e.Scope = "link_local"
		case ip.IsMulticast():
			e.Scope = "multicast"
		default:
			e.Scope = "unicast"
		}
		if ip.To4() == nil && !ip.IsLoopback() {
			onlyIPv4 = false
		}
		observations = append(observations, e)
	}
	return onlyIPv4 && haveIPv4, observations
}
func queryError(err error) string {
	for _, item := range []struct {
		err  error
		code string
	}{{syscall.ENOENT, "not_found"}, {syscall.EINVAL, "invalid_argument"}, {syscall.ENOSYS, "not_implemented"}, {syscall.EOPNOTSUPP, "not_supported"}, {syscall.EAFNOSUPPORT, "address_family_unsupported"}, {syscall.EPERM, "permission_denied"}, {syscall.EACCES, "permission_denied"}} {
		if errors.Is(err, item.err) {
			return item.code
		}
	}
	return "query_failed"
}
func parseIPv6Routes(data []byte) ([]ipv6RouteEvidence, error) {
	routes := []ipv6RouteEvidence{}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		f := strings.Fields(line)
		if len(f) != 10 || len(routes) >= 128 {
			return nil, errors.New("malformed_or_excess_routes")
		}
		address := func(value string) (string, error) {
			b, err := hex.DecodeString(value)
			if err != nil || len(b) != 16 {
				return "", errors.New("malformed_route_address")
			}
			return net.IP(b).String(), nil
		}
		dst, e1 := address(f[0])
		src, e2 := address(f[2])
		gateway, e3 := address(f[4])
		dstBits, e4 := strconv.ParseUint(f[1], 16, 8)
		srcBits, e5 := strconv.ParseUint(f[3], 16, 8)
		_, e6 := strconv.ParseUint(f[8], 16, 32)
		if e1 != nil || e2 != nil || e3 != nil || e4 != nil || e5 != nil || e6 != nil || dstBits > 128 || srcBits > 128 || len(f[9]) > 64 {
			return nil, errors.New("malformed_route")
		}
		routes = append(routes, ipv6RouteEvidence{fmt.Sprintf("%s/%d", dst, dstBits), fmt.Sprintf("%s/%d", src, srcBits), gateway, f[9], f[8]})
	}
	return routes, nil
}
func observeIPFamily() (bool, ipFamilyEvidence) {
	e := ipFamilyEvidence{Interfaces: []interfaceEvidence{}, IPv6Routes: []ipv6RouteEvidence{}}
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		e.EnumerationError = queryError(err)
	}
	if len(addresses) > 128 {
		e.EnumerationError = "address_limit"
		addresses = addresses[:128]
	}
	raw := make([]string, 0, len(addresses))
	for _, a := range addresses {
		raw = append(raw, a.String())
	}
	onlyIPv4, classified := classifyAddresses(raw, e.EnumerationError)
	e.Addresses = classified
	interfaces, err := net.Interfaces()
	if err != nil {
		e.InterfaceError = queryError(err)
	}
	if len(interfaces) > 64 {
		e.InterfaceError = "interface_limit"
		interfaces = interfaces[:64]
	}
	for _, iface := range interfaces {
		item := interfaceEvidence{Name: iface.Name, Flags: iface.Flags.String(), Addresses: []string{}}
		addrs, err := iface.Addrs()
		if err != nil {
			item.Error = queryError(err)
		}
		if len(addrs) > 128 {
			item.Error = "address_limit"
			addrs = addrs[:128]
		}
		for _, a := range addrs {
			item.Addresses = append(item.Addresses, a.String())
		}
		e.Interfaces = append(e.Interfaces, item)
	}
	// Fixed, bounded kernel network metadata; no arbitrary paths, raw error
	// messages, netlink payloads or process credential contents enter receipts.
	f, err := os.Open("/proc/net/ipv6_route")
	if err != nil {
		e.IPv6RoutesError = queryError(err)
	} else {
		data, readErr := io.ReadAll(io.LimitReader(f, 65537))
		_ = f.Close()
		if readErr != nil {
			e.IPv6RoutesError = queryError(readErr)
		} else if len(data) > 65536 {
			e.IPv6RoutesError = "route_byte_limit"
		} else {
			routes, parseErr := parseIPv6Routes(data)
			if parseErr != nil {
				e.IPv6RoutesError = "malformed_route_projection"
			} else {
				e.IPv6Routes = routes
			}
		}
	}
	return onlyIPv4, e
}
func probe(c config) receipt {
	version, _ := os.ReadFile("/proc/version")
	onlyIPv4, familyEvidence := observeIPFamily()
	r := receipt{Kind: "infrastructure-network-probe", AllPassed: onlyIPv4, IPv4Only: onlyIPv4, IPFamily: familyEvidence, UID: os.Getuid(), GID: os.Getgid(), RuntimeVersion: strings.TrimSpace(string(version))}
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
