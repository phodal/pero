import React, { useEffect, useState } from "react";
import { useAppApi, useAppContext } from "@pero/app-sdk";
import type { Run } from "./types";

type Series = { runId: string; intervals: number; sampleCount: number; points: { x: number; value: number }[] };

/** Only recorded numerical samples are drawn. Checks remain available as a table. */
export function RunPlots({ run }: { run: Run }) {
  const api = useAppApi(), zh = useAppContext().locale === "zh-CN";
  const [series, setSeries] = useState<Series | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setSeries(null); setError("");
    if (!run.operation && run.verification && ["pass", "fail"].includes(run.verification.status)) {
      void api.get<Series>(`/api/runs/${run.id}/series`).then(value => { if (current) setSeries(value); })
        .catch(value => { if (current) setError(String(value.message || value)); });
    }
    return () => { current = false; };
  }, [api, run.id, run.updatedAt, run.operation, run.verification]);
  if (error) return <p role="alert" className="error-text">{error}</p>;
  if (!series || series.runId !== run.id || run.operation || !run.verification) return null;
  const values = series.points.map(p => p.value), min = Math.min(0, ...values), max = Math.max(...values);
  const xMin = series.points[0].x, xMax = series.points.at(-1)!.x;
  const curve = series.points.map(p => `${48 + (p.x - xMin) / (xMax - xMin || 1) * 350},${174 - (p.value - min) / (max - min || 1) * 142}`).join(" ");
  const metrics = run.verification!.metrics;
  const coarse = Number(metrics.coarseAbsoluteError), fine = Number(metrics.fineAbsoluteError);
  const title = run.benchmarkId.startsWith("poisson") ? (zh ? "数值解 u(x)" : "Numerical solution u(x)") : (zh ? "积分采样 f(x)" : "Integrand samples f(x)");
  return <div className="result-plots">
    <figure><figcaption>{title}<span>{series.intervals} {zh ? "区间" : "intervals"}</span></figcaption>
      <svg viewBox="0 0 430 210" role="img" aria-label={`${title}; ${series.sampleCount} ${zh ? "原始采样点" : "original samples"}`}>
        <path className="plot-axis" d="M48 26V174H405" />
        {[0, .5, 1].map(v => <g key={v}><text x={48 + v * 350} y="194" textAnchor="middle">{(xMin + v * (xMax - xMin)).toPrecision(2)}</text><text x="40" y={178 - v * 142} textAnchor="end">{(min + v * (max - min)).toPrecision(2)}</text></g>)}
        <polyline className="plot-curve" points={curve} /><text x="418" y="194">x</text>
      </svg>
    </figure>
    <figure><figcaption>{zh ? "网格误差" : "Grid error"}<span>{zh ? "绝对误差" : "Absolute error"}</span></figcaption>
      <svg viewBox="0 0 430 210" role="img" aria-label={`${zh ? "粗网格" : "Coarse"}: ${coarse}; ${zh ? "细网格" : "Fine"}: ${fine}`}>
        {[coarse, fine].map((v, i) => <g key={i}><text x="48" y={52 + i * 75}>{i === 0 ? (zh ? "粗网格" : "Coarse grid") : (zh ? "细网格" : "Fine grid")}</text>
          <rect className={i ? "plot-fine" : "plot-coarse"} x="48" y={63 + i * 75} width={Math.max(1, v / Math.max(coarse, fine, 1e-300) * 230)} height="18" />
          <text x="290" y={77 + i * 75}>{v.toExponential(3)}</text></g>)}
      </svg>
    </figure>
  </div>;
}
