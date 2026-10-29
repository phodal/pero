import { useCallback, useEffect, useMemo, useState } from 'react';

type Info = { available: boolean; agents: { id: string; name: string; available: boolean }[]; workspace: string };
export type AppTranscript = { events: { kind: string; text: string }[]; cursor: number; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs_input'; text: string };

async function request<T>(body: object): Promise<T> {
  const response = await fetch('/host/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.text()).slice(0, 1000) || `Host request failed (${response.status})`);
  return await response.json() as T;
}

/** App documents receive only their own Host session projection, never credentials. */
export function useAppAgent() {
  const [info, setInfo] = useState<Info>({ available: false, agents: [], workspace: '' });
  const refresh = useCallback(async () => {
    try { setInfo(await request<Info>({ operation: 'info' })); }
    catch { setInfo({ available: false, agents: [], workspace: '' }); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return useMemo(() => ({ ...info, refresh,
    start: (input: { requestId: string; prompt: string; agentId: string }) => request<{ sessionId: string }>({ operation: 'start', ...input }),
    events: (input: { sessionId: string; after: number }) => request<AppTranscript>({ operation: 'events', ...input }),
    cancel: async (input: { sessionId: string }) => { await request({ operation: 'cancel', ...input }); },
  }), [info, refresh]);
}
