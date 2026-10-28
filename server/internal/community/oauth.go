package community

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/phodal/pero/server/internal/store"
)

func (s *server) oauthStart(w http.ResponseWriter, r *http.Request) {
	if s.config.ClientID == "" {
		s.render(w, r, 503, page{Title: "登录暂不可用", View: "error", Message: "GitHub 登录尚未配置。可以先浏览任务和贡献榜。"})
		return
	}
	state := random()
	s.cookie(w, "pero_oauth_state", state, "/auth/github/callback", 600)
	values := url.Values{"client_id": {s.config.ClientID}, "redirect_uri": {s.config.BaseURL + "/auth/github/callback"}, "state": {state}}
	// Public GitHub identity only; no repository permissions or access-token persistence.
	http.Redirect(w, r, s.oauthAuthorize+"?"+values.Encode(), http.StatusFound)
}
func (s *server) oauthCallback(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("pero_oauth_state")
	s.cookie(w, "pero_oauth_state", "", "/auth/github/callback", -1)
	state, code := r.URL.Query().Get("state"), r.URL.Query().Get("code")
	if s.config.ClientID == "" || err != nil || len(state) != 64 || subtle.ConstantTimeCompare([]byte(state), []byte(cookie.Value)) != 1 || code == "" || len(code) > 1024 {
		s.render(w, r, 400, page{Title: "登录未完成", View: "error", Message: "GitHub 授权被取消或已过期，请从登录入口重新开始。"})
		return
	}
	values := url.Values{"client_id": {s.config.ClientID}, "client_secret": {s.config.ClientSecret}, "code": {code}, "redirect_uri": {s.config.BaseURL + "/auth/github/callback"}}
	req, err := http.NewRequestWithContext(r.Context(), "POST", s.oauthToken, strings.NewReader(values.Encode()))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err = s.oauthJSON(req, &token); err != nil || token.AccessToken == "" {
		s.render(w, r, 502, page{Title: "登录未完成", View: "error", Message: "GitHub 授权失败，请重新登录。"})
		return
	}
	req, err = http.NewRequestWithContext(r.Context(), "GET", s.oauthUser, nil)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	var user struct {
		ID    int64  `json:"id"`
		Login string `json:"login"`
	}
	if err = s.oauthJSON(req, &user); err != nil || user.ID <= 0 || !loginPattern.MatchString(user.Login) {
		s.render(w, r, 502, page{Title: "登录未完成", View: "error", Message: "无法确认 GitHub 身份，请重新登录。"})
		return
	}
	if err = s.db.CommunityUpsertUser(r.Context(), user.ID, user.Login); err != nil {
		s.fail(w, r, err)
		return
	}
	if err = s.startSession(w, r, user.ID, false); err != nil {
		s.fail(w, r, err)
		return
	}
	if pending, err := r.Cookie("pero_desktop_request"); err == nil {
		s.cookie(w, "pero_desktop_request", "", "/auth/github/callback", -1)
		values, err := url.ParseQuery(pending.Value)
		if err == nil && store.ValidDesktopProof(values.Get("state")) && store.ValidDesktopProof(values.Get("code_challenge")) {
			http.Redirect(w, r, "/connect/desktop?"+url.Values{"state": {values.Get("state")}, "code_challenge": {values.Get("code_challenge")}}.Encode(), 303)
			return
		}
	}
	http.Redirect(w, r, "/tasks", 303)
}
func (s *server) oauthJSON(req *http.Request, target any) error {
	response, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("GitHub OAuth returned status %d", response.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(target)
}
