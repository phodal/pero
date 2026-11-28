package community

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/phodal/pero/server/internal/store"
)

const privateTasksPath = "/my/tasks"
const privateTaskAgent = "pero"

var validPrivateTaskReturn = regexp.MustCompile(`^/my/tasks(/task_[a-f0-9]{32}(/runs/run_[a-f0-9]{32}\?generation=[1-9][0-9]*)?)?$`)
var privateTaskRequestID = regexp.MustCompile(`^[a-f0-9]{64}$`)

type taskWorkspace struct {
	store.WorkerCapability
	Value string
}

type privateTaskPage struct {
	LoginURL, RequestID, Workspace, Title, Prompt, Acceptance string
	Workspaces                                                []taskWorkspace
	Tasks                                                     []store.Task
	Task                                                      *store.Task
	Run                                                       *store.Run
	RunURL, Reply                                             string
	Progress                                                  []string
	EventsTruncated                                           bool
}

func (s *server) privateTaskSignIn(w http.ResponseWriter, r *http.Request, session *store.CommunitySession) {
	next := r.URL.RequestURI()
	if !validPrivateTaskReturn.MatchString(next) {
		next = privateTasksPath
	}
	if session == nil {
		session = &store.CommunitySession{}
	}
	s.render(w, r, http.StatusUnauthorized, page{
		Title: "我的任务", View: "private", Session: session,
		Private: &privateTaskPage{LoginURL: "/auth/github?" + url.Values{"next": {next}}.Encode()},
	})
}

func (s *server) privateTaskAccess(w http.ResponseWriter, r *http.Request) (*store.CommunitySession, *store.Client) {
	session, err := s.session(r)
	if err != nil {
		s.fail(w, r, err)
		return nil, nil
	}
	if session == nil || session.Operator {
		s.privateTaskSignIn(w, r, session)
		return nil, nil
	}
	client, err := s.db.CommunityClient(r.Context(), session)
	if err != nil {
		s.fail(w, r, err)
		return nil, nil
	}
	return session, client
}

func (s *server) privateTasks(w http.ResponseWriter, r *http.Request) {
	session, client := s.privateTaskAccess(w, r)
	if client == nil {
		return
	}
	s.renderPrivateTaskDrafts(w, r, session, client, http.StatusOK, "", &privateTaskPage{RequestID: random()})
}

func (s *server) taskWorkspaces(r *http.Request, client *store.Client) ([]taskWorkspace, error) {
	workers, err := s.db.ClientWorkers(r.Context(), client)
	if err != nil {
		return nil, err
	}
	seen := map[store.WorkerCapability]bool{}
	var choices []taskWorkspace
	for _, worker := range workers {
		if worker.Enabled == nil || !*worker.Enabled {
			continue
		}
		for _, capability := range worker.Capabilities {
			if capability.AgentID != privateTaskAgent || seen[capability] {
				continue
			}
			seen[capability] = true
			value, _ := json.Marshal(capability)
			choices = append(choices, taskWorkspace{WorkerCapability: capability, Value: string(value)})
		}
	}
	slices.SortFunc(choices, func(a, b taskWorkspace) int {
		if order := strings.Compare(a.ProjectID, b.ProjectID); order != 0 {
			return order
		}
		return strings.Compare(a.WorkspaceKey, b.WorkspaceKey)
	})
	return choices, nil
}

func (s *server) renderPrivateTaskDrafts(w http.ResponseWriter, r *http.Request, session *store.CommunitySession, client *store.Client, status int, message string, view *privateTaskPage) {
	choices, err := s.taskWorkspaces(r, client)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	tasks, err := s.db.ClientCreatedTasks(r.Context(), client, 30)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	view.Workspaces, view.Tasks = choices, tasks
	s.render(w, r, status, page{Title: "我的任务", View: "private", Session: session, Message: message, Private: view})
}

