// Package community serves the public contribution surface alongside the existing API.
package community

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/phodal/pero/server/internal/store"
)

//go:embed templates/*.html assets/*
var files embed.FS
var loginPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$`)

type Config struct{ BaseURL, ClientID, ClientSecret string }

func FromEnv() Config {
	return Config{os.Getenv("PERO_PUBLIC_URL"), os.Getenv("PERO_GITHUB_CLIENT_ID"), os.Getenv("PERO_GITHUB_CLIENT_SECRET")}
}

type server struct {
	db                                    *store.Store
	config                                Config
	tokenHash                             [32]byte
	templates                             *template.Template
	client                                *http.Client
	oauthAuthorize, oauthToken, oauthUser string
}
type page struct {
	Title, View, Period, Login, Message string
	DesktopState, DesktopChallenge      string
	DesktopLink                         template.URL
	Session                             *store.CommunitySession
	OAuth                               bool
	Tasks                               []store.PublicTask
	Task                                store.PublicTask
	Workers                             []store.Worker
	Drafts                              []store.Task
	Ranks                               []store.CommunityRank
	History                             []store.PointEntry
	Offset, Next, Previous              int
	More                                bool
}

func Handler(db *store.Store, token string, config Config, fallback http.Handler) (http.Handler, error) {
	s, err := newServer(db, token, config)
	if err != nil {
		return nil, err
	}
	return s.routes(fallback), nil
}
func newServer(db *store.Store, token string, config Config) (*server, error) {
	if config.BaseURL == "" {
		config.BaseURL = "http://127.0.0.1:8787"
	}
	config.BaseURL = strings.TrimRight(config.BaseURL, "/")
	u, err := url.Parse(config.BaseURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		return nil, fmt.Errorf("PERO_PUBLIC_URL must be an origin without a path")
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return nil, fmt.Errorf("PERO_PUBLIC_URL requires HTTPS outside loopback")
	}
	if (config.ClientID == "") != (config.ClientSecret == "") {
		return nil, fmt.Errorf("both GitHub OAuth client variables are required")
	}
	tpl, err := template.New("pages").Funcs(template.FuncMap{
		"state": taskState,
		"rank":  func(i int) int { return i + 1 },
		"date":  func(t time.Time) string { return t.UTC().Format("2006-01-02 15:04 UTC") },
	}).ParseFS(files, "templates/*.html")
	if err != nil {
		return nil, err
	}
	s := &server{db: db, config: config, tokenHash: sha256.Sum256([]byte(token)), templates: tpl, client: &http.Client{Timeout: 10 * time.Second}, oauthAuthorize: "https://github.com/login/oauth/authorize", oauthToken: "https://github.com/login/oauth/access_token", oauthUser: "https://api.github.com/user"}
	return s, nil
}
func (s *server) routes(fallback http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/tasks", http.StatusSeeOther) })
	mux.HandleFunc("GET /tasks", s.board)
	mux.HandleFunc("GET /tasks/{id}", s.task)
	mux.HandleFunc("POST /tasks/{id}/claim", s.claim)
	mux.HandleFunc("GET /leaderboard", s.leaderboard)
	mux.HandleFunc("GET /contributors/{login}", s.contributor)
	mux.HandleFunc("GET /auth/github", s.oauthStart)
	mux.HandleFunc("GET /auth/github/callback", s.oauthCallback)
	mux.HandleFunc("POST /auth/logout", s.logout)
	mux.HandleFunc("GET /connect/desktop", s.desktopConnect)
	mux.HandleFunc("POST /connect/desktop", s.desktopAuthorize)
	mux.HandleFunc("POST /auth/desktop/token", s.desktopToken)
	mux.HandleFunc("GET /community/admin/login", s.operatorLoginPage)
	mux.HandleFunc("POST /community/admin/login", s.operatorLogin)
	mux.HandleFunc("GET /community/admin", s.admin)
	mux.HandleFunc("POST /community/admin/publish", s.publish)
	mux.HandleFunc("POST /community/admin/bind-worker", s.bind)
	mux.HandleFunc("POST /community/admin/accept", s.accept)
	mux.HandleFunc("POST /community/admin/reverse", s.reverse)
	mux.Handle("GET /community/assets/", http.StripPrefix("/community/", http.FileServer(http.FS(files))))
	mux.Handle("/", fallback)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// API routes keep their existing independent authentication and timeout middleware.
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
			fallback.ServeHTTP(w, r)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
		mux.ServeHTTP(w, r)
	})
}
func taskState(t store.PublicTask) string {
	if t.Accepted {
		return "已验收"
	}
	switch t.State {
	case "draft":
		return "待认领"
	case "revoked":
		return "验收已撤销"
	case "closed":
		return "来源已关闭"
	case "source_changed":
		return "来源已更新"
	case "reserved":
		return "已认领"
	case "queued":
		return "排队中"
	case "running":
		return "执行中"
	case "succeeded":
		return "待验收"
	case "failed":
		return "执行失败"
	case "cancelled":
		return "已取消"
	case "cancel_requested":
		return "停止中"
	default:
		return "需要核对"
	}
}
func random() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func (s *server) cookie(w http.ResponseWriter, name, value, path string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: path, MaxAge: maxAge, HttpOnly: true, Secure: strings.HasPrefix(s.config.BaseURL, "https://"), SameSite: http.SameSiteLaxMode})
}
func (s *server) session(r *http.Request) (*store.CommunitySession, error) {
	c, err := r.Cookie("pero_community")
	if err != nil {
		return nil, nil
	}
	session, err := s.db.CommunitySession(r.Context(), c.Value)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	return session, err
}
func (s *server) render(w http.ResponseWriter, r *http.Request, status int, p page) {
	var err error
	if p.Session == nil {
		p.Session, err = s.session(r)
		if err != nil {
			s.fail(w, r, err)
			return
		}
	}
	p.OAuth = s.config.ClientID != ""
	p.Next = p.Offset + 50
	p.Previous = p.Offset - 50
	if p.Previous < 0 {
		p.Previous = 0
	}
	// Render before writing headers so template failures are recoverable.
	var body strings.Builder
	if err = s.templates.ExecuteTemplate(&body, "layout", p); err != nil {
		log.Printf("community template: %v", err)
		http.Error(w, "页面暂时不可用，请重试。", 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = fmt.Fprint(w, body.String())
}
func (s *server) fail(w http.ResponseWriter, r *http.Request, err error) {
	status, message := 503, "服务暂时不可用，请稍后重试。"
	switch {
	case errors.Is(err, store.ErrNotFound):
		status, message = 404, "未找到该任务或公开记录。"
	case errors.Is(err, store.ErrConflict):
		status, message = 409, "任务状态已变化，或该记录已存在。请刷新页面后重试。"
	case errors.Is(err, store.ErrForbidden):
		status, message = 403, "无法使用该 Worker，或请求验证已失效。请重新登录。"
	default:
		log.Printf("community request: %v", err)
	}
	// Avoid recursively looking up sessions when the database is unavailable.
	s.render(w, r, status, page{Title: "需要处理", View: "error", Message: message, Session: &store.CommunitySession{}})
}
func offset(r *http.Request) (int, error) {
	raw := r.URL.Query().Get("offset")
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 || n > 100000 || n%50 != 0 {
		return 0, store.ErrNotFound
	}
	return n, nil
}
func (s *server) board(w http.ResponseWriter, r *http.Request) {
	n, err := offset(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	tasks, more, err := s.db.CommunityTasks(r.Context(), n)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.render(w, r, 200, page{Title: "任务广场", View: "board", Tasks: tasks, Offset: n, More: more})
}
func (s *server) task(w http.ResponseWriter, r *http.Request) {
	t, err := s.db.CommunityTask(r.Context(), r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	session, err := s.session(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var workers []store.Worker
	if session != nil && !session.Operator {
		workers, err = s.db.CommunityOwnedWorkers(r.Context(), session.ID, t.Project)
		if err != nil {
			s.fail(w, r, err)
			return
		}
	}
	history, _, err := s.db.CommunityHistory(r.Context(), "", t.ID, 0)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.render(w, r, 200, page{Title: t.Title, View: "task", Task: t, Session: session, Workers: workers, History: history})
}
func (s *server) leaderboard(w http.ResponseWriter, r *http.Request) {
	period := r.URL.Query().Get("period")
	if period == "" {
		period = "week"
	}
	if period != "week" && period != "all" {
		s.fail(w, r, store.ErrNotFound)
		return
	}
	since := time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC)
	if period == "week" {
		now := time.Now().UTC()
		since = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -(int(now.Weekday())+6)%7)
	}
	ranks, err := s.db.CommunityLeaderboard(r.Context(), since)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.render(w, r, 200, page{Title: "贡献榜", View: "leaderboard", Ranks: ranks, Period: period})
}
func (s *server) contributor(w http.ResponseWriter, r *http.Request) {
	login := r.PathValue("login")
	if !loginPattern.MatchString(login) {
		s.fail(w, r, store.ErrNotFound)
		return
	}
	n, err := offset(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	entries, more, err := s.db.CommunityHistory(r.Context(), login, "", n)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.render(w, r, 200, page{Title: login + " 的贡献", Login: login, View: "contributor", History: entries, More: more, Offset: n})
}

// All mutations require the configured origin; authenticated forms also require a session CSRF token.
func (s *server) form(w http.ResponseWriter, r *http.Request, operator bool) (*store.CommunitySession, bool) {
	if r.Header.Get("Origin") != s.config.BaseURL {
		s.fail(w, r, store.ErrForbidden)
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "表单过大或格式错误。", 400)
		return nil, false
	}
	session, err := s.session(r)
	if err != nil {
		s.fail(w, r, err)
		return nil, false
	}
	if session == nil || session.Operator != operator || subtle.ConstantTimeCompare([]byte(session.CSRF), []byte(r.PostForm.Get("csrf"))) != 1 {
		s.fail(w, r, store.ErrForbidden)
		return nil, false
	}
	return session, true
}
func validText(value string, max int) bool {
	return strings.TrimSpace(value) != "" && len([]rune(value)) <= max && !strings.ContainsRune(value, 0)
}
func validLink(value string) bool {
	u, err := url.Parse(value)
	return len(value) <= 2048 && err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil
}
func (s *server) claim(w http.ResponseWriter, r *http.Request) {
	user, ok := s.form(w, r, false)
	if !ok {
		return
	}
	worker := r.PostForm.Get("worker")
	if !validText(worker, 128) {
		http.Error(w, "请选择 Worker。", 400)
		return
	}
	_, err := s.db.CommunityClaim(r.Context(), r.PathValue("id"), worker, user.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	http.Redirect(w, r, "/tasks/"+url.PathEscape(r.PathValue("id")), 303)
}
func (s *server) operatorLoginPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, 200, page{Title: "管理员登录", View: "login"})
}
func (s *server) operatorLogin(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != s.config.BaseURL {
		s.fail(w, r, store.ErrForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "表单无效。", 400)
		return
	}
	actual := sha256.Sum256([]byte(r.PostForm.Get("token")))
	if subtle.ConstantTimeCompare(actual[:], s.tokenHash[:]) != 1 {
		s.render(w, r, 401, page{Title: "管理员登录", View: "login", Message: "凭证无效，请重新输入。"})
		return
	}
	if err := s.startSession(w, r, 0, true); err != nil {
		s.fail(w, r, err)
		return
	}
	http.Redirect(w, r, "/community/admin", 303)
}
func (s *server) startSession(w http.ResponseWriter, r *http.Request, id int64, operator bool) error {
	// Rotate and revoke the old session when switching identities.
	if old, err := r.Cookie("pero_community"); err == nil {
		if err = s.db.CommunityDeleteSession(r.Context(), old.Value); err != nil {
			return err
		}
	}
	token, csrf := random(), random()
	if err := s.db.CommunityCreateSession(r.Context(), token, csrf, id, operator); err != nil {
		return err
	}
	s.cookie(w, "pero_community", token, "/", 12*60*60)
	return nil
}
func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	session, err := s.session(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if session == nil {
		s.fail(w, r, store.ErrForbidden)
		return
	}
	if _, ok := s.form(w, r, session.Operator); !ok {
		return
	}
	c, _ := r.Cookie("pero_community")
	if err = s.db.CommunityDeleteSession(r.Context(), c.Value); err != nil {
		s.fail(w, r, err)
		return
	}
	s.cookie(w, "pero_community", "", "/", -1)
	http.Redirect(w, r, "/tasks", 303)
}
func (s *server) admin(w http.ResponseWriter, r *http.Request) {
	user, err := s.session(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if user == nil || !user.Operator {
		http.Redirect(w, r, "/community/admin/login", 303)
		return
	}
	n, err := offset(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	drafts, err := s.db.Tasks(r.Context(), r.URL.Query().Get("cursor"), 50)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	tasks, more, err := s.db.CommunityTasks(r.Context(), n)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.render(w, r, 200, page{Title: "社区管理", View: "admin", Session: user, Drafts: drafts.Tasks, Tasks: tasks, More: more, Offset: n, Message: r.URL.Query().Get("done")})
}
func (s *server) publish(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.form(w, r, true); !ok {
		return
	}
	id, title, desc, source := r.PostForm.Get("task"), r.PostForm.Get("title"), r.PostForm.Get("description"), r.PostForm.Get("source")
	if !validText(id, 128) || !validText(title, 240) || !validText(desc, 4000) || (source != "" && !validLink(source)) {
		http.Error(w, "请填写公开标题和说明；来源须为 HTTPS 链接。", 400)
		return
	}
	if err := s.db.CommunityPublish(r.Context(), id, title, desc, source); err != nil {
		s.fail(w, r, err)
		return
	}
	http.Redirect(w, r, "/tasks/"+url.PathEscape(id), 303)
}
func (s *server) bind(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.form(w, r, true); !ok {
		return
	}
	worker, login := r.PostForm.Get("worker"), r.PostForm.Get("login")
	if !validText(worker, 128) || !loginPattern.MatchString(login) {
		http.Error(w, "请填写 Worker ID 和 GitHub 用户名。", 400)
		return
	}
	if err := s.db.CommunityBindWorker(r.Context(), worker, login); err != nil {
		s.fail(w, r, err)
		return
	}
	http.Redirect(w, r, "/community/admin?done=bound", 303)
}
func (s *server) accept(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.form(w, r, true); !ok {
		return
	}
	id, run, link, note := r.PostForm.Get("task"), r.PostForm.Get("run"), r.PostForm.Get("evidence"), r.PostForm.Get("note")
	if !validText(id, 128) || !validText(run, 128) || !validLink(link) || !validText(note, 2000) {
		http.Error(w, "验收需要 HTTPS 证据链接和公开验收说明。", 400)
		return
	}
	if err := s.db.CommunityAccept(r.Context(), id, run, link, note); err != nil {
		s.fail(w, r, err)
		return
	}
	http.Redirect(w, r, "/tasks/"+url.PathEscape(id), 303)
}
func (s *server) reverse(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.form(w, r, true); !ok {
		return
	}
	id, award, note := r.PostForm.Get("task"), r.PostForm.Get("award"), r.PostForm.Get("note")
	if !validText(id, 128) || !validText(award, 128) || !validText(note, 2000) || r.PostForm.Get("confirm") != "yes" {
		http.Error(w, "请填写撤销原因并确认。", 400)
		return
	}
	if err := s.db.CommunityReverse(r.Context(), id, award, note); err != nil {
		s.fail(w, r, err)
		return
	}
	http.Redirect(w, r, "/tasks/"+url.PathEscape(id), 303)
}
