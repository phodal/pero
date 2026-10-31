import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const server = new McpServer({ name: 'pinned-fixture', version: '1' });
server.registerTool('read_binding', { inputSchema: {}, annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ label: process.env.PROJECT_NAME, authenticated: process.env.API_TOKEN === 'stdio-private-value' }) }] }));
await server.connect(new StdioServerTransport());
