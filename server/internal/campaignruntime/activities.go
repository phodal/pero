package campaignruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/phodal/pero/server/internal/campaign"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

type Activities struct {
	base  *url.URL
	token string
	http  *http.Client
}

func NewActivities(base, token string) (Activities, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
		(u.Scheme != "http" && u.Scheme != "https") || token == "" {
		return Activities{}, errors.New("provide a Pero HTTP(S) control URL and a Campaign runner Client token")
	}
	return Activities{base: u, token: token, http: &http.Client{
		Timeout:       8 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

func (a Activities) Register(w worker.Worker) {
	w.RegisterWorkflowWithOptions(Workflow, workflow.RegisterOptions{Name: WorkflowName})
	w.RegisterActivityWithOptions(a.Trial, activity.RegisterOptions{Name: trialActivity})
	w.RegisterActivityWithOptions(a.Finish, activity.RegisterOptions{Name: finishActivity})
}

func (a Activities) Trial(ctx context.Context, cmd campaign.TrialCommand) (campaign.Observation, error) {
	var trial campaign.Observation
	endpoint := a.base.JoinPath("api", "client", "v1", "campaign-runtime", cmd.CampaignID, "trials", strconv.Itoa(cmd.Index), string(cmd.Action))
	err := a.call(ctx, http.MethodPost, endpoint, nil, &trial)
	return trial, err
}

func (a Activities) Finish(ctx context.Context, state campaign.Progress) error {
	body, err := json.Marshal(state)
	if err != nil {
		return err
	}
	endpoint := a.base.JoinPath("api", "client", "v1", "campaign-runtime", state.Plan.ID, "result")
	return a.call(ctx, http.MethodPut, endpoint, body, nil)
}

func (a Activities) call(ctx context.Context, method string, endpoint *url.URL, body []byte, target any) error {
	req, err := http.NewRequestWithContext(ctx, method, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+a.token)
	req.Header.Set("Content-Type", "application/json")
	res, err := a.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("Pero campaign operation returned HTTP %d", res.StatusCode)
	}
	if target != nil {
		return json.NewDecoder(res.Body).Decode(target)
	}
	return nil
}
