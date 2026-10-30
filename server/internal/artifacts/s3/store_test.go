package s3

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
)

func entry(data []byte) artifacts.Entry {
	s := artifacts.Source{ProjectID: "p", RunID: "r", Generation: 1}
	e := artifacts.Entry{ID: artifacts.EntryID("result.txt"), Path: "result.txt", Bytes: int64(len(data)), SHA256: "sha256:" + hexHash(data)}
	e.ObjectKey = artifacts.ObjectKey(s, "export", e.Path, e.SHA256)
	return e
}

func TestS3ConditionalWriteReceiptAndIntegrity(t *testing.T) {
	var mu sync.Mutex
	var stored []byte
	puts := 0
	loseReply := true
	corrupt := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=synthetic/") || r.Header.Get("X-Amz-Date") == "" || r.Header.Get("X-Amz-Content-Sha256") == "" {
			t.Error("request is not signed")
			w.WriteHeader(403)
			return
		}
		if r.Method == http.MethodPut {
			puts++
			if r.Header.Get("If-None-Match") != "*" || r.Header.Get("X-Amz-Checksum-Sha256") == "" {
				t.Error("missing conditional/integrity header")
				w.WriteHeader(400)
				return
			}
			if stored != nil {
				w.WriteHeader(412)
				return
			}
			stored, _ = io.ReadAll(r.Body)
			if loseReply {
				loseReply = false
				conn, _, err := w.(http.Hijacker).Hijack()
				if err != nil {
					t.Error(err)
				} else {
					_ = conn.Close()
				}
				return
			}
			w.WriteHeader(200)
			return
		}
		if stored == nil {
			w.WriteHeader(404)
			return
		}
		w.Header().Set("ETag", "not-a-sha256")
		if corrupt {
			_, _ = w.Write([]byte("wrong!"))
			return
		}
		_, _ = w.Write(stored)
	}))
	defer server.Close()
	s, err := New(Config{Endpoint: server.URL, Bucket: "artifacts", Region: "us-east-1", AccessKey: "synthetic", SecretKey: "synthetic-secret", LoopbackHTTP: true})
	if err != nil {
		t.Fatal(err)
	}
	data := []byte("result")
	e := entry(data)
	if err = s.Put(context.Background(), e, bytes.NewReader(data)); err != nil {
		t.Fatal("lost PUT reply not reconciled", err)
	}
	if err = s.Put(context.Background(), e, bytes.NewReader(data)); err != nil {
		t.Fatal("412 identical original object not reconciled", err)
	}
	if got, err := s.Read(context.Background(), e); err != nil || !bytes.Equal(got, data) {
		t.Fatal("read", err)
	}
	if err = s.Put(context.Background(), e, strings.NewReader("changed")); err == nil {
		t.Fatal("mismatched bytes uploaded")
	}
	mu.Lock()
	if puts != 2 {
		t.Errorf("wrong writes: %d", puts)
	}
	corrupt = true
	mu.Unlock()
	if _, err = s.Read(context.Background(), e); err == nil {
		t.Fatal("object corruption accepted")
	}
}

func TestS3ConfigurationAndRedirectBoundary(t *testing.T) {
	good := Config{Endpoint: "https://objects.example.invalid", Bucket: "artifacts", Region: "us-east-1", AccessKey: "synthetic", SecretKey: "secret"}
	for _, change := range []func(*Config){func(c *Config) { c.Endpoint = "http://objects.example.invalid"; c.LoopbackHTTP = true }, func(c *Config) { c.Endpoint = "https://user:secret@objects.example.invalid" }, func(c *Config) { c.Endpoint += "/prefix" }, func(c *Config) { c.Endpoint += "?token=secret" }, func(c *Config) { c.Bucket = "../bucket" }, func(c *Config) { c.Region = "x/../y" }} {
		c := good
		change(&c)
		if _, err := New(c); err == nil {
			t.Fatalf("unsafe config accepted: endpoint=%s", c.Endpoint)
		}
	}
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("redirect leaked a signed request") }))
	defer destination.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, 307) }))
	defer redirect.Close()
	c := good
	c.Endpoint = redirect.URL
	c.LoopbackHTTP = true
	s, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Read(context.Background(), entry([]byte("result"))); err == nil {
		t.Fatal("redirect accepted")
	}
	e := entry([]byte("result"))
	e.ObjectKey = "https://outside.invalid/secret"
	if _, err = s.Read(context.Background(), e); err == nil {
		t.Fatal("external object key accepted")
	}
}

func TestS3SigningCanonicalHeaders(t *testing.T) {
	s, err := New(Config{Endpoint: "https://objects.example.invalid", Bucket: "artifacts", Region: "us-east-1", AccessKey: "synthetic", SecretKey: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC) }
	r, _ := s.request(context.Background(), http.MethodPut, entry([]byte("result")).ObjectKey, []byte("result"))
	r.Header.Set("If-None-Match", "*")
	s.sign(r, hexHash([]byte("result")))
	if !strings.Contains(r.Header.Get("Authorization"), "SignedHeaders=host;if-none-match;x-amz-content-sha256;x-amz-date") || r.Header.Get("X-Amz-Date") != "20261029T120000Z" {
		t.Fatal("unstable canonical headers")
	}
	before := r.Header.Get("Authorization")
	s.sign(r, hexHash([]byte("result")))
	if before != r.Header.Get("Authorization") {
		t.Fatal("signing replay changed")
	}
}

// AWS publishes this vector for validating SigV4 implementations. These are
// documented example credentials, not a live account or a network request.
// https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
func TestS3PublishedSigningVector(t *testing.T) {
	s, err := New(Config{Endpoint: "https://examplebucket.s3.amazonaws.com", Bucket: "examplebucket", Region: "us-east-1", AccessKey: "AKIAIOSFODNN7EXAMPLE", SecretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"})
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC) }
	r, err := http.NewRequest(http.MethodGet, "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Range", "bytes=0-9")
	s.sign(r, hexHash(nil))
	want := "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if !strings.HasSuffix(r.Header.Get("Authorization"), "Signature="+want) {
		t.Fatalf("published signing vector mismatch: %s", r.Header.Get("Authorization"))
	}
}
