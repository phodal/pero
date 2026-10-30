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
      const point = `${(48 + ((x - xmin) / (xmax - xmin || 1)) * 480).toFixed(2)},${(200 - ((y - ymin) / (ymax - ymin || 1)) * 168).toFixed(2)}`;
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
