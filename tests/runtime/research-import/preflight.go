// No-key, no-generation connectivity check using the same standard Go transport
// and existing environment proxy opt-in as providers/openai.configuredTransport.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyFromEnvironment
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodHead, "https://api.deepseek.com/v1", nil)
	response, err := client.Do(request)
	if err != nil {
		// Avoid exposing proxy credentials from a wrapped network error.
		fmt.Println(`{"reachable":false,"credentialSent":false,"generationRequests":0}`)
		os.Exit(1)
	}
	defer response.Body.Close()
	verified := response.TLS != nil && len(response.TLS.VerifiedChains) > 0
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"reachable": true, "httpStatus": response.StatusCode,
		"tlsVerified": verified, "credentialSent": false, "generationRequests": 0})
	if !verified || response.StatusCode != http.StatusUnauthorized {
		os.Exit(1)
	}
}
