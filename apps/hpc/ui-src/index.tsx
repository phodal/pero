import React, { useCallback, useEffect, useState } from "react";
import { appObjectProps, useAppApi, useAppChat, useAppContext, useAppDataChanged, useAppI18n, useAppObject } from "@pero/app-sdk";
import { Disclosure, AppBar, Button, Feedback, Icon, IconButton, Input, Split, SplitPane, Tabs, TabsContent, TabsList, TabsTrigger } from "@pero/app-sdk/ui";
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
  const [query, setQuery] = useState("");
  const selectedBenchmark = data?.benchmarks.find(item => item.id === benchmarkId) ?? data?.benchmarks[0];
  const latestRun = data?.runs.find(item => item.benchmarkId === selectedBenchmark?.id && item.specDigest === selectedBenchmark?.specDigest);
  const selectedRun = data?.runs.find(item => item.id === selectedRunId) ?? latestRun;
  const active = data?.runs.some(run => run.status === "running" || run.operation);
  const comparedRuns = data?.runs.filter(run => chosen.includes(run.id)) ?? [];
  const differentSpecs = new Set(comparedRuns.map(run => run.specDigest)).size > 1;
  const canCompare = chosen.length >= 2 && !differentSpecs && !busy;
  const filteredBenchmarks = data?.benchmarks.filter(item => `${item.name} ${item.version}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];

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
    <h1 className="visually-hidden">{t("title")}</h1>
    <AppBar columnHeader className="app-header" aria-label={t("title")} actions={<>
      <IconButton label={t("refresh")} disabled={loading || busy} onClick={() => void refresh().catch(onError)}><Icon name="sync" size={16} /></IconButton>
        <Button className="discuss-button" aria-label={t("discuss")} title={t("discuss")} disabled={loading || !selectedBenchmark} onClick={() => void discuss().catch(onError)}><Icon name="agent" size={14} /><span>{t("discuss")}</span></Button>
        <Button variant="primary" disabled={loading || busy || Boolean(active) || !selectedBenchmark?.available || !data?.runtime.reframeAvailable} onClick={() => void startRun()}><Icon name="play" size={14} />{t(selectedBenchmark?.available ? "run" : "runBenchmark")}</Button>
    </>}/>
    {notice && <Feedback className="app-notice">{t(notice)}</Feedback>}
    {error && <div className="app-feedback"><Feedback kind="error" variant="block">{error}</Feedback><Button onClick={() => void initialize()}>{t("reload")}</Button></div>}
    {data && !data.runtime.reframeAvailable && <div className="app-feedback"><Feedback kind="warning" variant="block">{data.runtime.message}</Feedback><Button onClick={() => void initialize()}>{t("reload")}</Button></div>}
    {loading ? <main className="loading" role="status">{t("loading")}</main> : <Split storageKey="hpc:benchmark-explorer-width" collapseBelow={760} className="workbench">
      <SplitPane id="hpc-benchmarks" size={232} min={210} stackedBasis="auto" resizeLabel={t("methods")} as="aside" className="benchmark-explorer">
        <div className="explorer-header"><h2>{t("methods")}</h2><div className="benchmark-search"><Icon name="search" size={14} /><Input type="search" aria-label={t("search")} placeholder={t("search")} value={query} onChange={event => setQuery(event.target.value)} /></div></div>
        <nav className="benchmark-list" aria-label={t("methods")}>
          {filteredBenchmarks.map(benchmark => <Button key={benchmark.id} variant="ghost" className="benchmark-item" aria-label={benchmark.name} aria-current={selectedBenchmark?.id === benchmark.id ? "page" : undefined} onClick={() => chooseBenchmark(benchmark)}>
            <span className="benchmark-name">{benchmark.name}</span><span className="benchmark-meta"><span>{benchmark.version}</span>{!benchmark.available && <span className="unavailable-label">{t("unavailable")}</span>}</span>
          </Button>)}
          {!filteredBenchmarks.length && <p className="empty">{t(data?.benchmarks.length ? "noMatch" : "noMethods")}</p>}
        </nav>
        {data && <div className="explorer-runtime"><span><Icon name="local" size={14} />{t("local")}</span><span className="runtime-version">ReFrame {data.runtime.reframeVersion ?? "—"}<span className={data.runtime.reframeAvailable ? "status-pass" : "status-incomplete"}>{t(data.runtime.reframeAvailable ? "ready" : "unavailable")}</span></span></div>}
      </SplitPane>
      <SplitPane id="hpc-workspace" min={360} as="section" role="main" className="content">
        <div className="workspace-heading"><h2>{selectedBenchmark?.name ?? t("methods")}</h2>{selectedBenchmark && <span className="method-version">{selectedBenchmark.version}</span>}</div>
        <Tabs value={tab} onValueChange={setTab} className="content-tabs"><TabsList><TabsTrigger value="method">{t("method")}</TabsTrigger><TabsTrigger value="runs">{t("results")}</TabsTrigger><TabsTrigger value="compare">{t("compare")}{chosen.length ? ` (${chosen.length})` : ""}</TabsTrigger></TabsList>
          <TabsContent value="method" className="method-content">
            {selectedBenchmark && data ? <MethodSpec benchmark={selectedBenchmark} latestRun={latestRun} t={t} onOpen={run => void openRun(run).catch(onError)} /> : <p className="empty">{t("noMethods")}</p>}
          </TabsContent>
          <TabsContent value="runs" className="runs-content">
            {selectedRun && <RunEvidence run={selectedRun} t={t} busy={busy} exporting={exporting} onVerify={() => void act("verify")} onCancel={() => void act("cancel")} onExport={() => void exportEvidence()} />}
            {!selectedRun && <p className="empty">{t(data?.runs.length ? "selectRun" : "noRuns")}</p>}
            <Disclosure variant="inline" className="run-history" summary={<>{t("history")}</>}>
            <div className="section-heading"><h3>{t("history")}</h3><Button disabled={!canCompare} onClick={() => void compareRuns()}><Icon name="changes" size={14} />{t("compareSelected")}{chosen.length ? ` (${chosen.length})` : ""}</Button></div>
            {differentSpecs && <p className="error-text" role="alert">{t("differentSpecs")}</p>}
            {data?.runs.length ? <RunTable benchmarks={data.benchmarks} runs={data.runs} selectedId={selectedRun?.id ?? ""} chosen={chosen} t={t} onOpen={run => void openRun(run).catch(onError)} onChoose={chooseRun} /> : <p className="empty">{t("noRuns")}</p>}
            </Disclosure>
          </TabsContent>
          <TabsContent value="compare" className="compare-content"><div className="section-heading"><h3>{t("compare")}</h3><Button disabled={!canCompare} onClick={() => void compareRuns()}><Icon name="changes" size={14} />{busy ? t("comparing") : t("compareSelected")}</Button></div>
            <p className="muted">{t("comparisonHint")}</p>{differentSpecs && <p className="error-text" role="alert">{t("differentSpecs")}</p>}
            {comparison && <ComparisonTable comparison={comparison} t={t} />}
            <h3 className="history-heading">{t("history")}</h3>{data?.runs.length ? <RunTable benchmarks={data.benchmarks} runs={data.runs} selectedId={selectedRun?.id ?? ""} chosen={chosen} t={t} onOpen={run => void openRun(run).catch(onError)} onChoose={chooseRun} /> : <p className="empty">{t("noRuns")}</p>}
          </TabsContent>
        </Tabs>
      </SplitPane>
    </Split>}
  </div>;
}
