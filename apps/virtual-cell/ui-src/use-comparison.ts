import { useEffect, useRef, useState } from 'react';
import { downloadFile, useAppApi, useAppInfo } from '@pero/app-sdk';
import { comparisonActive, datasetAction, datasetActive, type ComparisonDetail, type ComparisonInput, type ComparisonOutput, type ComparisonRun, type DatasetDownload } from './comparison';
import type { Translate } from './messages';

const ROOT = '/api/comparisons';

export function useComparison(visible: boolean, t: Translate) {
  const api = useAppApi(), { active } = useAppInfo();
  const [items, setItems] = useState<ComparisonRun[]>([]), [selected, setSelected] = useState('');
  const [run, setRun] = useState<ComparisonDetail | null>(null), [loaded, setLoaded] = useState(false);
  const [availability, setAvailability] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [pending, setPending] = useState<'start' | 'cancel' | 'export' | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [readError, setReadError] = useState(''), [actionError, setActionError] = useState('');
  const [artifactError, setArtifactError] = useState(''), [refreshKey, setRefreshKey] = useState(0);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  const [input, setInput] = useState<{ id: string; value: ComparisonInput; content: string } | null>(null);
  const [output, setOutput] = useState<{ id: string; value: ComparisonOutput; content: string } | null>(null);
  const generation = useRef(0), selectedRef = useRef(''), gate = useRef(false);

  function choose(id: string) {
    if (id === selectedRef.current) return;
    generation.current++;
    selectedRef.current = id; setSelected(id); setRun(null); setArtifactError('');
  }
  function refresh() {
    generation.current++; setRefreshKey(key => key + 1); setActionError('');
  }

  useEffect(() => {
    if (!active || !visible) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function observe() {
      const revision = generation.current;
      const current = () => !disposed && revision === generation.current;
      try {
        const list = await api.get<{ items: ComparisonRun[]; availability: { available: boolean; reason: string | null } }>(ROOT);
        if (!current()) return;
        setItems(list.items); setAvailability(list.availability); setLoaded(true); setReadError(''); setReconciling(false);
        const id = selectedRef.current || list.items[0]?.id;
        if (id && id !== selectedRef.current) { choose(id); return; }
        if (id) {
          const detail = await api.get<ComparisonDetail>(`${ROOT}/${id}`);
          if (!current()) return;
          setRun(detail);
        }
        if (list.items.some(item => comparisonActive(item.status))) timer = setTimeout(observe, 1000);
      } catch (error) {
        if (current()) {
          setReadError(error instanceof Error ? error.message : String(error)); setLoaded(true);
          timer = setTimeout(observe, 2500);
        }
      }
    }
    void observe();
    return () => { disposed = true; clearTimeout(timer); };
  }, [active, visible, selected, refreshKey, api]);

  useEffect(() => {
    let disposed = false;
    setInput(null); setOutput(null); setArtifactError('');
    setLoadingArtifacts(!!run);
    if (!run) return;
    async function readArtifacts() {
      try {
        const source = await api.get<{ content: string }>(`/api/artifacts/${run.inputId}/export`);
        if (disposed) return;
        setInput({ id: run.inputId, value: JSON.parse(source.content), content: source.content });
        if (run.status === 'succeeded' && run.outputId) {
          const document = await api.get<{ content: string }>(`/api/artifacts/${run.outputId}/export`);
          if (!disposed) setOutput({ id: run.outputId, value: JSON.parse(document.content), content: document.content });
        }
      } catch (error) {
        if (!disposed) setArtifactError(error instanceof Error ? error.message : String(error));
      } finally { if (!disposed) setLoadingArtifacts(false); }
    }
    void readArtifacts();
    return () => { disposed = true; };
  }, [run?.inputId, run?.outputId, run?.status, refreshKey, api]);

  async function start(inputId: string) {
    if (gate.current || reconciling || !availability?.available || readError || items.some(item => comparisonActive(item.status))) return;
    gate.current = true; generation.current++; setPending('start'); setActionError('');
    const selectionRevision = generation.current;
    try {
      const detail = await api.post<ComparisonDetail>(ROOT, { inputId });
      const selectionUnchanged = generation.current === selectionRevision;
      generation.current++;
      if (selectionUnchanged) { selectedRef.current = detail.id; setSelected(detail.id); setRun(detail); }
      setItems(previous => [detail, ...previous.filter(item => item.id !== detail.id)]);
    } catch (error) {
      // A transport failure is not permission to repeat a possibly accepted POST.
      setReconciling(true);
      setActionError(`${error instanceof Error ? error.message : String(error)}. ${t('comparisonCheckHistory')}`);
      if (generation.current === selectionRevision) { selectedRef.current = ''; setSelected(''); setRun(null); }
      generation.current++;
    } finally {
      gate.current = false; setPending(null); setRefreshKey(key => key + 1);
    }
  }
  async function cancel() {
    if (gate.current || !run || !comparisonActive(run.status) || run.status === 'cancelling') return;
    const id = run.id;
    gate.current = true; generation.current++; setPending('cancel'); setActionError('');
    try {
      const detail = await api.post<ComparisonDetail>(`${ROOT}/${id}/cancel`, {});
      generation.current++;
      setItems(previous => previous.map(item => item.id === id ? detail : item));
      if (selectedRef.current === id) setRun(detail);
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { gate.current = false; setPending(null); setRefreshKey(key => key + 1); }
  }
  async function exportRun() {
    if (gate.current || !run) return;
    gate.current = true; setPending('export'); setActionError('');
    try {
      const document = await api.get<{ content: string }>(`${ROOT}/${run.id}/export`);
      downloadFile(`virtual-cell-comparison-${run.id}.json`, document.content, 'application/json');
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { gate.current = false; setPending(null); }
  }
  return {
    items, selected, choose, run, loaded, pending, refresh, start, cancel, exportRun, availability, loadingArtifacts,
    canStart: loaded && !!availability?.available && !readError && !pending && !reconciling && !items.some(item => comparisonActive(item.status)),
    error: [actionError, readError, artifactError].filter(Boolean).join('; '),
    running: items.find(item => comparisonActive(item.status)),
    input: input?.id === run?.inputId ? input : null,
    output: run?.status === 'succeeded' && output?.id === run.outputId ? output : null,
  };
}

/** One fixed raw source; no discovery, automatic transfer or scientific work. */
export function useDatasetDownload(visible: boolean, t: Translate) {
  const api = useAppApi(), { active } = useAppInfo();
  const [dataset, setDataset] = useState<DatasetDownload | null>(null);
  const [pending, setPending] = useState<'download' | 'cancel' | null>(null), [reconciling, setReconciling] = useState(false);
  const [readError, setReadError] = useState(''), [actionError, setActionError] = useState(''), [refreshKey, setRefreshKey] = useState(0);
  const generation = useRef(0), gate = useRef(false);
  function refresh() { generation.current++; setRefreshKey(key => key + 1); setActionError(''); }
  useEffect(() => {
    if (!active || !visible) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function observe() {
      const revision = generation.current;
      const current = () => !disposed && revision === generation.current;
      try {
        const value = await api.get<DatasetDownload>('/api/dataset');
        if (!current()) return;
        setDataset(value); setReadError(''); setReconciling(false);
        if (datasetActive(value.status)) timer = setTimeout(observe, 1000);
      } catch (error) {
        if (current()) {
          setReadError(error instanceof Error ? error.message : String(error));
          timer = setTimeout(observe, 2500);
        }
      }
    }
    void observe();
    return () => { disposed = true; clearTimeout(timer); };
  }, [active, visible, refreshKey, api]);
  async function request(action: 'download' | 'cancel') {
    if (gate.current || reconciling || !dataset || readError) return;
    if (action === 'download' ? !datasetAction(dataset.status) : !datasetActive(dataset.status) || dataset.status === 'cancelling') return;
    gate.current = true; generation.current++; setPending(action); setActionError('');
    // Observe backend cancellation while its POST waits for the transfer to stop.
    setRefreshKey(key => key + 1);
    try {
      const value = await api.post<DatasetDownload>(`/api/dataset/${action}`, {});
      generation.current++; setDataset(value);
    } catch (error) {
      generation.current++; setReconciling(true);
      setActionError(`${error instanceof Error ? error.message : String(error)}. ${t('datasetCheckStatus')}`);
    } finally {
      gate.current = false; setPending(null); setRefreshKey(key => key + 1);
    }
  }
  return {
    dataset, pending, request, refresh,
    error: [actionError, readError].filter(Boolean).join('; '),
    disabled: !!pending || reconciling || !!readError,
  };
}
