import { useCallback, useEffect, useRef, useState } from 'react';
import { AppApiError } from '@pero/app-sdk';
import type { Api, Library } from './types';

const emptyLibrary = (): Library => ({ papers: [], intents: [], reports: [] });

/** Refreshing the same library keeps its consumers mounted and their drafts intact. */
export function useLibraryData(api: Api, active: boolean) {
  const [state, setState] = useState(() => ({ api, library: emptyLibrary(), loaded: false, pending: true, error: '' }));
  const version = useRef(0), mounted = useRef(true);
  const scope = useRef(api);
  scope.current = api;
  // API identity belongs to the provider's permission/Session scope. Reset in
  // render so a different scope cannot commit a frame with the former library.
  if (state.api !== api) {
    version.current++;
    setState({ api, library: emptyLibrary(), loaded: false, pending: true, error: '' });
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; version.current++; }; }, []);
  const refresh = useCallback(async () => {
    if (!mounted.current || scope.current !== api) return;
    const current = ++version.current;
    setState(previous => ({ ...previous, pending: true, error: '' }));
    try {
      const result = await api.get<Library>('/api/library');
      if (mounted.current && scope.current === api && current === version.current) setState({ api, library: result, loaded: true, pending: false, error: '' });
    } catch (reason) {
      if (mounted.current && scope.current === api && current === version.current) {
        const error = reason instanceof Error ? reason.message : String(reason);
        setState(previous => reason instanceof AppApiError && (reason.status === 401 || reason.status === 403)
          ? { api, library: emptyLibrary(), loaded: false, pending: false, error }
          : { ...previous, error });
      }
      throw reason;
    } finally { if (mounted.current && scope.current === api && current === version.current) setState(previous => ({ ...previous, pending: false })); }
  }, [api]);
  useEffect(() => { if (active) void refresh().catch(() => {}); }, [active, refresh]);
  const { library, loaded, pending, error } = state;
  return { library, loaded, loading: pending && !loaded, refreshing: pending && loaded, error, refresh };
}
