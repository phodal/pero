import React, { useEffect, useLayoutEffect, useState } from "react";
import { useAppApi, useAppContext, useAppI18n } from "@pero/app-sdk";
import { Split, SplitPane } from "@pero/app-sdk/ui";
import type { Run } from "./types";
import { messages } from "./messages";

type Series = { runId: string; intervals: number; sampleCount: number; points: { x: number; value: number }[] };

function usePlotWidth() {
  const [element, ref] = useState<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(430);
  useLayoutEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref, width };
}

function SamplePlot({ series, title }: { series: Series; title: string }) {
  const zh = useAppContext().locale === "zh-CN", { ref, width } = usePlotWidth();
  const values = series.points.map(point => point.value), min = Math.min(0, ...values), max = Math.max(...values);
  const xMin = series.points[0].x, xMax = series.points.at(-1)!.x;
  const plotWidth = Math.max(1, width - 72);
  const curve = series.points.map(point => `${48 + (point.x - xMin) / (xMax - xMin || 1) * plotWidth},${180 - (point.value - min) / (max - min || 1) * 144}`).join(" ");
  return <figure><figcaption>{title}<span>{series.intervals.toLocaleString()} {zh ? "区间" : "intervals"}</span></figcaption>
    <svg ref={ref} viewBox={`0 0 ${width} 220`} role="img" aria-label={`${title}; ${series.sampleCount} ${zh ? "原始采样点" : "original samples"}`}>
      {[0, .5, 1].map(value => <g key={value}>
        <path className="plot-grid" d={`M48 ${180 - value * 144}H${width - 24}`} />
        <text x={48 + value * plotWidth} y="203" textAnchor="middle">{(xMin + value * (xMax - xMin)).toPrecision(2)}</text>
        <text x="38" y={184 - value * 144} textAnchor="end">{(min + value * (max - min)).toPrecision(2)}</text>
      </g>)}
      <path className="plot-axis" d={`M48 28V180H${width - 24}`} />
      <polyline className="plot-curve" points={curve} /><text x={width - 8} y="203">x</text>
    </svg>
  </figure>;
}

function ErrorPlot({ run }: { run: Run }) {
  const zh = useAppContext().locale === "zh-CN", { t } = useAppI18n(messages), { ref, width } = usePlotWidth();
  const { metrics, thresholds } = run.verification!;
  const coarse = metrics.coarseAbsoluteError, fine = metrics.fineAbsoluteError;
  const limit = typeof thresholds.absoluteErrorMax === "number" ? thresholds.absoluteErrorMax : null;
  if (typeof coarse !== "number" || typeof fine !== "number") return <p className="empty">{t("missingError")}</p>;
  const max = Math.max(coarse, fine, limit ?? 0, 1e-300) * 1.15, plotWidth = Math.max(1, width - 36);
  const x = (value: number) => 12 + value / max * plotWidth;
  return <figure><figcaption>{zh ? "网格误差" : "Grid error"}<span>{zh ? "绝对误差" : "Absolute error"}</span></figcaption>
    <svg ref={ref} viewBox={`0 0 ${width} 220`} role="img" aria-label={`${zh ? "粗网格" : "Coarse"}: ${coarse}; ${zh ? "细网格" : "Fine"}: ${fine}` + (limit === null ? "" : `; ${t("fineLimit")}: ${limit}`)}>
      {limit !== null && <><path className="plot-limit" d={`M${x(limit)} 28V180`} /><text x={Math.min(width - 12, Math.max(110, x(limit)))} y="18" textAnchor="end">{t("fineLimit")}</text></>}
      {[coarse, fine].map((value, index) => <g key={index}>
        <text x="12" y={49 + index * 74}>{index === 0 ? (zh ? "粗网格" : "Coarse grid") : (zh ? "细网格" : "Fine grid")}</text>
        <text x={width - 12} y={49 + index * 74} textAnchor="end" className="plot-value">{value.toExponential(3)}</text>
        <rect className={index ? "plot-fine" : "plot-coarse"} x="12" y={62 + index * 74} width={value / max * plotWidth} height="20" />
      </g>)}
      <path className="plot-axis" d={`M12 180H${width - 12}`} /><text x="12" y="203">0</text>
      {limit !== null && <text x={Math.min(width - 12, Math.max(90, x(limit)))} y="203" textAnchor="end">{limit.toExponential(2)}</text>}
    </svg>
  </figure>;
}

/** Only recorded numerical samples are drawn. Checks remain available as a table. */
export function RunPlots({ run }: { run: Run }) {
  const api = useAppApi(), zh = useAppContext().locale === "zh-CN", { t } = useAppI18n(messages);
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
  if (run.operation || !run.verification || !["pass", "fail"].includes(run.verification.status)) return null;
  if (!series || series.runId !== run.id) return <p className="empty" role="status">{t("samplesLoading")}</p>;
  const title = run.benchmarkId.startsWith("poisson") ? (zh ? "数值解 u(x)" : "Numerical solution u(x)") : (zh ? "积分采样 f(x)" : "Integrand samples f(x)");
  return <Split storageKey="hpc:plot-width" collapseBelow={720} className="result-plots">
    <SplitPane id="hpc-samples" min={300} className="sample-plot"><SamplePlot series={series} title={title} /></SplitPane>
    <SplitPane id="hpc-errors" min={300} size={410} stackedBasis="auto" resizeLabel={zh ? "网格误差" : "Grid error"} className="error-plot"><ErrorPlot run={run} /></SplitPane>
  </Split>;
}
