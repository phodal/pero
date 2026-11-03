package mcp

import (
	"context"
	"errors"
	"net"
	"reflect"
	"strings"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestConnectionObservationAdmission(t *testing.T) {
	for _, test := range []struct {
		name  string
		tools []string
		want  ConnectionStatus
	}{
		{"catalog", []string{"alpha"}, ConnectionConnected},
		{"empty", nil, ConnectionConnected},
		{"oversized", make([]string, 257), ConnectionError},
		{"long name", []string{strings.Repeat("x", 129)}, ConnectionError},
		{"control", []string{"bad\nname"}, ConnectionError},
	} {
		t.Run(test.name, func(t *testing.T) {
			var got ConnectionObservation
			supervisor := mcpConnectionSupervisor{serverName: "docs", nextGeneration: 3, observe: func(value ConnectionObservation) { got = value }}
			supervisor.publish(ConnectionConnected, test.tools)
			if got.Status != test.want || got.Generation != 3 || got.Server != "docs" || got.Tools == nil {
				t.Fatalf("observation: %+v", got)
			}
			if test.want == ConnectionError && len(got.Tools) != 0 {
				t.Fatalf("invalid catalog was exposed: %+v", got)
			}
		})
	}
}

func TestConnectionObservationsRejectStaleGeneration(t *testing.T) {
	current := &mcpGeneration{id: 2}
	supervisor := mcpConnectionSupervisor{current: current, nextGeneration: 2, listTools: func(context.Context, *sdk.ClientSession) ([]*sdk.Tool, error) {
		t.Fatal("stale generation reached discovery")
		return nil, nil
	}, observe: func(ConnectionObservation) { t.Fatal("stale observation published") }}
	supervisor.activeGeneration.Store(2)
	if err := supervisor.syncGeneration(t.Context(), &mcpGeneration{id: 1}); err != nil {
		t.Fatal(err)
	}
	supervisor.activeGeneration.Store(0)
	if err := supervisor.syncGeneration(t.Context(), current); err != nil {
		t.Fatal(err)
	}
}

func TestConnectionObservationsReconnectAndCleanup(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	runtime := point.New()
	defer runtime.Dispose(context.Background())
	observations := make(chan ConnectionObservation, 32)
	sessions := make(chan *sdk.ServerSession, 4)
	disconnects := make(chan net.Conn, 4)
	attempts := 0
	definition := point.Define(point.Descriptor{ID: "observations"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		err := MountConnection(ctx, run, ConnectionOptions{ServerName: "docs", Reconnect: ReconnectPolicy{Enabled: true, InitialDelay: time.Millisecond, MaxDelay: time.Millisecond, MaxAttempts: 2}, Observe: func(value ConnectionObservation) { observations <- value }, TransportFactory: func() (sdk.Transport, error) {
			attempts++
			if attempts == 1 {
				return nil, errors.New("synthetic-secret")
			}
			clientPipe, serverPipe := net.Pipe()
			client := &sdk.IOTransport{Reader: clientPipe, Writer: clientPipe}
			transport := &sdk.IOTransport{Reader: serverPipe, Writer: serverPipe}
			disconnects <- serverPipe
			server := sdk.NewServer(&sdk.Implementation{Name: "fixture", Version: "1"}, nil)
			server.AddTool(&sdk.Tool{Name: "alpha", InputSchema: map[string]any{"type": "object"}}, nil)
			session, err := server.Connect(ctx, transport, nil)
			if err != nil {
				return nil, err
			}
			sessions <- session
			return client, nil
		}}, func(*point.Run, string, []Tool) (point.Dispose, error) {
			return func(context.Context) error { return nil }, nil
		})
		return nil, err
	})
	instance, err := runtime.Mount(runtime.Root(), "observations", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := instance.WaitStable(ctx); err != nil {
		t.Fatal(err)
	}
	next := func(status ConnectionStatus, generation uint64) ConnectionObservation {
		t.Helper()
		select {
		case got := <-observations:
			if got.Status != status || got.Generation != generation {
				t.Fatalf("got %+v, want %s generation %d", got, status, generation)
			}
			return got
		case <-ctx.Done():
			t.Fatalf("waiting for %s: %v", status, ctx.Err())
			return ConnectionObservation{}
		}
	}
	next(ConnectionConnecting, 1)
	next(ConnectionError, 1)
	next(ConnectionConnecting, 2)
	if got := next(ConnectionConnected, 2); !reflect.DeepEqual(got.Tools, []string{"alpha"}) {
		t.Fatalf("catalog: %+v", got)
	}
	session := <-sessions
	if err := (<-disconnects).Close(); err != nil {
		t.Fatal(err)
	}
	next(ConnectionDisconnected, 2)
	next(ConnectionConnecting, 3)
	next(ConnectionConnected, 3)
	session = <-sessions
	if err := runtime.Dispose(ctx); err != nil {
		t.Fatal(err)
	}
	next(ConnectionClosed, 3)
	_ = session.Wait() // The server observes the client's deliberate EOF on cleanup.
	if attempts != 3 {
		t.Fatalf("duplicate connect: %d", attempts)
	}
}

func TestOversizedServerInstructionsRejectTheConnection(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	runtime := point.New()
	defer runtime.Dispose(context.Background())
	clientTransport, serverTransport := sdk.NewInMemoryTransports()
	server := sdk.NewServer(&sdk.Implementation{Name: "fixture", Version: "1"}, &sdk.ServerOptions{Instructions: strings.Repeat("x", maxServerInstructionBytes)})
	session, err := server.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	errs := make(chan error, 1)
	definition := point.Define(point.Descriptor{ID: "instructions"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		err := MountConnection(ctx, run, ConnectionOptions{ServerName: "docs", FailOnStartupError: true, TransportFactory: func() (sdk.Transport, error) {
			return clientTransport, nil
		}}, func(*point.Run, string, []Tool) (point.Dispose, error) {
			return func(context.Context) error { return nil }, nil
		})
		errs <- err
		return nil, err
	})
	if _, err := runtime.Mount(nil, "instructions", definition, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errs:
		if err == nil || !strings.Contains(err.Error(), "instructions") {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}

func TestWorkspaceRootURISkipsRelativeDirectories(t *testing.T) {
	roots := workspaceRoots([]string{"/tmp/workspace", "relative", ""})
	if len(roots) != 1 || roots[0].URI != "file:///tmp/workspace" || roots[0].Name != "workspace" {
		t.Fatalf("roots = %+v", roots)
	}
}
