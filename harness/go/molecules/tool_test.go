package molecules

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestMissingBackendDoesNotInventAStructure(t *testing.T) {
	summary, receipt, err := Render(context.Background(), "python3", "", json.RawMessage(`{"format":"smiles","records":["CCO"]}`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(summary, "<svg") || strings.Contains(summary, "46.069") {
		t.Fatalf("summary invented chemistry: %s", summary)
	}
	var body struct {
		Status string `json:"status"`
		Rows   []struct {
			Status string `json:"status"`
			SVG    string `json:"svg"`
			Error  string `json:"error"`
		} `json:"rows"`
	}
	if err := json.Unmarshal([]byte(receipt), &body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "unavailable" || len(body.Rows) != 1 || body.Rows[0].SVG != "" || body.Rows[0].Error == "" {
		t.Fatalf("unavailable receipt: %+v", body)
	}
}

func TestRealRDKitReceiptBindsEthanolAndTheInvalidRecord(t *testing.T) {
	python := os.Getenv("PERO_MOLECULE_PYTHON")
	if python == "" {
		var err error
		python, err = exec.LookPath("python3")
		if err != nil {
			t.Fatal(err)
		}
	}
	if exec.Command(python, "-c", "import rdkit").Run() != nil {
		t.Skip("RDKit is not installed for this Python")
	}
	backend := "../../../apps/scientific-viewer/backend"
	input := json.RawMessage(`{"format":"smiles","records":["CCO","invalid@@"]}`)
	summary, receipt, err := Render(context.Background(), python, backend, input)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(summary, "<svg") {
		t.Fatal("model summary includes the drawing")
	}
	var body struct {
		Status  string `json:"status"`
		Version string `json:"version"`
		Rows    []struct {
			Input       string `json:"input"`
			Status      string `json:"status"`
			SVG         string `json:"svg"`
			Descriptors map[string]struct {
				Value float64 `json:"value"`
			} `json:"descriptors"`
		} `json:"rows"`
	}
	if err := json.Unmarshal([]byte(receipt), &body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "partial" || body.Rows[0].Input != "CCO" || !strings.Contains(body.Rows[0].SVG, "<svg") {
		t.Fatalf("ethanol was not depicted: %+v", body.Status)
	}
	if body.Rows[0].Descriptors["MolWt"].Value < 46 || body.Rows[0].Descriptors["MolWt"].Value > 46.1 {
		t.Fatalf("MolWt: %v", body.Rows[0].Descriptors["MolWt"].Value)
	}
	if body.Rows[1].Status != "invalid" || body.Rows[1].SVG != "" || len(body.Rows[1].Descriptors) != 0 {
		t.Fatalf("invalid row inherited a drawing: %+v", body.Rows[1])
	}
	_, again, err := Render(context.Background(), python, backend, input)
	if err != nil {
		t.Fatal(err)
	}
	var replay struct {
		Version string `json:"version"`
	}
	if json.Unmarshal([]byte(again), &replay) != nil || replay.Version != body.Version {
		t.Fatal("the same records did not replay the same version")
	}
}