func (s *server) createPrivateTask(w http.ResponseWriter, r *http.Request) {
	session, ok := s.form(w, r, false)
	if !ok {
		return
	}
	client, err := s.db.CommunityClient(r.Context(), session)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	view := &privateTaskPage{
		RequestID: r.PostForm.Get("request_id"), Workspace: r.PostForm.Get("workspace"),
		Title: r.PostForm.Get("title"), Prompt: r.PostForm.Get("prompt"), Acceptance: r.PostForm.Get("acceptance"),
	}
	if !privateTaskRequestID.MatchString(view.RequestID) {
		view.RequestID = random()
		s.renderPrivateTaskDrafts(w, r, session, client, http.StatusBadRequest, "提交标识已失效。请再次提交。", view)
		return
	}
	var capability store.WorkerCapability
	if json.Unmarshal([]byte(view.Workspace), &capability) != nil || capability.AgentID != privateTaskAgent {
		s.renderPrivateTaskDrafts(w, r, session, client, http.StatusBadRequest, "请选择可用的项目与工作区。", view)
		return
	}
	spec := store.Spec{
		Title: strings.TrimSpace(view.Title), Prompt: strings.TrimSpace(view.Prompt), Acceptance: strings.TrimSpace(view.Acceptance),
		ProjectID: capability.ProjectID, WorkspaceKey: capability.WorkspaceKey, AgentID: capability.AgentID,
	}
	draft, err := spec.ForClient(client)
	if errors.Is(err, store.ErrTaskInput) {
		s.renderPrivateTaskDrafts(w, r, session, client, http.StatusBadRequest, "请检查任务标题、说明及验收要求的内容和长度。", view)
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	task, err := s.db.ClientCreateTask(r.Context(), draft.RequireWorkerCapability(), view.RequestID)
	if errors.Is(err, store.ErrWorkerIneligible) {
		s.renderPrivateTaskDrafts(w, r, session, client, http.StatusBadRequest, "请选择可用的项目与工作区。", view)
		return
	}
	if errors.Is(err, store.ErrConflict) {
		view.RequestID = random()
		s.renderPrivateTaskDrafts(w, r, session, client, http.StatusConflict, "这份表单已用于提交另一项任务。确认需要创建新任务后，请再次提交。", view)
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	http.Redirect(w, r, privateTasksPath+"/"+task.ID, http.StatusSeeOther)
}

func (s *server) privateTask(w http.ResponseWriter, r *http.Request) {
	session, client := s.privateTaskAccess(w, r)
	if client == nil {
		return
	}
	task, err := s.db.ClientCreatedTask(r.Context(), client, r.PathValue("id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	view := &privateTaskPage{Task: task, Run: task.Run}
	if id := r.PathValue("run"); id != "" {
		generation, err := strconv.ParseInt(r.URL.Query().Get("generation"), 10, 64)
		if err != nil || generation < 1 {
			s.fail(w, r, store.ErrNotFound)
			return
		}
		ref := store.RunRef{TaskID: task.ID, RunID: id, Generation: generation}
		view.Run, err = s.db.ClientRun(r.Context(), client, ref)
		if err != nil {
			s.fail(w, r, err)
			return
		}
	}
	if view.Run != nil {
		view.RunURL = privateTasksPath + "/" + task.ID + "/runs/" + view.Run.ID + "?generation=" + strconv.FormatInt(view.Run.Generation, 10)
		tail, err := s.db.Events(r.Context(), view.Run.ID)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		var reply strings.Builder
		for _, event := range tail.Events {
			if event.Kind == "session_update" {
				var update struct {
					Kind    string          `json:"sessionUpdate"`
					Title   string          `json:"title"`
					Content json.RawMessage `json:"content"`
				}
				if json.Unmarshal(event.Data, &update) == nil {
					switch update.Kind {
					case "agent_message_chunk":
						var content struct {
							Type string `json:"type"`
							Text string `json:"text"`
						}
						if json.Unmarshal(update.Content, &content) == nil && content.Type == "text" {
							reply.WriteString(content.Text)
						}
					case "tool_call", "tool_call_update":
						if update.Title != "" {
							view.Progress = append(view.Progress, update.Title)
						}
					}
				}
			} else if event.Text != "" {
				view.Progress = append(view.Progress, event.Text)
			}
		}
		view.Reply, view.EventsTruncated = reply.String(), tail.Truncated
	}
	s.render(w, r, http.StatusOK, page{Title: task.Title, View: "private", Session: session, Private: view})
}

func privateTaskState(state string) string {
	switch state {
	case "draft":
		return "待 Desktop 分配"
	case "queued":
		return "排队中"
	case "running":
		return "执行中"
	case "cancel_requested":
		return "停止中"
	case "succeeded":
		return "执行已完成"
	case "failed":
		return "执行失败"
	case "cancelled":
		return "已取消"
	case "reconcile":
		return "执行状态待核对"
	default:
		return state
	}
}
