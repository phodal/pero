import React from "react";
import { Button, Icon, Split, SplitPane } from "@pero/app-sdk/ui";
import { Facts, number, Status } from "./results";
import type { Benchmark, Run } from "./types";
import type { Message } from "./messages";

export function MethodSpec({ benchmark, latestRun, t, onOpen }: {
  benchmark: Benchmark; latestRun?: Run;
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
    <Split storageKey="hpc:method-rules-width" collapseBelow={700} className="method-layout">
      <SplitPane id="hpc-specification" min={320} as="section" className="specification">
        {!benchmark.available && <p className="unavailable-note" role="status">{benchmark.unavailableReason || t("unavailable")}</p>}
        {formula && <h3>{t("problem")}</h3>}
        {formula && <div className="method-formula">
          {integrand ? <><span className="integral-symbol">∫</span><span className="integral-limits"><sup>{number(parameters.upperBound)}</sup><sub>{number(parameters.lowerBound)}</sub></span><span>{formula}</span><span>dx</span><span>=</span><span>{parameters.reference === "math.pi" ? "π" : String(parameters.reference ?? "")}</span></> : formula}
        </div>}
        <h3>{t("parameters")}</h3>
        <Facts values={inputs} />
        {latestRun && <div className="latest-run"><Icon name="automation" size={14} /><div><strong>{t("latestRun")}</strong><time dateTime={latestRun.createdAt}>{new Date(latestRun.createdAt).toLocaleString()}</time></div><Status value={latestRun.verification?.status ?? latestRun.status} t={t} /><Button variant="ghost" className="icon-button" aria-label={t("openLatest")} title={t("openLatest")} onClick={() => onOpen(latestRun)}><Icon name="arrow" size={14} /></Button></div>}
      </SplitPane>
      <SplitPane id="hpc-rules" size={320} min={280} stackedBasis="auto" resizeLabel={t("criteria")} as="aside" className="acceptance-rules">
        <div className="inspector-heading"><Icon name="shield" size={14} /><h3>{t("criteria")}</h3></div><Facts values={benchmark.criteria} />
        <details><summary>{t("environment")}</summary><Facts values={benchmark.environment} /><p className="scope-note">{t("boundary")}</p></details>
        <details><summary>{t("specification")}</summary><p>{description}</p>
          {benchmark.specDigest && <p>{t("digest")}<br /><code className="digest">{benchmark.specDigest}</code></p>}
        </details>
      </SplitPane>
    </Split>
  </>;
}
