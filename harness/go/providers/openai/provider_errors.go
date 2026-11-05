package openai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"syscall"
	"time"

	openaisdk "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/packages/ssestream"
	"github.com/phodal/pero/harness/go/harness"
)

func normalizeStreamError(ctx context.Context, err error) error {
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, errStreamClosed) {
		return harness.NewProviderError("openai adapter: SSE stream ended without [DONE]", harness.StreamClosedCode, err)
	}
	var apiError *openaisdk.Error
	if errors.As(err, &apiError) {
		detail := strings.TrimSpace(strings.Join([]string{apiError.Code, apiError.Type, apiError.Message}, " "))
		message := http.StatusText(apiError.StatusCode)
		failure := harness.ProviderFailure{
			Message: fmt.Sprintf("openai adapter: HTTP %d: %s", apiError.StatusCode, message),
			Code:    httpErrorCode(apiError.StatusCode, detail), Status: apiError.StatusCode,
		}
		if apiError.Response != nil {
			failure.ProviderRetryAfterMS = retryAfterMilliseconds(apiError.Response.Header, time.Now())
			// Remote request IDs are not trusted public diagnostic content.
		}
		return harness.NewProviderErrorWithFailure(failure, nil)
	}
	var syntaxError *json.SyntaxError
	if errors.As(err, &syntaxError) {
		return harness.NewProviderError("openai adapter: malformed SSE payload", harness.MalformedResponseCode, err)
	}
	var streamError *ssestream.StreamError
	if errors.As(err, &streamError) {
		return harness.NewProviderError("openai adapter: provider stream error", harness.TransportErrorCode, nil)
	}
	message := "openai adapter: provider stream failed"
	var dnsError *net.DNSError
	var networkError net.Error
	// Only fixed labels cross into native diagnostics. Transport error strings
	// can contain endpoint credentials, request queries or private hostnames.
	switch {
	case errors.As(err, &dnsError):
		message += " (DNS lookup failed)"
	case errors.As(err, &networkError) && networkError.Timeout():
		message += " (transport timed out)"
	case errors.Is(err, io.ErrUnexpectedEOF), errors.Is(err, io.EOF):
		message += " (connection ended unexpectedly)"
	case errors.Is(err, syscall.ECONNRESET):
		message += " (connection reset)"
	case errors.Is(err, syscall.ECONNREFUSED):
		message += " (connection refused)"
	}
	return harness.NewProviderError(message, harness.TransportErrorCode, err)
}

func retryAfterMilliseconds(header http.Header, now time.Time) int64 {
	if raw := strings.TrimSpace(header.Get("retry-after-ms")); raw != "" {
		if value, err := strconv.ParseFloat(raw, 64); err == nil && value > 0 && value <= math.MaxInt64 {
			return int64(math.Ceil(value))
		}
	}
	raw := strings.TrimSpace(header.Get("retry-after"))
	if raw == "" {
		return 0
	}
	if seconds, err := strconv.ParseFloat(raw, 64); err == nil && seconds > 0 && seconds <= float64(math.MaxInt64)/1000 {
		return int64(math.Ceil(seconds * 1000))
	}
	if deadline, err := http.ParseTime(raw); err == nil {
		delay := deadline.Sub(now)
		if delay > 0 {
			return delay.Milliseconds()
		}
	}
	return 0
}

func firstHeader(header http.Header, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(header.Get(name)); value != "" {
			return value
		}
	}
	return ""
}

func httpErrorCode(status int, detail string) string {
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return "AUTH"
	}
	lower := strings.ToLower(detail)
	if strings.Contains(lower, "quota") || strings.Contains(lower, "insufficient balance") {
		return "QUOTA"
	}
	if status == http.StatusTooManyRequests {
		return "RATE_LIMIT"
	}
	if harness.IsContextWindowExceededDetail(detail) {
		return harness.ContextWindowExceededCode
	}
	if status == http.StatusBadRequest || status == http.StatusRequestEntityTooLarge {
		return "INVALID_REQUEST"
	}
	if status >= 500 {
		return "SERVER"
	}
	return fmt.Sprintf("HTTP_%d", status)
}
