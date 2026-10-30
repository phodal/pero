package runtimegateway

import (
	"encoding/json"
	"testing"
)

func TestProviderBodyFixedAuthority(t *testing.T) {
	valid := `{"model":"fixed","messages":[{"role":"user","content":"hello"}],"stream":true}`
	data, e := ValidateProviderBody([]byte(valid), "fixed", 32)
	if e != nil {
		t.Fatal(e)
	}
	var m map[string]any
	json.Unmarshal(data, &m)
	if m["max_tokens"] != float64(32) {
		t.Fatal(string(data))
	}
	for _, bad := range []string{`{"model":"fixed","messages":[{}],"thinking":{"type":"enabled","budget_tokens":100000}}`, `{"model":"fixed","messages":[{}],"stream_options":{"arbitrary":true}}`, `{"model":"other","messages":[{}]}`, `{"model":"fixed","messages":[{}],"max_tokens":33}`, `{"model":"fixed","messages":[{}],"base_url":"http://evil"}`, `{"model":"fixed","messages":[{"content":[{"type":"image_url","image_url":{"url":"http://secret"}}]}]}`, `{"model":"fixed","messages":[{}],"tools":[{"type":"web_search"}]}`} {
		if _, e = ValidateProviderBody([]byte(bad), "fixed", 32); e == nil {
			t.Fatal(bad)
		}
	}
}
