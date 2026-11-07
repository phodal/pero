export type McpAgent = { id: string; name: string; available: boolean };
export type McpSettingsCommand =
  | { method: 'settings.mcp.get'; agent_id: string }
  | { method: 'settings.mcp.set'; agent_id: string; revision: number; servers: unknown[] };

const GET_KEYS = new Set(['method', 'agent_id']);
const SET_KEYS = new Set(['method', 'agent_id', 'revision', 'servers']);

function agentId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || [...value].some(char => char.charCodeAt(0) < 32)) throw new Error('invalid');
  return value;
}

/** Admit one App request before it becomes a Host settings command. */
export function admitMcpSettingsInput(input: unknown): McpSettingsCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 256_000) throw new Error('invalid');
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  const method = value.method;
  if (method === 'settings.mcp.get') {
    if (keys.some(key => !GET_KEYS.has(key))) throw new Error('invalid');
    return { method, agent_id: agentId(value.agent_id) };
  }
  if (method === 'settings.mcp.set') {
    if (keys.some(key => !SET_KEYS.has(key))) throw new Error('invalid');
    const id = agentId(value.agent_id);
    if (!id) throw new Error('invalid');
    if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('invalid');
    if (!Array.isArray(value.servers) || value.servers.length > 64) throw new Error('invalid');
    return { method, agent_id: id, revision: value.revision, servers: value.servers };
  }
  throw new Error('invalid');
}

export function admitAgents(value: unknown): McpAgent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const agent = item as Record<string, unknown>;
    if (typeof agent.id !== 'string' || !agent.id || agent.id.length > 128 || typeof agent.name !== 'string' || agent.name.length > 256) return [];
    return [{ id: agent.id, name: agent.name, available: agent.available === true }];
  });
}

/** An explicit id is kept so the Host can reject an unknown Agent. An empty id picks a local Agent. */
export function chooseAgent(agents: McpAgent[], requested: string): string {
  if (requested) return requested;
  return agents.find(agent => agent.available)?.id ?? agents[0]?.id ?? '';
}

export function projectionFromEvent(data: unknown, agents: McpAgent[]) {
  const value = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return {
    agents,
    agent_id: typeof value.agent_id === 'string' ? value.agent_id : '',
    revision: typeof value.revision === 'number' ? value.revision : 0,
    servers: Array.isArray(value.servers) ? value.servers : [],
    sessions: Array.isArray(value.sessions) ? value.sessions : [],
  };
}

type HostEvent = { kind: string; request_id: string | null; data?: unknown };
type Host = {
  sessionCommand(command: object): Promise<void>;
  onEvent(callback: (event: HostEvent) => void): () => void;
};

/** One correlated settings read or write. The Host remains the only writer. */
export async function exchangeMcpSettings(host: Host, input: unknown, agents: McpAgent[], requestId: string) {
  const admitted = admitMcpSettingsInput(input);
  const command: Record<string, unknown> = admitted.method === 'settings.mcp.get'
    ? { method: admitted.method, agent_id: chooseAgent(agents, admitted.agent_id) }
    : { method: admitted.method, agent_id: admitted.agent_id, revision: admitted.revision, servers: admitted.servers };
  if (admitted.method === 'settings.mcp.get' && !command.agent_id) {
    return { agents, agent_id: '', revision: 0, servers: [], sessions: [] };
  }
  const event = await new Promise<HostEvent>((resolve, reject) => {
    let stop = () => {};
    const timer = setTimeout(() => { stop(); reject(new Error('unavailable')); }, 15000);
    stop = host.onEvent(message => {
      if (message.request_id !== requestId) return;
      if (message.kind !== 'mcp_settings' && message.kind !== 'mcp_settings_error') return;
      clearTimeout(timer); stop(); resolve(message);
    });
    host.sessionCommand({ ...command, request_id: requestId }).catch(error => {
      clearTimeout(timer); stop(); reject(error instanceof Error ? error : new Error('unavailable'));
    });
  });
  if (event.kind === 'mcp_settings_error') {
    const reason = event.data && typeof event.data === 'object' && typeof (event.data as { reason?: unknown }).reason === 'string'
      ? (event.data as { reason: string }).reason : 'unavailable';
    throw new Error(reason);
  }
  return projectionFromEvent(event.data, agents);
}
