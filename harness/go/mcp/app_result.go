package mcp

import (
	"context"
	"encoding/json"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// AppResultCapture retains the complete wire result for one actual dispatch.
// It is installed by the owning Harness tool request, never by tool arguments.
type AppResultCapture struct{ result json.RawMessage }
type appResultCaptureKey struct{}

func (capture *AppResultCapture) Context(ctx context.Context) context.Context {
	return context.WithValue(ctx, appResultCaptureKey{}, capture)
}

func (capture *AppResultCapture) Wire() json.RawMessage {
	return append(json.RawMessage(nil), capture.result...)
}

func captureAppResult(ctx context.Context, result *sdk.CallToolResult) error {
	capture, _ := ctx.Value(appResultCaptureKey{}).(*AppResultCapture)
	if capture == nil {
		return nil
	}
	raw, err := json.Marshal(result)
	if err == nil {
		capture.result = raw
	}
	return err
}
