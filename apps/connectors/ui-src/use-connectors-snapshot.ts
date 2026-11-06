import { useCallback, useEffect, useRef, useState } from 'react';
import { connectorRequest } from './bridge';
import type { ConnectionView, DirectoryEntry, RawEntry } from './connector-types';
import { errorMessage } from './error-message';
import { errorText } from './shared/connection-copy.mjs';

type RefreshScope = { pending: Promise<void> | null; load(): Promise<void> };

/** Each mounted locale owns its requests and polling; retained data stays mounted. */
export function useConnectorsSnapshot(locale: 'zh' | 'en') {
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [connections, setConnections] = useState<ConnectionView[]>([]);
  const [entries, setEntries] = useState<RawEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false);
  const scope = useRef<RefreshScope | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    const current: RefreshScope = { pending: null, load };
    const active = () => scope.current === current;
    const schedule = (delay: number) => {
      if (active()) timer = window.setTimeout(() => { if (active()) void load(); }, delay);
    };
    function load(): Promise<void> {
      if (!active()) return Promise.resolve();
      if (current.pending) return current.pending;
      setRefreshing(true);
      if (timer !== null) window.clearTimeout(timer);
      current.pending = (async () => {
        try {
          const snap = await connectorRequest({ operation: 'snapshot' });
          if (!active()) return;
          if (!snap.ok) {
            if (snap.code === 'MCP_CONTROL_BUSY') { schedule(1000); return; }
            throw new Error(errorText(snap.code, locale));
          }
          setDirectory(snap.directory); setConnections(snap.connections);
          setError(''); setLoading(false);
          const list = await connectorRequest({ operation: 'list' }).catch(() => ({ ok: false as const }));
          if (!active()) return;
          if (list.ok) setEntries(list.result);
          const waiting = (snap.connections as ConnectionView[]).find(connection => connection.attempt);
          if (waiting) schedule(waiting.attempt!.pollIntervalMs || 1500);
          else if ((snap.connections as ConnectionView[]).some(connection => ['connecting', 'connected'].includes(connection.state) || connection.busy)) schedule(2000);
        } catch (reason) {
          if (active()) { setError(errorMessage(reason)); setLoading(false); }
        } finally {
          if (active()) setRefreshing(false);
          current.pending = null;
        }
      })();
      return current.pending;
    }
    scope.current = current;
    void load();
    return () => {
      if (scope.current === current) scope.current = null;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [locale]);

  // A mutation needs a snapshot taken after it, even when a poll was already in flight.
  const reload = useCallback(async () => {
    const current = scope.current;
    if (current?.pending) await current.pending;
    if (current && scope.current === current) await current.load();
  }, []);
  return { directory, connections, entries, error, loading, refreshing, reload };
}
