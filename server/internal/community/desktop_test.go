package community

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"html"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestDesktopAuthorization(t *testing.T) {
	f := communityHTTP(t)
	ctx := context.Background()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 5 * time.Second}
	verifier := strings.Repeat("a", 43)
	digest := sha256.Sum256([]byte(verifier))
	query := url.Values{"state": {strings.Repeat("s", 43)}, "code_challenge": {base64.RawURLEncoding.EncodeToString(digest[:])}}
	status, body := fetch(t, client, "GET", f.app.URL+"/connect/desktop?"+query.Encode(), "", nil)
	if status != 200 || !strings.Contains(body, "以 <strong>alice</strong>") {
		t.Fatalf("browser OAuth continuation: %d %s", status, body)
	}
	origin, _ := url.Parse(f.app.URL)
	var sessionToken string
	for _, c := range jar.Cookies(origin) {
		if c.Name == "pero_community" {
			sessionToken = c.Value
		}
	}
	session, err := f.db.CommunitySession(ctx, sessionToken)
	if err != nil {
		t.Fatal(err)
	}
	form := url.Values{"csrf": {session.CSRF}, "state": {query.Get("state")}, "code_challenge": {query.Get("code_challenge")}}
	status, _ = fetch(t, client, "POST", f.app.URL+"/connect/desktop", "https://other.example", form)
	if status != 403 {
		t.Fatalf("cross-origin authorization: %d", status)
	}
	status, body = fetch(t, client, "POST", f.app.URL+"/connect/desktop", f.app.URL, form)
	match := regexp.MustCompile(`href="(pero://connect/callback[^" ]+)"`).FindStringSubmatch(body)
	if status != 200 || len(match) != 2 {
		t.Fatalf("return link: %d %s", status, body)
	}
	link, _ := url.Parse(html.UnescapeString(match[1]))
	if link.Query().Get("state") != query.Get("state") || strings.Contains(body, "secret_") {
		t.Fatal("invalid return link")
	}
	exchange := func(proof string) (int, string) {
		input, _ := json.Marshal(struct {
			Code     string `json:"code"`
			Verifier string `json:"code_verifier"`
		}{link.Query().Get("code"), proof})
		res, err := client.Post(f.app.URL+"/auth/desktop/token", "application/json", strings.NewReader(string(input)))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		output, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(output)
	}
	status, _ = exchange(strings.Repeat("b", 43))
	if status != 403 {
		t.Fatalf("other Desktop: %d", status)
	}
	status, body = exchange(verifier)
	var credential struct {
		Token string `json:"token"`
	}
	if status != 200 || json.Unmarshal([]byte(body), &credential) != nil {
		t.Fatalf("exchange: %d", status)
	}
	identity, err := f.db.AuthenticateClient(ctx, credential.Token)
	if err != nil || identity.Name != "alice" || len(identity.Projects) != 0 {
		t.Fatalf("unprovisioned identity: %+v %v", identity, err)
	}
	if err = f.db.CommunityBindWorker(ctx, f.workerID, "alice"); err != nil {
		t.Fatal(err)
	}
	identity, err = f.db.AuthenticateClient(ctx, credential.Token)
	if err != nil || len(identity.Projects) != 1 || identity.Projects[0] != "pero" {
		t.Fatalf("operator-owned scope: %+v %v", identity, err)
	}
	status, _ = exchange(verifier)
	if status != 403 {
		t.Fatalf("replayed grant: %d", status)
	}
}
