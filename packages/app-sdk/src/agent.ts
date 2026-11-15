import { useHostCapability, type AppAgent } from './host';
import { createAppAgent } from './agent.mjs';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Info = { available: boolean; agents: { id: string; name: string; available: boolean }[]; workspace: string };
export type AppTranscript = { events: { kind: string; text: string }[]; cursor: number; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs_input'; text: string };

async function request<T>(body: object): Promise<T> {
  const response = await fetch('/host/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.text()).slice(0, 1000) || `Host request failed (${response.status})`);
  return await response.json() as T;
}

/** App documents receive only their own Host session projection, never credentials. */
type LegacyStart = { requestId: string; prompt: string; agentId: string };
type LegacyRef = { sessionId: string };
type LegacyAgent = Info & {
  infoLoading: boolean;
  refresh(): Promise<Info>;
  start(input: LegacyStart): Promise<{sessionId: string}>;
  events(input: LegacyRef & {after: number}): Promise<AppTranscript>;
  cancel(input: LegacyRef): Promise<void>;
};

export function useAppAgent(): AppAgent & LegacyAgent {
  const capability = useHostCapability('agent');
  const modern = useMemo(() => createAppAgent(capability), [capability]);
  const [info, setInfo] = useState<Info>({ available: false, agents: [], workspace: '' });
  const [infoLoading, setInfoLoading] = useState(true);
  const refresh = useCallback(async () => {
    setInfoLoading(true);
    try {
      const next = await request<Info>({ operation: 'info' });
      setInfo(next);
      return next;
    } catch {
      const next: Info = { available: false, agents: [], workspace: '' };
      setInfo(next);
      return next;
    } finally {
      setInfoLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return useMemo(() => {
    const supported = () => {
      if (!modern) throw new Error('This App has no agent Host capability');
      return modern;
    };
    return { ...info, infoLoading, refresh,
      scienceSessions: () => supported().scienceSessions(),
      science: input => supported().science(input),
      prepare: input => supported().prepare(input),
      lookup: input => supported().lookup(input),
      status: input => supported().status(input),
      retry: input => supported().retry(input),
      terminal: input => supported().terminal(input),
      start: ((input: LegacyStart | Parameters<AppAgent['start']>[0]) => 'scope' in input
        ? supported().start(input) : request<{sessionId: string}>({operation:'start', ...input})) as AppAgent['start'] & LegacyAgent['start'],
      events: ((input: LegacyRef & {after: number} | Parameters<AppAgent['events']>[0]) => 'scope' in input
        ? supported().events(input) : request<AppTranscript>({operation:'events', ...input})) as AppAgent['events'] & LegacyAgent['events'],
      cancel: ((input: LegacyRef | Parameters<AppAgent['cancel']>[0]) => 'scope' in input
        ? supported().cancel(input) : request<void>({operation:'cancel', ...input})) as AppAgent['cancel'] & LegacyAgent['cancel'],
    } satisfies AppAgent & LegacyAgent;
  }, [info, infoLoading, refresh, modern]);
}
