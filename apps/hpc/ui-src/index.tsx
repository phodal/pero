import React, { useCallback, useEffect, useState } from "react";
import { appObjectProps, useAppApi, useAppChat, useAppContext, useAppDataChanged, useAppI18n, useAppObject } from "@pero/app-sdk";
import { Split, SplitPane, Tabs, TabsContent, TabsList, TabsTrigger } from "@pero/app-sdk/ui";
import { messages, type Message } from "./messages";
import { ComparisonTable, Facts, RunEvidence, RunTable } from "./results";
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
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Message | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const selectedBenchmark = data?.benchmarks.find(item => item.id === benchmarkId) ?? data?.benchmarks[0];
  const selectedRun = data?.runs.find(item => item.id === selectedRunId);
  const visibleMethods = data?.benchmarks.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase())) ?? [];
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
      await refresh(); setNotice("resultSaved");
    } catch (value) { onError(value); }
    finally { setBusy(false); }
  }
  async function act(action: "cancel" | "verify") {
    if (!selectedRun) return;
    if (action === "cancel" && !window.confirm(t("cancelConfirm"))) return;
    setBusy(true); setError(""); setNotice(null);
    try {
      await api.post<{ run: Run }>(`/api/runs/${encodeURIComponent(selectedRun.id)}/${action}`, {});
      await refresh(); setNotice(action === "verify" ? "verificationStarted" : "cancelledNotice");
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
        <button disabled={loading || !selectedBenchmark} onClick={() => void discuss().catch(onError)}>{t("discuss")}</button></div>
    </header>
    {error && <div className="feedback feedback-error" role="alert"><span>{error}</span><button onClick={() => void initialize()}>{t("reload")}</button></div>}
    {data && !data.runtime.reframeAvailable && <div className="feedback feedback-warning" role="status"><span>{data.runtime.message}</span><button onClick={() => void initialize()}>{t("reload")}</button></div>}
    {loading ? <main className="loading" role="status">{t("loading")}</main> : <Split storageKey="hpc:library-width" collapseBelow={700} className="workbench">
      <SplitPane id="hpc-library" as="aside" size={248} min={210} stackedBasis="32%" resizeLabel={t("methods")} className="library">
        <div className="library-heading"><h2>{t("methods")}</h2></div>
        <input type="search" aria-label={t("search")} placeholder={t("search")} value={search} onChange={event => setSearch(event.target.value)} />
        <ul className="method-list">{visibleMethods.map(benchmark => <li key={benchmark.id}><button aria-current={selectedBenchmark?.id === benchmark.id} onClick={() => chooseBenchmark(benchmark)}>
          <strong>{benchmark.name}</strong><span>{benchmark.version}{!benchmark.available && <span className="method-kind">{t("unavailable")}</span>}</span>
        </button></li>)}</ul>
        {!visibleMethods.length && <p className="empty">{data?.benchmarks.length ? t("noMatch") : t("noMethods")}</p>}
      </SplitPane>
      <SplitPane id="hpc-content" min={360} className="content" as="section">
        <Tabs value={tab} onValueChange={setTab} className="content-tabs"><TabsList><TabsTrigger value="method">{t("method")}</TabsTrigger><TabsTrigger value="runs">{t("results")}</TabsTrigger><TabsTrigger value="compare">{t("compare")}{chosen.length ? ` (${chosen.length})` : ""}</TabsTrigger></TabsList>
          <TabsContent value="method" className="method-content">
            {selectedBenchmark ? <>
              <div className="section-heading method-title"><div><h2>{selectedBenchmark.name}</h2><span className="muted">{selectedBenchmark.version}</span></div>
                <button className="primary" disabled={busy || Boolean(active) || !selectedBenchmark.available || !data?.runtime.reframeAvailable} onClick={() => void startRun()}>{active ? t("running") : busy ? t("submitting") : t(selectedBenchmark.available ? "run" : "runBenchmark")}</button></div>
              <p>{t(selectedBenchmark.id.startsWith("pi-") ? "piDescription" : selectedBenchmark.id.startsWith("poisson") ? "poissonDescription" : "poiseuilleDescription")}</p>
              {!selectedBenchmark.available && <p className="unavailable-note" role="status">{selectedBenchmark.unavailableReason || t("unavailable")}</p>}
              <section><h3>{t("parameters")}</h3><Facts values={selectedBenchmark.parameters} /></section>
              <section><h3>{t("criteria")}</h3><Facts values={selectedBenchmark.criteria} /></section>
              <details><summary>{t("environment")}</summary><Facts values={selectedBenchmark.environment} /></details>
              {selectedBenchmark.available && <details><summary>{t("digest")}</summary><p className="digest">{selectedBenchmark.specDigest}</p></details>}
            </> : <p className="empty">{t("noMethods")}</p>}
          </TabsContent>
          <TabsContent value="runs" className="runs-content"><div className="section-heading"><h2>{t("history")}</h2><button disabled={!canCompare} onClick={() => void compareRuns()}>{t("compareSelected")}{chosen.length ? ` (${chosen.length})` : ""}</button></div>
            {differentSpecs && <p className="error-text" role="alert">{t("differentSpecs")}</p>}
            {data?.runs.length ? <RunTable runs={data.runs} selectedId={selectedRunId} chosen={chosen} t={t} onOpen={run => void openRun(run).catch(onError)} onChoose={chooseRun} /> : <p className="empty">{t("noRuns")}</p>}
            {selectedRun ? <RunEvidence run={selectedRun} t={t} busy={busy} exporting={exporting} onVerify={() => void act("verify")} onCancel={() => void act("cancel")} onExport={() => void exportEvidence()} /> : data?.runs.length ? <p className="empty">{t("selectRun")}</p> : null}
          </TabsContent>
          <TabsContent value="compare" className="compare-content"><div className="section-heading"><h2>{t("compare")}</h2><button disabled={!canCompare} onClick={() => void compareRuns()}>{busy ? t("comparing") : t("compareSelected")}</button></div>
            <p className="muted">{t("comparisonHint")}</p>{differentSpecs && <p className="error-text" role="alert">{t("differentSpecs")}</p>}
            {comparison ? <ComparisonTable comparison={comparison} t={t} /> : <button onClick={() => setTab("runs")}>{t("chooseComparison")}</button>}
          </TabsContent>
        </Tabs>
      </SplitPane>
    </Split>}
  </div>;
}
