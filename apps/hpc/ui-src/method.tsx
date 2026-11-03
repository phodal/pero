import React from "react";
import { Split, SplitPane } from "@pero/app-sdk/ui";
import { Facts, number, Status } from "./results";
import type { Benchmark, Run, Runtime } from "./types";
import type { Message } from "./messages";

export function MethodSpec({ benchmark, runtime, latestRun, t, onOpen }: {
  benchmark: Benchmark; runtime: Runtime; latestRun?: Run;
  t(key: Message): string; onOpen(run: Run): void;
}) {
  const parameters = benchmark.parameters;
  const integrand = parameters.integrand;
  const equation = parameters.equation;
  const description = benchmark.id === "pi-midpoint-v1" ? t("piDescription")
    : benchmark.id === "poisson-1d-v1" ? t("poissonDescription")
    : benchmark.id === "openfoam-poiseuille-v1" ? t("poiseuilleDescription")
    : benchmark.description;
  const inputs = Object.fromEntries(Object.entries(parameters).filter(([key]) => key !== "integrand" && key !== "equation"));
  const formula = String(integrand ?? equation ?? "").replaceAll("x*x", "x²").replaceAll("pi^2", "π²").replaceAll("pi", "π").replaceAll("''", "″").replaceAll("*", " × ");
  return <>
    {!benchmark.available && <p className="unavailable-note" role="status">{benchmark.unavailableReason || t("unavailable")}</p>}
    <Split storageKey="hpc:method-rules-width" collapseBelow={760} className="method-layout">
      <SplitPane id="hpc-specification" min={320} as="section" className="specification">
        {formula && <div className="method-formula">
          {integrand ? <><span className="integral-symbol">∫</span><span className="integral-limits"><sup>{number(parameters.upperBound)}</sup><sub>{number(parameters.lowerBound)}</sub></span><span>{formula}</span><span>dx</span><span>=</span><span>{parameters.reference === "math.pi" ? "π" : String(parameters.reference ?? "")}</span></> : formula}
        </div>}
        <h2>{t("parameters")}</h2>
        <Facts values={inputs} />
      </SplitPane>
      <SplitPane id="hpc-rules" size={380} min={300} stackedBasis="auto" resizeLabel={t("criteria")} as="aside" className="acceptance-rules">
        <section className="acceptance-panel"><h2>{t("criteria")}</h2><Facts values={benchmark.criteria} /></section>
        <details><summary>{t("environment")}</summary><Facts values={benchmark.environment} /><p className="scope-note">{t("boundary")}</p></details>
        <details><summary>{t("specification")}</summary><p>{description}</p>
          {benchmark.specDigest && <p>{t("digest")}<br /><code className="digest">{benchmark.specDigest}</code></p>}
        </details>
      </SplitPane>
    </Split>
    {(benchmark.available || latestRun) && <div className="method-footer">
      {benchmark.available && <div className="runtime-summary"><strong>ReFrame</strong><span>{runtime.reframeVersion ?? "—"}</span><span className={runtime.reframeAvailable ? "status-pass" : "status-incomplete"}>{t(runtime.reframeAvailable ? "ready" : "unavailable")}</span></div>}
      {latestRun && <button className="latest-run" onClick={() => onOpen(latestRun)}><span>{t("latestRun")}</span><time dateTime={latestRun.createdAt}>{new Date(latestRun.createdAt).toLocaleString()}</time><Status value={latestRun.verification?.status ?? latestRun.status} t={t} /><span aria-hidden="true">→</span></button>}
    </div>}
  </>;
}
