package community

import (
	"encoding/json"
	"html/template"
	"net/http"
	"net/url"
	"time"

	"github.com/phodal/pero/server/internal/store"
)

func (s *server) desktopConnect(w http.ResponseWriter, r *http.Request) {
	state, challenge := r.URL.Query().Get("state"), r.URL.Query().Get("code_challenge")
	if !store.ValidDesktopProof(state) || !store.ValidDesktopProof(challenge) {
		s.render(w, r, 400, page{Title: "连接已失效", View: "error", Message: "请回到 Pero Desktop，重新点击 GitHub 登录。"})
		return
	}
	session, err := s.session(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if session == nil || session.ID == 0 {
		s.cookie(w, "pero_desktop_request", url.Values{"state": {state}, "code_challenge": {challenge}}.Encode(), "/auth/github/callback", 600)
		http.Redirect(w, r, "/auth/github", 303)
		return
	}
	s.render(w, r, 200, page{Title: "连接 Pero Desktop", View: "desktop", Session: session, DesktopState: state, DesktopChallenge: challenge})
}
func (s *server) desktopAuthorize(w http.ResponseWriter, r *http.Request) {
	session, ok := s.form(w, r, false)
	if !ok {
		return
	}
	state, challenge := r.PostForm.Get("state"), r.PostForm.Get("code_challenge")
	if !store.ValidDesktopProof(state) || !store.ValidDesktopProof(challenge) {
		s.fail(w, r, store.ErrForbidden)
		return
	}
	code := random()
	grant := store.DesktopGrant{UserID: session.ID, Challenge: challenge, ExpiresAt: time.Now().Add(2 * time.Minute)}
	if err := s.db.CreateDesktopGrant(r.Context(), code, grant); err != nil {
		s.fail(w, r, err)
		return
	}
	link := "pero://connect/callback?" + url.Values{"state": {state}, "code": {code}}.Encode()
	s.render(w, r, 200, page{Title: "返回 Pero Desktop", View: "desktop", Session: session, DesktopLink: template.URL(link)})
}
func (s *server) desktopToken(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	var input struct {
		Code     string `json:"code"`
		Verifier string `json:"code_verifier"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || len(input.Code) != 64 || !store.ValidDesktopProof(input.Verifier) {
		http.Error(w, "Invalid Desktop authorization", 400)
		return
	}
	token, err := s.db.ExchangeDesktopGrant(r.Context(), input.Code, input.Verifier, time.Now())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		Token string `json:"token"`
	}{token})
}
