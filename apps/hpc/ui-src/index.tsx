import React, { useCallback, useEffect, useState } from "react";
import { appObjectProps, useAppApi, useAppChat, useAppContext, useAppDataChanged, useAppI18n, useAppObject } from "@pero/app-sdk";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pero/app-sdk/ui";
import { messages, type Message } from "./messages";
import { ComparisonTable, RunEvidence, RunTable } from "./results";
import { MethodSpec } from "./method";
import type { Benchmark, Comparison, Run, State } from "./types";
import "./styles.css";

const noParameters = { type: "object", properties: {}, additionalProperties: false };
const idParameters = {
  type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
  required: ["id"], additionalProperties: false,
};

export default function HpcBenchmarks() {
  const api = useAppApi(), chat = useAppChat(), context = useAppContext(), { t } = useAppI18n(messages);
  const [data, setData] = useState<State | null>(null);
  const [benchmarkId, setBenchmarkId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [tab, setTab] = useState("method");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Message | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const selectedBenchmark = data?.benchmarks.find(item => item.id === benchmarkId) ?? data?.benchmarks[0];
  const latestRun = data?.runs.find(item => item.benchmarkId === selectedBenchmark?.id);
  const selectedRun = data?.runs.find(item => item.id === selectedRunId) ?? latestRun;
  const active = data?.runs.some(run => run.status === "running" || run.operation);
  const comparedRuns = data?.runs.filter(run => chosen.includes(run.id)) ?? [];
  const differentSpecs = new Set(comparedRuns.map(run => run.specDigest)).size > 1;
  const canCompare = chosen.length >= 2 && !differentSpecs && !busy;

  const onError = (value: unknown) => { setError(value instanceof Error ? value.message : String(value)); setNotice(null); };
  const refresh = useCallback(async () => {
    const state = await api.get<State>("/api/state");
    setData(state);
    return state;
  }, [api]);
  const initialize = useCallback(async () => {
    setLoading(true); setError("");
    try { await refresh(); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLoading(false); }
  }, [refresh]);
  useEffect(() => { void initialize(); }, [initialize]);
  useAppDataChanged(async () => { await refresh().catch(onError); });
  useEffect(() => {
    if (!active || !context.active) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void api.get<State>("/api/state").then(state => { if (!stopped) setData(state); }).catch(value => {
        if (!stopped) setError(value instanceof Error ? value.message : String(value));
      });
    }, 1200);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [active, context.active, api]);

  function chooseBenchmark(benchmark: Benchmark) { setBenchmarkId(benchmark.id); setSelectedRunId(""); setTab("method"); }
  async function openRun(run: Run) {
    setSelectedRunId(run.id); setBenchmarkId(run.benchmarkId); setTab("runs");
    const result = await api.get<{ run: Run }>(`/api/runs/${encodeURIComponent(run.id)}`);
    setData(prior => prior ? { ...prior, runs: prior.runs.map(item => item.id === run.id ? result.run : item) } : prior);
  }
  async function startRun() {
    if (!selectedBenchmark) return;
    setBusy(true); setError(""); setNotice(null);
    try {
      const { run } = await api.post<{ run: Run }>("/api/runs", { benchmarkId: selectedBenchmark.id });
      setSelectedRunId(run.id); setTab("runs");
      await refresh();
    } catch (value) { onError(value); }
    finally { setBusy(false); }
  }
  async function act(action: "cancel" | "verify") {
    if (!selectedRun) return;
    if (action === "cancel" && !window.confirm(t("cancelConfirm"))) return;
    setBusy(true); setError(""); setNotice(null);
    try {
      await api.post<{ run: Run }>(`/api/runs/${encodeURIComponent(selectedRun.id)}/${action}`, {});
      await refresh();
      if (action === "cancel") setNotice("cancelledNotice");
    } catch (value) { onError(value); }
    finally { setBusy(false); }
  }
  async function exportEvidence() {
    if (!selectedRun) return;
    setExporting(true); setError(""); setNotice(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(selectedRun.id)}/export`);
      if (!response.ok) throw new Error((await response.text()).slice(0, 500) || `Export failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = `hpc-${selectedRun.id}.zip`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("exported");
    } catch (value) { onError(value); }
    finally { setExporting(false); }
  }
  function chooseRun(run: Run, checked: boolean) {
    setChosen(prior => checked ? [...prior, run.id] : prior.filter(id => id !== run.id));
    setComparison(null);
  }
  async function compareRuns() {
    setBusy(true); setError(""); setComparison(null);
    try {
      const result = await api.post<{ comparison: Comparison }>("/api/compare", { runIds: chosen });
      setComparison(result.comparison); setTab("compare");
    } catch (value) { onError(value); }
    finally { setBusy(false); }
  }
  async function discuss() {
    await chat.compose(context.locale === "zh-CN"
      ? `审阅 HPC 基准 ${selectedBenchmark?.name ?? ""}${selectedRun ? ` 的运行 ${selectedRun.id}` : ""}。先检查固定规格与原始证据，区分进程成功和独立检查。当前只有本地 CPU 参考，不能声称 Slurm、MPI 或 OpenFOAM 实测。`
      : `Review HPC benchmark ${selectedBenchmark?.name ?? ""}${selectedRun ? ` run ${selectedRun.id}` : ""}. Inspect the fixed specification and original evidence. Distinguish process completion from independent verification. The current runtime is a local CPU reference; do not claim Slurm, MPI or OpenFOAM execution.`,
    { attachments: [chat.objectReference("hpc-benchmarks")] });
  }

  useAppObject({
    id: "hpc-benchmarks", kind: "scientific-benchmarks", label: "HPC Benchmarks",
    state: {
      loading, busy, error: error || null, runtime: data?.runtime ?? null,
      benchmarks: data?.benchmarks ?? [], selectedBenchmarkId: selectedBenchmark?.id ?? null,
      selectedRun: selectedRun ? { ...selectedRun, logs: selectedRun.logs.slice(-4000) } : null,
      runs: data?.runs.slice(0, 40).map(run => ({
        id: run.id, benchmarkId: run.benchmarkId, specDigest: run.specDigest, status: run.status,
        executionKind: run.executionKind, verificationStatus: run.verification?.status ?? null,
      })) ?? [], comparison,
    },
    actions: {
      refresh: { description: "Read the saved benchmark catalog, runtime availability and existing runs. Does not start computation.", parameters: noParameters, run: refresh },
      inspect_benchmark: { description: "Select an existing benchmark and its fixed specification without running it.", parameters: idParameters, run: ({ id }) => {
        const benchmark = data?.benchmarks.find(item => item.id === id);
        if (!benchmark) throw new Error("Benchmark not found");
        chooseBenchmark(benchmark);
      } },
      inspect_run: { description: "Read an existing run, independent checks and evidence without rerunning it.", parameters: idParameters, run: ({ id }) => {
        const run = data?.runs.find(item => item.id === id);
        if (!run) throw new Error("Run not found");
        return openRun(run);
      } },
    },
  });

  return <div className="hpc-app" {...appObjectProps("hpc-benchmarks")}>
    <header className="app-header"><h1>{t("title")}</h1><span className="runtime-label">{t("local")}</span>
      <div className="toolbar">{notice && <span className="muted" role="status">{t(notice)}</span>}<button disabled={loading || busy} onClick={() => void refresh().catch(onError)}>{t("refresh")}</button>
        <button disabled={loading || !selectedBenchmark} onClick={() => void discuss().catch(onError)}>{t("discuss")}</button>
        <button className="primary" disabled={loading || busy || Boolean(active) || !selectedBenchmark?.available || !data?.runtime.reframeAvailable} onClick={() => void startRun()}>{t(selectedBenchmark?.available ? "run" : "runBenchmark")}</button></div>
    </header>
    {error && <div className="feedback feedback-error" role="alert"><span>{error}</span><button onClick={() => void initialize()}>{t("reload")}</button></div>}
    {data && !data.runtime.reframeAvailable && <div className="feedback feedback-warning" role="status"><span>{data.runtime.message}</span><button onClick={() => void initialize()}>{t("reload")}</button></div>}
    {loading ? <main className="loading" role="status">{t("loading")}</main> : <main className="content">
        <div className="method-picker">
          <label htmlFor="benchmark-method">{t("method")}</label>
          <select id="benchmark-method" aria-label={t("methods")} value={selectedBenchmark?.id ?? ""} disabled={!data?.benchmarks.length} onChange={event => {
            const benchmark = data?.benchmarks.find(item => item.id === event.target.value);
            if (benchmark) chooseBenchmark(benchmark);
          }}>{data?.benchmarks.map(benchmark => <option key={benchmark.id} value={benchmark.id}>{benchmark.name}{!benchmark.available ? ` (${t("unavailable")})` : ""}</option>)}</select>
          {selectedBenchmark && <span className="muted">{t("version")} {selectedBenchmark.version}</span>}
        </div>
        <Tabs value={tab} onValueChange={setTab} className="content-tabs"><TabsList><TabsTrigger value="method">{t("method")}</TabsTrigger><TabsTrigger value="runs">{t("results")}</TabsTrigger><TabsTrigger value="compare">{t("compare")}{chosen.length ? ` (${chosen.length})` : ""}</TabsTrigger></TabsList>
          <TabsContent value="method" className="method-content">
            {selectedBenchmark && data ? <MethodSpec benchmark={selectedBenchmark} runtime={data.runtime} latestRun={latestRun} t={t} onOpen={run => void openRun(run).catch(onError)} /> : <p className="empty">{t("noMethods")}</p>}
          </TabsContent>
          <TabsContent value="runs" className="runs-content">
            {selectedRun && <>
              <div className="run-picker"><label htmlFor="saved-run">{t("savedRun")}</label><select id="saved-run" value={selectedRun.id} onChange={event => {
                const run = data?.runs.find(item => item.id === event.target.value);
                if (run) void openRun(run).catch(onError);
              }}>{data?.runs.map(run => <option key={run.id} value={run.id}>{new Date(run.createdAt).toLocaleString()} — {run.benchmarkName}</option>)}</select></div>
              <RunEvidence run={selectedRun} t={t} busy={busy} exporting={exporting} onVerify={() => void act("verify")} onCancel={() => void act("cancel")} onExport={() => void exportEvidence()} />
            </>}
            <div className="section-heading history-heading"><h2>{t("history")}</h2><button disabled={!canCompare} onClick={() => void compareRuns()}>{t("compareSelected")}{chosen.length ? ` (${chosen.length})` : ""}</button></div>
            {differentSpecs && <p className="error-text" role="alert">{t("differentSpecs")}</p>}
            {data?.runs.length ? <RunTable runs={data.runs} selectedId={selectedRun?.id ?? ""} chosen={chosen} t={t} onOpen={run => void openRun(run).catch(onError)} onChoose={chooseRun} /> : <p className="empty">{t("noRuns")}</p>}
          </TabsContent>
          <TabsContent value="compare" className="compare-content"><div className="section-heading"><h2>{t("compare")}</h2><button disabled={!canCompare} onClick={() => void compareRuns()}>{busy ? t("comparing") : t("compareSelected")}</button></div>
            <p className="muted">{t("comparisonHint")}</p>{differentSpecs && <p className="error-text" role="alert">{t("differentSpecs")}</p>}
            {comparison ? <ComparisonTable comparison={comparison} t={t} /> : <button onClick={() => setTab("runs")}>{t("chooseComparison")}</button>}
          </TabsContent>
        </Tabs>
    </main>}
  </div>;
}
