// Package s3 implements one private, path-style S3-compatible artifact backend.
// It uses conditional single-object PUT and verified GET; there is no multipart,
// public URL, bucket provisioning, overwrite, or deletion API. Immutability is
// application-level, not a claim of ObjectLock or resistance to bucket admins.
package s3

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
)

var ErrUnavailable = errors.New("artifact object storage unavailable")
var keyPattern = regexp.MustCompile(`^projects/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}/runs/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}/g[1-9][0-9]*/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}/[a-f0-9]{64}/[a-f0-9]{64}$`)
var bucketPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
var regionPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// Config is trusted composition only. Credentials must never be placed in an
// Agent Pod, manifest, URL, or error message. LoopbackHTTP is only for fixtures.
type Config struct {
	Endpoint, Bucket, Region, AccessKey, SecretKey string
	LoopbackHTTP                                   bool
}
type Store struct {
	endpoint                             *url.URL
	bucket, region, accessKey, secretKey string
	client                               *http.Client
	now                                  func() time.Time
}

func New(c Config) (*Store, error) {
	u, err := url.Parse(c.Endpoint)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || !bucketPattern.MatchString(c.Bucket) || !regionPattern.MatchString(c.Region) || len(c.AccessKey) < 1 || len(c.AccessKey) > 128 || strings.ContainsAny(c.AccessKey, " /\t\r\n") || len(c.SecretKey) < 1 || len(c.SecretKey) > 512 {
		return nil, artifacts.ErrInvalid
	}
	if u.Scheme != "https" {
		ip := net.ParseIP(u.Hostname())
		if u.Scheme != "http" || !c.LoopbackHTTP || ip == nil || !ip.IsLoopback() {
			return nil, artifacts.ErrInvalid
		}
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil // never leak storage credentials into an inherited proxy
	transport.MaxResponseHeaderBytes = 32 << 10
	transport.DisableCompression = true
	client := &http.Client{Transport: transport, Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &Store{endpoint: u, bucket: c.Bucket, region: c.Region, accessKey: c.AccessKey, secretKey: c.SecretKey, client: client, now: time.Now}, nil
}

func validEntry(e artifacts.Entry) bool {
	return e.Bytes >= 0 && e.Bytes <= artifacts.MaxFileBytes && len(e.SHA256) == 71 && strings.HasPrefix(e.SHA256, "sha256:") && keyPattern.MatchString(e.ObjectKey) && strings.HasSuffix(e.ObjectKey, "/"+strings.TrimPrefix(e.SHA256, "sha256:")) && e.ID == artifacts.EntryID(e.Path) && artifacts.ValidatePath(e.Path) == nil
}

func (s *Store) Put(ctx context.Context, e artifacts.Entry, source io.Reader) error {
	if !validEntry(e) || source == nil {
		return artifacts.ErrInvalid
	}
	data, err := io.ReadAll(io.LimitReader(source, e.Bytes+1))
	if err != nil {
		return err
	}
	if !matches(e, data) {
		return artifacts.ErrConflict
	}
	req, err := s.request(ctx, http.MethodPut, e.ObjectKey, data)
	if err != nil {
		return err
	}
	req.Header.Set("If-None-Match", "*")
	hash := sha256.Sum256(data)
	req.Header.Set("X-Amz-Checksum-Sha256", base64.StdEncoding.EncodeToString(hash[:]))
	s.sign(req, hex.EncodeToString(hash[:]))
	response, sendErr := s.client.Do(req)
	if sendErr == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
		_ = response.Body.Close()
		if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated && response.StatusCode != http.StatusPreconditionFailed {
			return fmt.Errorf("%w: PUT status %d", ErrUnavailable, response.StatusCode)
		}
	}
	// A lost reply or 412 is not a new write. Read the original immutable key and
	// verify exact bytes. A backend's ETag is never treated as a SHA-256 receipt.
	_, err = s.Read(ctx, e)
	if err != nil {
		return err
	}
	return nil
}

func (s *Store) Read(ctx context.Context, e artifacts.Entry) ([]byte, error) {
	if !validEntry(e) {
		return nil, artifacts.ErrInvalid
	}
	req, err := s.request(ctx, http.MethodGet, e.ObjectKey, nil)
	if err != nil {
		return nil, err
	}
	s.sign(req, hexHash(nil))
	response, err := s.client.Do(req)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: GET status %d", ErrUnavailable, response.StatusCode)
	}
	if response.ContentLength > e.Bytes {
		return nil, artifacts.ErrConflict
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, e.Bytes+1))
	if err != nil {
		return nil, ErrUnavailable
	}
	if !matches(e, data) {
		return nil, artifacts.ErrConflict
	}
	return data, nil
}

func matches(e artifacts.Entry, data []byte) bool {
	return int64(len(data)) == e.Bytes && "sha256:"+hexHash(data) == e.SHA256
}
func hexHash(data []byte) string { h := sha256.Sum256(data); return hex.EncodeToString(h[:]) }
func (s *Store) request(ctx context.Context, method, key string, data []byte) (*http.Request, error) {
	u := *s.endpoint
	u.Path = "/" + s.bucket + "/" + key
	u.RawPath = ""
	return http.NewRequestWithContext(ctx, method, u.String(), bytes.NewReader(data))
}

// sign implements the fixed S3 AWS Signature Version 4 header protocol using
// standard-library SHA-256/HMAC. No credential discovery or signing URLs.
func (s *Store) sign(req *http.Request, payloadHash string) {
	now := s.now().UTC()
	date := now.Format("20060102")
	stamp := now.Format("20060102T150405Z")
	req.Header.Set("X-Amz-Date", stamp)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	headers := map[string]string{"host": req.URL.Host}
	for key, values := range req.Header {
		lower := strings.ToLower(key)
		if strings.HasPrefix(lower, "x-amz-") || lower == "if-none-match" || lower == "range" {
			headers[lower] = strings.Join(strings.Fields(strings.Join(values, ",")), " ")
		}
	}
	names := make([]string, 0, len(headers))
	for name := range headers {
		names = append(names, name)
	}
	sort.Strings(names)
	var canonical strings.Builder
	for _, name := range names {
		canonical.WriteString(name + ":" + headers[name] + "\n")
	}
	signed := strings.Join(names, ";")
	request := req.Method + "\n" + req.URL.EscapedPath() + "\n" + req.URL.Query().Encode() + "\n" + canonical.String() + "\n" + signed + "\n" + payloadHash
	scope := date + "/" + s.region + "/s3/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + stamp + "\n" + scope + "\n" + hexHash([]byte(request))
	key := mac([]byte("AWS4"+s.secretKey), date)
	key = mac(key, s.region)
	key = mac(key, "s3")
	key = mac(key, "aws4_request")
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+s.accessKey+"/"+scope+", SignedHeaders="+signed+", Signature="+hex.EncodeToString(mac(key, toSign)))
}
func mac(key []byte, value string) []byte {
	h := hmac.New(sha256.New, key)
	_, _ = h.Write([]byte(value))
	return h.Sum(nil)
}
