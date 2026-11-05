package pluginruntime

import (
	"context"
	"time"
)

func (app *HookApp) drain(ctx context.Context) error {
	app.mu.Lock()
	app.closed = true
	cancels := app.asyncCancels
	app.asyncCancels = nil
	app.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	done := make(chan struct{})
	go func() {
		app.calls.Wait()
		app.cleanupEnvFiles()
		close(done)
	}()
	select {
	case <-done:
		app.releaseAddedDirectories()
		return nil
	case <-ctx.Done():
		app.releaseAddedDirectories()
		return ctx.Err()
	}
}

func (app *HookApp) Dispose(ctx context.Context) error {
	if app == nil || app.instance == nil {
		return nil
	}
	return app.instance.Dispose(ctx)
}

func (app *HookApp) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return app.Dispose(ctx)
}
