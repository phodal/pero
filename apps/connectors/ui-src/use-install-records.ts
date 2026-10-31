import { useEffect, useState } from 'react';
import type { Reply } from './connector-types.ts';

/** `recorded` is read from ~/.point/connector.json and not yet re-checked. */
export type InstallRecordState = 'recorded' | 'ready' | 'running';

/**
 * Managed installs the Host recorded, for cards that have no connection yet.
 * The record loads first so cards update at once; each one is then verified
 * in turn. Becoming inactive (leaving the page, opening a dialog) cancels the
 * remaining checks; becoming active again starts a fresh pass.
 */
export function useInstallRecords(request: (payload: Record<string, unknown>) => Promise<Reply>, active: boolean) {
  const [states, setStates] = useState<Record<string, InstallRecordState>>({});
  const [pass, setPass] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: number | undefined;
    void (async () => {
      const reply = await request({ operation: 'install.records' }).catch(() => null);
      if (cancelled || !reply?.ok) return;
      const next: Record<string, InstallRecordState> = {};
      for (const record of reply.records ?? []) next[record.providerId] = 'recorded';
      for (const providerId of reply.running ?? []) next[providerId] = 'running';
      setStates(next);
      for (const [providerId, state] of Object.entries(next)) {
        if (cancelled) return;
        if (state !== 'recorded') continue;
        const verified = await request({ operation: 'install.verify', providerId }).catch(() => null);
        if (cancelled) return;
        // An unanswered check keeps the record; only the Host's "missing" drops it.
        if (verified?.ok) setStates(current => {
          const { [providerId]: _, ...rest } = current;
          return verified.state === 'ready' ? { ...current, [providerId]: 'ready' } : rest;
        });
      }
      // A job started from a dialog keeps running after it closes; look again until it ends.
      if (!cancelled && (reply.running ?? []).length) timer = window.setTimeout(() => setPass(n => n + 1), 2000);
    })();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active, pass, request]);
  return states;
}
