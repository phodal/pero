// pero-campaign polls Temporal and delegates trial operations to the Pero API.
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/phodal/pero/server/internal/campaignruntime"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	addr := os.Getenv("PERO_TEMPORAL_ADDRESS")
	if addr == "" {
		return fmt.Errorf("PERO_TEMPORAL_ADDRESS is required")
	}
	activities, err := campaignruntime.NewActivities(os.Getenv("PERO_CLOUD_URL"), os.Getenv("PERO_CAMPAIGN_RUNNER_TOKEN"))
	if err != nil {
		return err
	}
	c, err := client.Dial(client.Options{HostPort: addr, Namespace: os.Getenv("PERO_TEMPORAL_NAMESPACE")})
	if err != nil {
		return err
	}
	defer c.Close()
	w := worker.New(c, campaignruntime.TaskQueue, worker.Options{})
	activities.Register(w)
	review := worker.New(c, campaignruntime.ReviewTaskQueue, worker.Options{})
	activities.Register(review)
	if err := review.Start(); err != nil {
		return err
	}
	defer review.Stop()
	return w.Run(worker.InterruptCh())
}
