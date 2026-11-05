package subagents

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/model"
)

func TestAgentCatalogListsSelectedDefinitionsAndRecoversFullDescriptions(t *testing.T) {
	service := &claudeDelegation{definitions: map[string]AgentDefinition{}}
	for index := range 80 {
		name := fmt.Sprintf("package:worker-%02d", index)
		service.definitions[name] = AgentDefinition{Name: name, Description: strings.Repeat("Long description 界.\n", 900), Model: "sonnet"}
	}
	tool := service.agentListTool()
	var names []string
	for offset := 0; ; {
		result, err := tool.ExecuteRequest(t.Context(), harness.ToolRequest{Arguments: json.RawMessage(fmt.Sprintf(`{"offset":%d,"limit":7}`, offset))})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Content[0].Text) > harness.DefaultCatalogPageBytes {
			t.Fatal("unbounded page")
		}
		var page model.CatalogPage[agentCatalogItem]
		if err := json.Unmarshal([]byte(result.Content[0].Text), &page); err != nil {
			t.Fatal(err)
		}
		for _, item := range page.Items {
			if !item.DescriptionTruncated {
				t.Fatal("lost truncation marker")
			}
			names = append(names, item.Name)
		}
		if page.NextOffset == nil {
			break
		}
		offset = *page.NextOffset
	}
	if len(names) != 80 || names[0] != "package:worker-00" || names[79] != "package:worker-79" {
		t.Fatal(names)
	}
	var recovered strings.Builder
	for offset := 0; ; {
		input, _ := json.Marshal(struct {
			Name   string `json:"name"`
			Offset int    `json:"offset"`
		}{names[0], offset})
		result, err := tool.ExecuteRequest(t.Context(), harness.ToolRequest{Arguments: input})
		if err != nil {
			t.Fatal(err)
		}
		var page model.CatalogTextRange
		if err := json.Unmarshal([]byte(result.Content[0].Text), &page); err != nil {
			t.Fatal(err)
		}
		recovered.WriteString(page.Text)
		if page.NextOffset == nil {
			break
		}
		offset = *page.NextOffset
	}
	if recovered.String() != service.definitions[names[0]].Description {
		t.Fatal("description recovery lost text")
	}
	schema := service.agentTool().Schema
	if len(schema.Description) > harness.DefaultCatalogPageBytes || !strings.Contains(schema.Description, "AgentList") {
		t.Fatal("unbounded or unrecoverable agent advertisement")
	}
}
