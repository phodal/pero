package runtimegateway

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"testing"
)

func TestProviderBodyFixedAuthority(t *testing.T) {
	valid := `{"model":"fixed","messages":[{"role":"user","content":"hello"}],"stream":true}`
	data, e := ValidateProviderBody([]byte(valid), "fixed", 32, false)
	if e != nil {
		t.Fatal(e)
	}
	var m map[string]any
	json.Unmarshal(data, &m)
	if m["max_tokens"] != float64(32) {
		t.Fatal(string(data))
	}
	for _, bad := range []string{`{"model":"fixed","messages":[{}],"thinking":{"type":"enabled","budget_tokens":100000}}`, `{"model":"fixed","messages":[{}],"stream_options":{"arbitrary":true}}`, `{"model":"other","messages":[{}]}`, `{"model":"fixed","messages":[{}],"max_tokens":33}`, `{"model":"fixed","messages":[{}],"base_url":"http://evil"}`, `{"model":"fixed","messages":[{"content":[{"type":"image_url","image_url":{"url":"http://secret"}}]}]}`, `{"model":"fixed","messages":[{}],"tools":[{"type":"web_search"}]}`} {
		if _, e = ValidateProviderBody([]byte(bad), "fixed", 32, false); e == nil {
			t.Fatal(bad)
		}
	}
}

func TestProviderBrowserScreenshots(t *testing.T) {
	var raster bytes.Buffer
	if err := png.Encode(&raster, image.NewRGBA(image.Rect(0, 0, 4, 3))); err != nil {
		t.Fatal(err)
	}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(raster.Bytes())
	for _, tc := range []struct {
		name, role, url, extra string
		enabled, want          bool
	}{
		{"opt-in PNG", "tool", dataURL, "", true, true},
		{"text recipe", "tool", dataURL, "", false, false},
		{"remote image", "tool", "https://fixture.invalid/screenshot.png", "", true, false},
		{"bad PNG", "tool", "data:image/png;base64,eA==", "", true, false},
		{"user image", "user", dataURL, "", true, false},
		{"unknown image field", "tool", dataURL, `,"detail":"high"`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := fmt.Sprintf(`{"model":"fixed","messages":[{"role":%q,"tool_call_id":"shot","content":[{"type":"text","text":"receipt"},{"type":"image_url","image_url":{"url":%q%s}}]},{"role":"tool","tool_call_id":"other","content":"other result"}]}`,
				tc.role, tc.url, tc.extra)
			data, err := ValidateProviderBody([]byte(body), "fixed", 32, tc.enabled)
			if (err == nil) != tc.want {
				t.Fatal("unexpected browser image admission", err)
			}
			if !tc.want {
				return
			}
			var request struct {
				Messages []struct {
					Role, ToolCallID string
					Content          json.RawMessage
				}
			}
			if err := json.Unmarshal(data, &request); err != nil {
				t.Fatal(err)
			}
			m := request.Messages
			if len(m) != 3 || m[0].Role != "tool" || string(m[0].Content) != `"receipt"` ||
				m[1].Role != "tool" || string(m[1].Content) != `"other result"` || m[2].Role != "user" ||
				!bytes.Contains(m[2].Content, []byte(dataURL)) {
				t.Fatalf("receipt ordering or PNG changed: %s", data)
			}
		})
	}
}
