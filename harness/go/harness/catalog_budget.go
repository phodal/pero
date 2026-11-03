package harness

import harnessmodel "github.com/phodal/pero/harness/go/model"

type CatalogText = harnessmodel.CatalogText
type CatalogBudget = harnessmodel.CatalogBudget

const DefaultCatalogBytes = harnessmodel.DefaultCatalogBytes
const DefaultCatalogPageBytes = harnessmodel.DefaultCatalogPageBytes

// BoundToolCatalogs runs on the final admitted request, after model/tool
// selection. It changes presentation only; complete catalogs remain with owners.
func BoundToolCatalogs(tools []ToolSchema) []ToolSchema {
	result := harnessmodel.CloneToolSchemas(tools)
	count := 0
	available := make(map[string]bool, len(result))
	for _, tool := range result {
		available[tool.Name] = true
	}
	for _, tool := range result {
		if tool.Catalog != nil {
			count++
		}
	}
	remaining := DefaultCatalogBytes
	for i := range result {
		if result[i].Catalog == nil {
			continue
		}
		// Reserve a fair share for other catalogs and MCP initialization text.
		share := remaining / (count + 1)
		budget := CatalogBudget{Remaining: share}
		catalog := *result[i].Catalog
		if catalog.RecoveryTool != "" && !available[catalog.RecoveryTool] {
			catalog.Continuation = "Additional entries are omitted from this request."
		}
		result[i].Description = budget.Render(catalog)
		remaining -= len(result[i].Description)
		count--
	}
	return result
}
