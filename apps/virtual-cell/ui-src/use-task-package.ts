import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppInfo } from '@pero/app-sdk';
import type { ModelEndpoint, TaskPackage } from './comparison';

/** Observe the App-owned baseline endpoint; Host still owns its backend process. */
export function useTaskPackage(visible: boolean, runRevision: string) {
  const api = useAppApi(), { active } = useAppInfo();
  const [taskPackage, setTaskPackage] = useState<TaskPackage | null>(null);
  const [model, setModel] = useState<ModelEndpoint | null>(null);
  const [pending, setPending] = useState<'start' | 'stop' | null>(null);
  const [readError, setReadError] = useState(''), [actionError, setActionError] = useState('');
  const [revision, setRevision] = useState(0), [reconciling, setReconciling] = useState(false);
  const generation = useRef(0), gate = useRef(false);
  function refresh() { generation.current++; setActionError(''); setRevision(value => value + 1); }
  useEffect(() => {
    if (!active || !visible) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function observe() {
      const currentGeneration = generation.current;
      try {
        const [declaration, endpoint] = await Promise.all([
          api.get<TaskPackage>('/api/task-package'), api.get<ModelEndpoint>('/api/model'),
        ]);
        if (disposed || currentGeneration !== generation.current) return;
        setTaskPackage(declaration); setModel(endpoint); setReadError(''); setReconciling(false);
        if (['starting', 'in_use', 'stopping'].includes(endpoint.status)) timer = setTimeout(observe, 1000);
      } catch (error) {
        if (disposed || currentGeneration !== generation.current) return;
        setReadError(error instanceof Error ? error.message : String(error));
        timer = setTimeout(observe, 2500);
      }
    }
    void observe();
    return () => { disposed = true; clearTimeout(timer); };
  }, [active, visible, runRevision, revision, api]);
  async function request(action: 'start' | 'stop', inputId?: string) {
    if (gate.current || reconciling || readError || !model) return;
    gate.current = true; generation.current++; setPending(action); setActionError('');
    setRevision(value => value + 1);
    try {
      const endpoint = await api.post<ModelEndpoint>(`/api/model/${action}`, action === 'start' ? { inputId } : {});
      generation.current++; setModel(endpoint);
    } catch (error) {
      generation.current++; setReconciling(true);
      setActionError(error instanceof Error ? error.message : String(error));
    } finally { gate.current = false; setPending(null); setRevision(value => value + 1); }
  }
  return { taskPackage, model, pending, refresh, request,
    disabled: !!pending || reconciling || !!readError,
    error: [actionError, readError].filter(Boolean).join('; '),
  };
}
