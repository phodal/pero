// Stdio MCP App for the saved Notebook read. Revisions and document bytes stay in Notebook.
import {appendFileSync, readFileSync} from 'node:fs';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';

const uri = 'ui://pero/notebook/inspector-v1';
const tool = 'app__notebook__read-entry';
const url = process.env.PERO_NOTEBOOK_URL;
const gate = process.env.PERO_NOTEBOOK_GATE;
const htmlPath = process.env.PERO_NOTEBOOK_HTML;
const audit = process.env.PERO_NOTEBOOK_AUDIT;
if (!url || !gate || !htmlPath || !audit) {
  console.error('Notebook Inspector MCP server is missing its Notebook endpoint');
  process.exit(1);
}
const html = readFileSync(htmlPath, 'utf8');

function record(entry) {
  appendFileSync(audit, `${JSON.stringify(entry)}\n`);
}

async function readEntry(arguments_) {
  const response = await fetch(`${url}/api/agent-read`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Pero-App-Token': gate},
    body: JSON.stringify(arguments_),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || body.message || `Notebook read failed (${response.status})`);
  return body;
}

const server = new McpServer({name: 'pero-notebook-inspector', version: '0.1.0'});
server.registerResource('inspector', uri, {mimeType: 'text/html;profile=mcp-app'}, async () => ({
  contents: [{uri, mimeType: 'text/html;profile=mcp-app', text: html}],
}));
server.registerTool(tool, {
  title: 'Notebook Inspector',
  description: 'Read one saved Notebook revision. The Notebook service owns the revision, document, and scientific state.',
  inputSchema: {
    entryId: z.string(),
    revision: z.number().int().optional(),
    blockId: z.string().optional(),
    offset: z.number().int().optional(),
    view: z.enum(['index']).optional(),
  },
  annotations: {readOnlyHint: true},
  _meta: {ui: {resourceUri: uri}},
}, async arguments_ => {
  record({name: tool, arguments: arguments_});
  const entry = await readEntry(arguments_);
  const text = JSON.stringify(entry);
  return {
    content: [{type: 'text', text}],
    structuredContent: {app: 'notebook', tool: 'read-entry', result: entry},
  };
});
await server.connect(new StdioServerTransport());
