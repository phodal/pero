package mcp

import (
	"fmt"

	"github.com/phodal/pero/harness/go/model"
)

type InstructionServer struct {
	Name string `json:"name"`
	Connected bool `json:"connected"`
	InstructionBytes int `json:"instruction_bytes"`
}

type InstructionPage struct {
	Server string `json:"server"`
	model.CatalogTextRange
}

func (d *ResourceDirectory) InstructionServers(offset, limit int) (model.CatalogPage[InstructionServer], error) {
	rows := make([]InstructionServer, 0)
	for _, name := range d.Names() {
		row := InstructionServer{Name: name}
		if session := d.endpoints[name].session.Load(); session != nil && session.InitializeResult() != nil {
			row.Connected = true
			row.InstructionBytes = len(session.InitializeResult().Instructions)
		}
		rows = append(rows, row)
	}
	return model.PaginateCatalog(rows, offset, limit)
}

// ReadInstructions recovers initialize text from the live connection retained by
// the existing MCP owner. It sends no request and grants no additional authority.
func (d *ResourceDirectory) ReadInstructions(server string, offset, limit int) (InstructionPage, error) {
	page := InstructionPage{Server: server}
	if d == nil || d.endpoints[server] == nil {
		return page, fmt.Errorf("MCP instruction server %q is unavailable in this agent's scope", server)
	}
	session := d.endpoints[server].session.Load()
	if session == nil || session.InitializeResult() == nil {
		return page, fmt.Errorf("mcp-client(%s): server is disconnected", server)
	}
	text := session.InitializeResult().Instructions
	var err error
	page.CatalogTextRange, err = model.PaginateCatalogText(text, offset, limit)
	return page, err
}
