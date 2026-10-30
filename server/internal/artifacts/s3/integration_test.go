package s3

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// This test is explicitly opt-in and targets only the disposable fixture's
// synthetic private bucket. Production MinIO/S3 configuration is not inferred.
func TestS3RealConditionalWriteConformance(t *testing.T) {
	endpoint := os.Getenv("PERO_TEST_S3_ENDPOINT")
	if endpoint == "" {
		if os.Getenv("PERO_REQUIRE_TEST_S3") == "1" {
			t.Fatal("PERO_TEST_S3_ENDPOINT required")
		}
		t.Skip("set disposable S3 fixture configuration")
	}
	readKey := func(name string) string {
		t.Helper()
		path := os.Getenv(name)
		f, err := os.Open(path)
		if err != nil {
			t.Fatal("synthetic key file unavailable")
		}
		defer f.Close()
		b, err := io.ReadAll(io.LimitReader(f, 1025))
		if err != nil || len(b) > 1024 {
			t.Fatal("invalid synthetic key file")
		}
		return strings.TrimSpace(string(b))
	}
	s, err := New(Config{Endpoint: endpoint, Bucket: os.Getenv("PERO_TEST_S3_BUCKET"), Region: "us-east-1", AccessKey: readKey("PERO_TEST_S3_ACCESS_KEY_FILE"), SecretKey: readKey("PERO_TEST_S3_SECRET_KEY_FILE"), LoopbackHTTP: true})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// The fixture supplies a fresh bucket name; bucket setup is test-only.
	u := *s.endpoint
	u.Path = "/" + s.bucket
	req, _ := http.NewRequestWithContext(ctx, http.MethodPut, u.String(), nil)
	s.sign(req, hexHash(nil))
	response, err := s.client.Do(req)
	if err != nil {
		t.Fatal("create synthetic bucket failed")
	}
	_ = response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("fresh bucket creation status %d", response.StatusCode)
	}
	data := []byte("synthetic artifact\n")
	e := entry(data)
	if err = s.Put(ctx, e, bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}
	// Bypass the application's digest guard ONLY to verify the actual backend
	// refuses a conditional overwrite with different bytes at the same key.
	bad := []byte("must not overwrite\n")
	req, _ = s.request(ctx, http.MethodPut, e.ObjectKey, bad)
	req.Header.Set("If-None-Match", "*")
	s.sign(req, hexHash(bad))
	response, err = s.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("backend does not enforce If-None-Match: %d", response.StatusCode)
	}
	if got, err := s.Read(ctx, e); err != nil || !bytes.Equal(got, data) {
		t.Fatal("conditional overwrite changed original object", err)
	}
	if err = s.Put(ctx, e, bytes.NewReader(data)); err != nil {
		t.Fatal("original operation replay", err)
	}
	t.Log("real S3-compatible backend: conditional overwrite rejected; original SHA-256/size and identical replay verified")
}
