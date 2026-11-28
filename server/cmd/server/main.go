// Server is the durable Go coordination service. Coding runs execute on Workers.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/phodal/pero/server/internal/campaignruntime"
	"github.com/phodal/pero/server/internal/community"
	"github.com/phodal/pero/server/internal/github"
	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/sandbox"
	"github.com/phodal/pero/server/internal/store"
	"go.temporal.io/sdk/client"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	url, token := os.Getenv("PERO_DATABASE_URL"), os.Getenv("PERO_OPERATOR_TOKEN")
	if url == "" || token == "" {
		return fmt.Errorf("PERO_DATABASE_URL and PERO_OPERATOR_TOKEN are required")
	}
	seconds := 60
	if raw := os.Getenv("PERO_LEASE_SECONDS"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 3600 {
			return fmt.Errorf("PERO_LEASE_SECONDS must be between 1 and 3600")
		}
		seconds = value
	}
	syncSeconds := 60
	if raw := os.Getenv("PERO_GITHUB_SYNC_SECONDS"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 60 || value > 86400 {
			return fmt.Errorf("PERO_GITHUB_SYNC_SECONDS must be between 60 and 86400")
		}
		syncSeconds = value
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 15*time.Second)
	db, err := store.Open(startup, url, time.Duration(seconds)*time.Second)
	cancel()
	if err != nil {
		return fmt.Errorf("open control-plane database: %w", err)
	}
	defer func() { stop(); db.Close() }()
	repositories, err := github.ParseRepositories(os.Getenv("PERO_GITHUB_REPOSITORIES"))
	if err != nil {
		return err
	}
	sources, err := github.New(db, repositories, os.Getenv("PERO_GITHUB_TOKEN"))
	if err != nil {
		return err
	}
	sources.Start(ctx, time.Duration(syncSeconds)*time.Second)
	listen := os.Getenv("PERO_LISTEN")
	if listen == "" {
		listen = "127.0.0.1:8787"
	}
	var runtime *sandbox.Runtime
	var profile *sandbox.ConfiguredProfile
	if path := os.Getenv("PERO_SANDBOX_CONFIG"); path != "" {
		profile, err = sandbox.LoadProfile(ctx, db, path)
		if err != nil {
			return fmt.Errorf("configure sandbox runtime: %w", err)
		}
		runtime = profile.Runtime
		runtime.Start(ctx)
	}
	papers := &httpapi.PersistedPaper{DB: db}
	options := httpapi.ServerOptions{Runtime: runtime, GitHub: sources, Paper: papers, Importer: papers, ProtocolRoot: os.Getenv("PERO_PROTOCOL_ROOT")}
	if profile != nil && profile.Gateway != nil {
		options.Gateway, options.Reviewer, options.Objects = profile.Gateway, profile.Reviewer, profile.Objects
	}
	if addr := os.Getenv("PERO_TEMPORAL_ADDRESS"); addr != "" {
		runner := os.Getenv("PERO_CAMPAIGN_RUNNER_CLIENT_ID")
		if runner == "" {
			return fmt.Errorf("PERO_CAMPAIGN_RUNNER_CLIENT_ID is required with PERO_TEMPORAL_ADDRESS")
		}
		temporalClient, err := client.NewLazyClient(client.Options{HostPort: addr, Namespace: os.Getenv("PERO_TEMPORAL_NAMESPACE")})
		if err != nil {
			return err
		}
		defer temporalClient.Close()
		options.Campaigns = &httpapi.ResearchCampaigns{Temporal: campaignruntime.Temporal{Client: temporalClient}, RunnerClientID: runner}
		if root := os.Getenv("PERO_PYBAMM_METHOD_DIR"); root != "" {
			verifier, err := httpapi.NewPyBaMMVerifier(os.Getenv("PERO_PYBAMM_CHECKER_PYTHON"), root)
			if err != nil {
				return err
			}
			options.Campaigns.Verifier = verifier
		}
	}
	api := httpapi.ServerHandler(db, token, options)
	handler, err := community.Handler(db, token, community.FromEnv(), api)
	if err != nil {
		return err
	}
	server := &http.Server{Addr: listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	listener, err := net.Listen("tcp", listen)
	if err != nil {
		return err
	}
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				op, done := context.WithTimeout(ctx, 5*time.Second)
				err := db.Reap(op)
				done()
				if err != nil && ctx.Err() == nil {
					log.Printf("lease reconciliation: %v", err)
				}
			}
		}
	}()
	go func() {
		<-ctx.Done()
		shutdown, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("Pero control plane listening on %s", listener.Addr())
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
