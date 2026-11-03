package pluginruntime

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

// stopFailure runs StopFailure instead of Stop when a provider request ends the turn.
// Hook output cannot continue the turn or replace the provider error.
func (app *HookApp) stopFailure(ctx context.Context, agent *harness.Agent, cause error) error {
	if app == nil || agent == nil {
		return nil
	}
	kind, details, message, ok := stopFailureKind(cause)
	if !ok {
		return nil
	}
	_, err := app.event(ctx, agent, claudehooks.Input{
		Event: "StopFailure", ErrorKind: kind, ErrorDetails: details, LastAssistantMessage: message,
	})
	if errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return nil
}

func stopFailureKind(cause error) (kind, details, message string, ok bool) {
	var provider *harness.ProviderError
	if !errors.As(cause, &provider) || provider == nil {
		return "", "", "", false
	}
	failure := provider.Failure
	kind = stopFailureClass(failure)
	if failure.Status > 0 {
		if text := http.StatusText(failure.Status); text != "" {
			details = strconv.Itoa(failure.Status) + " " + text
		} else {
			details = strconv.Itoa(failure.Status)
		}
	}
	message = strings.TrimSpace(failure.Message)
	if message == "" {
		message = "provider request failed"
	}
	if !strings.HasPrefix(message, "API Error:") {
		message = "API Error: " + message
	}
	return kind, details, message, true
}

func stopFailureClass(failure harness.ProviderFailure) string {
	lower := strings.ToLower(failure.Message + " " + failure.Code)
	switch failure.Status {
	case http.StatusTooManyRequests:
		return "rate_limit"
	case 529:
		return "overloaded"
	case http.StatusUnauthorized:
		return "authentication_failed"
	case http.StatusPaymentRequired:
		return "billing_error"
	case http.StatusBadRequest, http.StatusRequestEntityTooLarge:
		return "invalid_request"
	case http.StatusNotFound:
		if strings.Contains(lower, "model") {
			return "model_not_found"
		}
		return "invalid_request"
	case http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		if failure.Status == http.StatusServiceUnavailable || strings.Contains(lower, "overload") {
			return "overloaded"
		}
		return "server_error"
	}
	switch failure.Code {
	case "RATE_LIMIT":
		return "rate_limit"
	case "AUTH":
		return "authentication_failed"
	case "QUOTA":
		return "billing_error"
	case "INVALID_REQUEST":
		return "invalid_request"
	case "SERVER", "TIMEOUT":
		return "server_error"
	}
	switch {
	case strings.Contains(lower, "overload"):
		return "overloaded"
	case strings.Contains(lower, "account on hold"):
		return "account_on_hold"
	case strings.Contains(lower, "oauth") && strings.Contains(lower, "organization"):
		return "oauth_org_not_allowed"
	case strings.Contains(lower, "model not found") || strings.Contains(lower, "model_not_found"):
		return "model_not_found"
	case strings.Contains(lower, "max output token") || strings.Contains(lower, "max_output_tokens"):
		return "max_output_tokens"
	case strings.Contains(lower, "cloud credential"):
		return "cloud_credential_error"
	case strings.Contains(lower, "billing") || strings.Contains(lower, "quota"):
		return "billing_error"
	default:
		return "unknown"
	}
}
