package llm

import (
	"errors"
	"fmt"
	"regexp"
)

const (
	ContextWindowExceededCode   = "CONTEXT_WINDOW_EXCEEDED"
	EmptyResponseCode           = "EMPTY_RESPONSE"
	MalformedResponseCode       = "MALFORMED_RESPONSE"
	StreamClosedCode            = "STREAM_CLOSED"
	TransportErrorCode          = "TRANSPORT"
	RequestBudgetExhaustedCode  = "BUDGET_EXHAUSTED"
	RequestDeadlineExceededCode = "REQUEST_DEADLINE_EXCEEDED"
	// ImageOffloadRequiredCode means an image-capable route cannot send until
	// more of the oldest retained input images are omitted. OffloadImages names
	// how many. Recovery records that decision and retries outside the provider
	// retry budget.
	ImageOffloadRequiredCode = "IMAGE_OFFLOAD_REQUIRED"
)

// ProviderFailure is the serializable, machine-routable face of one failed
// model request. Recovery code routes on Code, never on Message.
type ProviderFailure struct {
	Message              string `json:"message"`
	Code                 string `json:"code,omitempty"`
	Status               int    `json:"status,omitempty"`
	ProviderRetryAfterMS int64  `json:"providerRetryAfterMs,omitempty"`
	RequestID            string `json:"requestId,omitempty"`
	// OffloadImages is set only for IMAGE_OFFLOAD_REQUIRED. Nil means the
	// failure did not name a count; zero is a present count.
	OffloadImages *int `json:"offloadImages,omitempty"`
}

// NewImageOffloadRequired builds the route failure that asks for count more
// oldest retained input images to be omitted before the request is retried.
func NewImageOffloadRequired(count int) *ProviderError {
	offloadImages := count
	return NewProviderErrorWithFailure(ProviderFailure{
		Message:       fmt.Sprintf("request images exceed the route budget; %d more oldest occurrence(s) must be offloaded", count),
		Code:          ImageOffloadRequiredCode,
		OffloadImages: &offloadImages,
	}, nil)
}

// ProviderError retains a normalized failure and its original cause.
type ProviderError struct {
	Failure ProviderFailure
	cause   error
}

func NewProviderError(message, code string, cause error) *ProviderError {
	if message == "" && cause != nil {
		message = cause.Error()
	}
	return &ProviderError{Failure: ProviderFailure{Message: message, Code: code}, cause: cause}
}

// NewProviderErrorWithFailure retains structured provider response facts for
// retry policy and diagnostics without exposing the live cause to persistence.
func NewProviderErrorWithFailure(failure ProviderFailure, cause error) *ProviderError {
	if failure.Message == "" && cause != nil {
		failure.Message = cause.Error()
	}
	return &ProviderError{Failure: failure, cause: cause}
}

func (e *ProviderError) Error() string {
	if e == nil {
		return "<nil>"
	}
	if e.Failure.Code == "" {
		return e.Failure.Message
	}
	return fmt.Sprintf("%s: %s", e.Failure.Code, e.Failure.Message)
}

func (e *ProviderError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func ProviderFailureFromError(err error) ProviderFailure {
	var provider *ProviderError
	if errors.As(err, &provider) && provider != nil {
		return provider.Failure
	}
	if err == nil {
		return ProviderFailure{}
	}
	return ProviderFailure{Message: err.Error()}
}

var contextOverflowPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(?:^|[^a-z0-9])context[\s_-]+(?:length|window)[\s_-]+(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]+exceeded)(?:$|[^a-z0-9])`),
	regexp.MustCompile(`(?i)\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b`),
	regexp.MustCompile(`(?i)\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?(?:model(?:'s)?\s+)?context(?:\s+window)?\b`),
	regexp.MustCompile(`(?i)\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\s+(?:this|the)\s+model\b`),
	regexp.MustCompile(`(?i)\b(?:input|prompt|request|messages?)\b.{0,40}\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`),
}

// IsContextWindowExceededDetail recognizes explicit provider wording about a
// model context bound. It intentionally does not classify generic HTTP 400s.
func IsContextWindowExceededDetail(detail string) bool {
	for _, pattern := range contextOverflowPatterns {
		if pattern.MatchString(detail) {
			return true
		}
	}
	return false
}
