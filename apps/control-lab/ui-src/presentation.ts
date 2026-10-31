import type { Experiment, Series, Trial } from "./types.ts";
/** The denominator is the frozen final scenario set, never only successful trials. */
export function verificationRows(experiment: Experiment) {
  return experiment.scenarios
    .filter((scenario) => scenario.role === "verification")
    .map((scenario) => {
      const trial = experiment.trials
        .filter(
          (trial) =>
            trial.phase === "verification" &&
            trial.scenarioId === scenario.id &&
            trial.candidateId === experiment.lockedCandidateId &&
            (!experiment.verificationOperationId ||
              trial.operationId === experiment.verificationOperationId),
        )
        .at(-1);
      return {
        scenario,
        trial,
        verdict: trial?.report?.verdict ?? "INCONCLUSIVE",
      };
    });
}
export function numeric(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? "Not available"
    : Number(value.toPrecision(5)).toString();
}
export const plotArea = { left: 80, right: 528, top: 32, bottom: 200 };
/** Gaps stay gaps. Never draw a line through missing/nonfinite evidence. */
export function curvePath(
  series: Series,
  bounds: [number, number, number, number],
) {
  const [xmin, xmax, ymin, ymax] = bounds;
  let previous = false;
  return series.x
    .map((x, index) => {
      const y = series.y[index];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        previous = false;
        return "";
      }
      const point = `${(plotArea.left + ((x - xmin) / (xmax - xmin || 1)) * (plotArea.right - plotArea.left)).toFixed(2)},${(plotArea.bottom - ((y - ymin) / (ymax - ymin || 1)) * (plotArea.bottom - plotArea.top)).toFixed(2)}`;
      const command = previous ? "L" : "M";
      previous = true;
      return command + point;
    })
    .join(" ");
}
export function pairedSeries(
  baseline: Trial | undefined,
  selected: Trial | undefined,
) {
  return (
    selected?.observation?.series ??
    baseline?.observation?.series ??
    []
  ).map((series) => ({
    name: series.name,
    unit: series.unit,
    baseline: baseline?.observation?.series.find(
      (item) => item.name === series.name,
    ),
    candidate: selected?.observation?.series.find(
      (item) => item.name === series.name,
    ),
  }));
}
/** Response comparisons use search observations only, never held-out verification. */
export function responseComparison(experiment: Experiment, selectedId: string, scenarioId: string) {
  const scenarios = experiment.scenarios.filter((scenario) => scenario.role === "search");
  const scenario = scenarios.find((item) => item.id === scenarioId) ?? scenarios[0];
  const latest = (candidateId: string | undefined) => experiment.trials.filter(
    (trial) => trial.phase === "search" && trial.candidateId === candidateId && trial.scenarioId === scenario?.id,
  ).at(-1);
  const baseline = latest(experiment.candidates[0]?.id);
  const selected = latest(selectedId);
  return { scenarios, scenario, baseline, selected, series: pairedSeries(baseline, selected) };
}

/** Group existing FAIL evidence for display; never recompute the verifier's verdict. */
export function failedCheckGroups(experiment: Experiment) {
  const groups = new Map<string, { scenario: string; check: NonNullable<Trial["report"]>["checks"][number] }[]>();
  for (const { scenario, trial } of verificationRows(experiment)) {
    for (const check of trial?.report?.checks ?? []) {
      if (check.verdict !== "FAIL") continue;
      const group = groups.get(check.name) ?? [];
      group.push({ scenario: scenario.label, check });
      groups.set(check.name, group);
    }
  }
  return [...groups].map(([name, failures]) => ({ name, failures }));
}

/** Labels only: observation keys stay unchanged for pairing and evidence. */
export function signalLabel(name: string) {
  const labels: Record<string, string> = {
    reference: "Tracking",
    disturbance: "Disturbance",
    controlEffort: "Control effort",
    disturbanceControlEffort: "Disturbance effort",
    frequencyGain: "Gain",
    frequencyPhase: "Phase",
  };
  return labels[name] ?? name.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Keep fixed sampling metadata in setup/evidence, not every candidate row. */
export function candidateParameterSummary(parameters: Record<string, number>) {
  const fields = [
    ["kp", "Kp", ""], ["ki", "Ki", ""], ["kd", "Kd", ""],
    ["n", "N", "rad/s"], ["r", "R", "Ω"], ["c", "C", "F"], ["gain", "Gain", ""],
  ];
  return fields.filter(([key]) => Object.hasOwn(parameters, key))
    .map(([key, label, unit]) => `${label} = ${numeric(parameters[key])}${unit ? ` ${unit}` : ""}`)
    .join(", ") || "Fixed controller";
}
