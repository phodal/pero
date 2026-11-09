import { useEffect, useRef, useState } from 'react';
import { useAppApi } from '@pero/app-sdk';
import { recoveredAIWorkspace, type AIRecovery, type AIWorkspace } from '@pero/notebook/ai-generation';

/** Serialize writes at the UI boundary. Version conflicts preserve the remote record. */
export function useAIRecovery(entryId: string) {
  const api = useAppApi(), [workspace, setWorkspace] = useState<AIWorkspace>({ version: 0, record: null });
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const state = useRef(workspace), live = useRef(true), writing = useRef(false), latest = useRef(api); latest.current = api;
  const path = `/api/entries/${entryId}/ai-workspace`;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function load() {
    setLoaded(false); setError('');
    try { const value = await recoveredAIWorkspace(await latest.current.get(path)); state.current = value; if (live.current) { setWorkspace(value); setLoaded(true); } }
    catch (cause) { if (live.current) setError(String(cause)); }
  }
  useEffect(() => { void load(); }, [entryId]);
  async function save(record: AIRecovery) {
    if (writing.current) throw new Error('An AI recovery write is already pending. Wait for its outcome.');
    if (JSON.stringify(record).length > 1_800_000) throw new Error('The AI recovery record exceeds the local 1.8 MB limit. Reduce the draft or output.');
    writing.current = true; if (live.current) setBusy(true);
    try {
      const next = await recoveredAIWorkspace(await latest.current.post(path, { expectedVersion: state.current.version, record }));
      state.current = next;
      if (live.current) { setWorkspace(next); setError(''); }
      return next.record!;
    } catch (cause) {
      // Do not overwrite or retry a write whose response was lost. Reload explicitly first.
      if (live.current) { setLoaded(false); setError(`Recovery save failed or its outcome is unknown. Reload recovery before continuing. ${String(cause)}`); }
      throw cause;
    } finally { writing.current = false; if (live.current) setBusy(false); }
  }
  return { workspace, state, loaded, busy, error, load, save };
}
