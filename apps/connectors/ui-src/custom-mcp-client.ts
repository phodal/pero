import { requestAppShell } from '@pero/app-sdk';

export type McpAgent = { id: string; name: string; available: boolean };
export type McpServer = {
  name: string;
  enabled?: boolean;
  transport: { type: 'stdio'; command: string; args?: string[] } | { type: 'http'; url: string };
  tool_policy?: { default: 'allow' | 'ask' | 'deny'; tools?: Record<string, 'allow' | 'ask' | 'deny'> };
};
export type McpSession = {
  thread_id?: string;
  revision?: number;
  observable?: boolean;
  closed?: boolean;
  servers?: { server: string; status: string; tools?: string[] }[];
};
export type McpSettingsView = {
  agents: McpAgent[];
  agent_id: string;
  revision: number;
  servers: McpServer[];
  sessions: McpSession[];
};

export function loadCustomMcps(agentId = ''): Promise<McpSettingsView> {
  return requestAppShell<McpSettingsView>('mcp-settings', { method: 'settings.mcp.get', agent_id: agentId });
}

export function saveCustomMcps(agentId: string, revision: number, servers: McpServer[]): Promise<McpSettingsView> {
  return requestAppShell<McpSettingsView>('mcp-settings', { method: 'settings.mcp.set', agent_id: agentId, revision, servers });
}
