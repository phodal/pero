package claudehooks

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func hookTimeout(hook Hook) (time.Duration, error) {
	timeout := hook.Timeout
	if timeout == 0 {
		if strings.TrimSpace(hook.Prompt) != "" {
			timeout = 30 * time.Second
		} else {
			timeout = 600 * time.Second
			if hook.Event == "UserPromptSubmit" || hook.Event == "PreModelSwitch" || hook.Event == "PostModelSwitch" {
				timeout = 30 * time.Second
			} else if hook.Event == "SessionEnd" {
				timeout = 1500 * time.Millisecond
			}
		}
	}
	if timeout < 0 {
		return 0, errors.New("claudehooks: timeout must be positive")
	}
	return timeout, nil
}

// Post sends one HTTP hook. A 2xx JSON object uses the command-hook decision
// schema. Any other response is a non-blocking failure. Redirects are not followed.
func (runner Runner) Post(ctx context.Context, hook Hook, input Input) (Decision, error) {
	if ctx == nil {
		return Decision{}, errors.New("claudehooks: execution context is required")
	}
	if err := ctx.Err(); err != nil {
		return Decision{}, err
	}
	if hook.Event == "" || (input.Event != "" && input.Event != hook.Event) {
		return Decision{}, errors.New("claudehooks: hook event and input must match")
	}
	input.Event = hook.Event
	if !filepath.IsAbs(input.CWD) {
		return Decision{}, errors.New("claudehooks: an explicit absolute working directory is required")
	}
	if strings.TrimSpace(hook.URL) == "" {
		return Decision{}, errors.New("claudehooks: HTTP hook URL is required")
	}
	timeout, err := hookTimeout(hook)
	if err != nil {
		return Decision{}, err
	}
	deadline, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	payload, err := json.Marshal(input)
	if err != nil {
		return Decision{}, fmt.Errorf("claudehooks: invalid hook input: %w", err)
	}
	request, err := http.NewRequestWithContext(deadline, http.MethodPost, hook.URL, bytes.NewReader(payload))
	if err != nil {
		return Decision{}, fmt.Errorf("%w for %s: %s", ErrNonBlocking, hook.Event, err.Error())
	}
	request.Header.Set("Content-Type", "application/json")
	for key, value := range hook.Headers {
		request.Header.Set(key, interpolateHookHeader(value, runner.Environment, hook.AllowedEnvVars))
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(deadline.Err(), context.DeadlineExceeded) {
			return Decision{}, context.DeadlineExceeded
		}
		return Decision{}, fmt.Errorf("%w for %s: %s", ErrNonBlocking, hook.Event, err.Error())
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxOutputBytes+1))
	if err != nil {
		return Decision{}, fmt.Errorf("%w for %s: %s", ErrNonBlocking, hook.Event, err.Error())
	}
	if len(body) > maxOutputBytes {
		return Decision{}, ErrOutputLimit
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Decision{}, fmt.Errorf("%w for %s (HTTP %d)", ErrNonBlocking, hook.Event, response.StatusCode)
	}
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return Decision{}, nil
	}
	if body[0] != '{' {
		return Decision{}, fmt.Errorf("%w for %s: HTTP hook body must be a JSON object", ErrNonBlocking, hook.Event)
	}
	return ParseDecision(hook.Event, body, nil, 0)
}

func interpolateHookHeader(value string, environment, allowed []string) string {
	permit := make(map[string]bool, len(allowed))
	for _, name := range allowed {
		permit[name] = true
	}
	values := map[string]string{}
	for _, entry := range environment {
		name, found, ok := strings.Cut(entry, "=")
		if ok && permit[name] {
			values[name] = found
		}
	}
	return os.Expand(value, func(name string) string {
		if !permit[name] {
			return ""
		}
		return values[name]
	})
}
