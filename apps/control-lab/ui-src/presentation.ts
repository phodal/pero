import type { Check, Experiment, Field, Series, Template, Trial, Verdict } from "./types.ts";
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

const TUNABLE: Record<string, string[]> = {
  "robust-pid": ["kp", "ki", "kd"],
  "active-filter": ["r", "c", "gain"],
};

/** Unsaved template setup. It carries no observations and is not a frozen experiment. */
export function unsavedExperiment(
  template: Template,
  parameters: Record<string, number>,
  criteria: Record<string, number>,
  budget: number,
): Experiment {
  const names = new Set(TUNABLE[template.id] ?? []);
  return {
    id: "",
    templateId: template.id,
    title: template.title,
    createdAt: "",
    specHash: "",
    candidateBudget: budget,
    parameters,
    criteria,
    scenarios: template.scenarios,
    status: "idle",
    operation: null,
    progress: { completed: 0, total: 0 },
    error: null,
    candidates: [],
    searchSpace: Object.fromEntries(
      template.parameters
        .filter((field) => names.has(field.name))
        .map((field) => [field.name, { min: field.min, max: field.max }]),
    ),
    lockedCandidateId: null,
    trials: [],
    report: null,
    limitations: [],
  };
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

const CRITERION_CHECKS: Record<string, string> = {
  overshootMax: "Target overshoot",
  settlingMax: "Target settling time",
  steadyErrorMax: "Final-window target error",
  controlEffortMax: "Peak absolute control effort",
  disturbanceMax: "Plant-input disturbance final residual",
  gainMarginMin: "Gain margin",
  phaseMarginMin: "Phase margin",
  cutoffTolerance: "Cutoff relative error",
  gainTolerance: "Passband gain relative error",
  peakingMax: "Passband peaking",
};

export type Range = { min: number; max: number };
export type Concept = {
  name: string;
  verdict: Verdict;
  actual: number | null;
  limit: number | null;
  message: string;
  scenarioId: string | null;
  chartScenarioId: string | null;
  signal: string | null;
};

/** Step and disturbance have a constant target. Effort and filter spectra do not. */
export function chartTarget(templateId: string, signal: string) {
  if (templateId === "active-filter") return null;
  if (signal === "reference") return 1;
  if (signal === "disturbance") return 0;
  return null;
}

export function signalForCheck(name: string) {
  if (name === "Gain margin" || name === "Phase margin" || name === "Internal stability" || name === "Characteristic evidence") return null;
  if (name.includes("control effort") || name.includes("Control effort")) return "controlEffort";
  if (name.includes("disturbance")) return "disturbance";
  if (name.includes("Cutoff") || name.includes("peaking") || name.includes("Passband")) return "frequencyGain";
  if (name.includes("overshoot") || name.includes("settling") || name.includes("target error") || name.includes("analytic")) return "reference";
  return null;
}

export function draftRangeError(values: Record<string, number>, ranges: Record<string, Range>) {
  for (const [name, range] of Object.entries(ranges)) {
    const value = values[name];
    if (!Number.isFinite(value) || value < range.min || value > range.max) {
      return `${name} must be between ${range.min} and ${range.max}`;
    }
  }
  return null;
}

export function matchingCandidate<T extends { parameters: Record<string, number> }>(
  candidates: T[],
  parameters: Record<string, number>,
  names: string[],
) {
  return candidates.find((candidate) => names.every((name) =>
    Number.isFinite(parameters[name]) && Number.isFinite(candidate.parameters[name])
    && Math.abs(candidate.parameters[name] - parameters[name]) <= 1e-9));
}

function metricStrip(templateId: string) {
  return templateId === "active-filter"
    ? [
      { check: "Cutoff relative error", label: "Worst cutoff error" },
      { check: "Passband gain relative error", label: "DC gain error" },
      { check: "Passband peaking", label: "Worst peaking" },
    ]
    : [
      { check: "Target overshoot", label: "Worst overshoot" },
      { check: "Target settling time", label: "Worst settling" },
      { check: "Final-window target error", label: "Final error" },
    ];
}

/** Worst saved search actual. A missing scenario stays unavailable. */
export function worstMetrics(experiment: Experiment, candidateId: string) {
  const scenarios = experiment.scenarios.filter((scenario) => scenario.role === "search");
  return metricStrip(experiment.templateId).map(({ check, label }) => {
    const actuals = scenarios.map((scenario) => {
      const saved = experiment.trials.filter((trial) =>
        trial.phase === "search" && trial.candidateId === candidateId && trial.scenarioId === scenario.id,
      ).at(-1)?.report?.checks.find((item) => item.name === check);
      return saved && Number.isFinite(saved.actual) ? saved.actual : null;
    });
    const complete = scenarios.length > 0 && actuals.every((value) => value != null);
    return { label, value: complete ? Math.max(...(actuals as number[])) : null };
  });
}

function latestTrial(experiment: Experiment, candidateId: string, scenarioId: string, phase: "search" | "verification") {
  return experiment.trials.filter((trial) =>
    trial.phase === phase && trial.candidateId === candidateId && trial.scenarioId === scenarioId
    && (phase !== "verification" || !experiment.verificationOperationId || trial.operationId === experiment.verificationOperationId),
  ).at(-1);
}

function combine(verdicts: Verdict[]): Verdict {
  if (verdicts.some((verdict) => verdict === "FAIL")) return "FAIL";
  if (verdicts.every((verdict) => verdict === "PASS") && verdicts.length) return "PASS";
  if (verdicts.every((verdict) => verdict === "NOT_RUN") && verdicts.length) return "NOT_RUN";
  return "INCONCLUSIVE";
}

function placeholderConcepts(experiment: Experiment, phase: "search" | "verification"): Concept[] {
  const message = phase === "verification" ? "Final verification has not been run." : "No saved search check.";
  const rows: Concept[] = [];
  if (experiment.templateId !== "active-filter") {
    rows.push({ name: "Internal stability", verdict: "NOT_RUN", actual: null, limit: 1, message, scenarioId: null, chartScenarioId: null, signal: null });
  }
  for (const [key, name] of Object.entries(CRITERION_CHECKS)) {
    if (!(key in experiment.criteria)) continue;
    rows.push({ name, verdict: "NOT_RUN", actual: null, limit: experiment.criteria[key], message, scenarioId: null, chartScenarioId: null, signal: signalForCheck(name) });
  }
  return rows;
}

/** Group saved check verdicts. Do not recompute the metric. */
export function checkConcepts(experiment: Experiment, candidateId: string, phase: "search" | "verification"): Concept[] {
  const scenarios = experiment.scenarios.filter((scenario) => scenario.role === phase);
  const found = new Map<string, { scenarioId: string; check: Check }[]>();
  let anyReport = false;
  for (const scenario of scenarios) {
    const checks = latestTrial(experiment, candidateId, scenario.id, phase)?.report?.checks;
    if (!checks?.length) continue;
    anyReport = true;
    for (const check of checks) {
      const list = found.get(check.name) ?? [];
      list.push({ scenarioId: scenario.id, check });
      found.set(check.name, list);
    }
  }
  if (!anyReport) return placeholderConcepts(experiment, phase);
  return [...found].map(([name, entries]) => {
    const missing = scenarios.length - entries.length;
    const verdict = combine(missing ? [...entries.map((entry) => entry.check.verdict), "INCONCLUSIVE"] : entries.map((entry) => entry.check.verdict));
    const pool = verdict === "FAIL"
      ? entries.filter((entry) => entry.check.verdict === "FAIL")
      : verdict === "INCONCLUSIVE"
        ? entries.filter((entry) => entry.check.verdict === "INCONCLUSIVE")
        : entries;
    // Missing scenarios can make the aggregate inconclusive even when every
    // available check passed. Keep a real saved observation, never a fake pass.
    const representative = (pool.length ? pool : entries).reduce((best, entry) =>
      (entry.check.actual ?? Number.NEGATIVE_INFINITY) > (best.check.actual ?? Number.NEGATIVE_INFINITY) ? entry : best);
    const scenario = scenarios.find((item) => item.id === representative.scenarioId);
    return {
      name,
      verdict,
      actual: representative.check.actual,
      limit: representative.check.limit,
      message: missing ? `${representative.check.message} Not every frozen scenario has this check.`.trim() : representative.check.message,
      scenarioId: representative.scenarioId,
      chartScenarioId: scenario?.role === "search" ? scenario.id : null,
      signal: signalForCheck(name),
    };
  });
}

export function verdictSummary(concepts: { verdict: string }[], scenarioCount: number) {
  if (!concepts.length) return { title: "No checks", detail: `${scenarioCount} frozen scenarios` };
  if (concepts.every((concept) => concept.verdict === "NOT_RUN")) {
    return { title: "Checks have not been run", detail: `${scenarioCount} frozen scenarios` };
  }
  const failed = concepts.filter((concept) => concept.verdict === "FAIL").length;
  const passed = concepts.filter((concept) => concept.verdict === "PASS").length;
  const title = failed
    ? `${failed} constraint${failed === 1 ? "" : "s"} failed`
    : passed === concepts.length ? "All checks passed" : "Evidence inconclusive";
  return { title, detail: `${passed} of ${concepts.length} checks passed · ${scenarioCount} scenarios` };
}

function moveToward(current: Record<string, number>, ranges: Record<string, Range>, name: string, fraction: number) {
  const range = ranges[name];
  if (!range || !Number.isFinite(current[name])) return;
  const next = current[name] + fraction * (range.max - range.min);
  current[name] = Math.min(range.max, Math.max(range.min, next));
}

/** Deterministic draft. It never claims the design passed and never locks it. */
export function suggestedDraft(
  templateId: string,
  current: Record<string, number>,
  ranges: Record<string, Range>,
  concepts: { name: string; verdict: string }[],
) {
  const names = Object.keys(ranges);
  if (!names.length) return { values: null as Record<string, number> | null, message: "This controller is fixed by the frozen template." };
  if (!concepts.length || concepts.every((concept) => concept.verdict === "NOT_RUN")) {
    return { values: null, message: "Run the draft to record observations. A suggestion uses saved checks and does not change the frozen policy." };
  }
  if (concepts.every((concept) => concept.verdict === "PASS")) {
    return { values: null, message: "Saved checks meet the frozen limits. Review the evidence before locking. This is not acceptance." };
  }
  const next = Object.fromEntries(names.map((name) => [name, current[name]]));
  let message = "Saved checks are incomplete. Adjust the draft and run it to record another candidate.";
  const failed = (name: string) => concepts.some((concept) => concept.name === name && concept.verdict === "FAIL");
  if (templateId === "robust-pid") {
    if (failed("Target overshoot")) {
      moveToward(next, ranges, "kp", -0.15);
      moveToward(next, ranges, "ki", -0.1);
      moveToward(next, ranges, "kd", 0.1);
      message = "Worst overshoot exceeds the frozen limit. This draft lowers proportional and integral gain and raises derivative gain. Run it to record the candidate.";
    } else if (concepts.some((concept) => concept.name === "Target settling time" && concept.verdict !== "PASS")) {
      moveToward(next, ranges, "kd", 0.1);
      moveToward(next, ranges, "kp", -0.05);
      message = "Settling is outside the frozen limit or window. This draft raises derivative gain. Run it to record the candidate.";
    } else if (failed("Final-window target error")) {
      moveToward(next, ranges, "ki", 0.1);
      message = "Final-window error exceeds the frozen limit. This draft raises integral gain. Run it to record the candidate.";
    } else if (failed("Gain margin") || failed("Phase margin")) {
      moveToward(next, ranges, "kp", -0.1);
      message = "A classical margin is below the frozen minimum. This draft lowers proportional gain. Run it to record the candidate.";
    }
  } else if (templateId === "active-filter") {
    if (failed("Passband peaking")) {
      moveToward(next, ranges, "gain", -0.1);
      message = "Passband peaking exceeds the frozen limit. This draft lowers amplifier gain. Run it to record the candidate.";
    } else if (failed("Cutoff relative error")) {
      moveToward(next, ranges, "r", 0.1);
      message = "Cutoff error exceeds the frozen tolerance. This draft raises resistance. Run it to record the candidate.";
    }
  }
  const changed = names.some((name) => Number.isFinite(next[name]) && Number.isFinite(current[name]) && Math.abs(next[name] - current[name]) > 1e-9);
  if (!changed) return { values: null, message: "The frozen range has no further move for this suggestion. Review the saved evidence." };
  for (const name of names) {
    if (!Number.isFinite(next[name])) continue;
    const range = ranges[name];
    next[name] = Math.min(range.max, Math.max(range.min, Number(next[name].toPrecision(4))));
  }
  return { values: next, message };
}

export type GeneratedDraft = {
  parameters: Record<string, number>;
  criteria: Record<string, number>;
  budget: number | null;
};

const DRAFT_KEYS = new Set(["parameters", "criteria", "candidateBudget"]);

function draftNumber(field: Field, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${field.label} must be a finite number.`);
  if (value < field.min || value > field.max)
    throw new Error(`${field.label} must be between ${field.min} and ${field.max}.`);
  if (field.name === "samples" && !Number.isInteger(value))
    throw new Error("Samples must be an integer.");
  return value;
}

function draftFields(fields: Field[], supplied: unknown) {
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied))
    throw new Error("Draft fields must be an object.");
  const record = supplied as Record<string, unknown>;
  const names = new Set(fields.map((field) => field.name));
  for (const key of Object.keys(record)) {
    if (!names.has(key)) throw new Error(`Unknown draft field ${key}.`);
  }
  return Object.fromEntries(fields.map((field) => {
    if (!Object.hasOwn(record, field.name)) throw new Error(`${field.label} is required.`);
    return [field.name, draftNumber(field, record[field.name])];
  }));
}

/** Bounds come from the selected template fields. Step is shown to the model; samples must be a whole number. Template defaults are not required to land on step. */
export function parseGeneratedDraft(
  template: { parameters: Field[]; criteria: Field[] },
  payload: unknown,
): GeneratedDraft {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Draft must be an object.");
  const record = payload as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!DRAFT_KEYS.has(key)) throw new Error(`Unknown draft field ${key}.`);
  }
  let budget: number | null = null;
  if (record.candidateBudget !== undefined) {
    const value = record.candidateBudget;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 30)
      throw new Error("Candidate budget must be an integer from 1 to 30.");
    budget = value;
  }
  return {
    parameters: draftFields(template.parameters, record.parameters),
    criteria: draftFields(template.criteria, record.criteria),
    budget,
  };
}

function fieldLine(field: Field, value: number | undefined) {
  const unit = field.unit ? ` ${field.unit}` : "";
  return `- ${field.name} (${field.label}): current ${value ?? field.value}${unit}; min ${field.min}; max ${field.max}; step ${field.step}`;
}

/** Names the selected template and its exposed fields. It does not authorize a freeze or a search. */
export function generationPrompt(
  template: { id: string; title: string; parameters: Field[]; criteria: Field[] },
  parameters: Record<string, number>,
  criteria: Record<string, number>,
  budget: number,
) {
  return [
    `Generate draft values for the Control Lab template "${template.title}" (${template.id}).`,
    "This draft is not an engineering pass. Do not freeze, search, or propose a candidate.",
    "Do not call tools. Use only the listed fields. Do not invent gains, scenarios, a spec hash, or an engine name.",
    "Parameters:",
    ...template.parameters.map((field) => fieldLine(field, parameters[field.name])),
    "Criteria:",
    ...template.criteria.map((field) => fieldLine(field, criteria[field.name])),
    `Candidate budget: current ${budget}; integer from 1 to 30.`,
    'End the reply with one JSON object and no text after it. Keys are only "parameters", "criteria", and optional "candidateBudget".',
  ].join("\n");
}

function jsonObjects(text: string) {
  const found: unknown[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth++;
    } else if (char === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const value = JSON.parse(text.slice(start, index + 1));
          if (value && typeof value === "object" && !Array.isArray(value)) found.push(value);
        } catch { /* prose braces are not a draft */ }
        start = -1;
      }
    }
  }
  return found;
}

/** The last JSON object that matches the selected template wins. A failure returns the current draft unchanged. */
export function applyTranscriptDraft(
  current: { parameters: Record<string, number>; criteria: Record<string, number>; budget: number },
  template: { parameters: Field[]; criteria: Field[] },
  text: string,
  frozen: boolean,
) {
  if (frozen) {
    return { ...current, error: "A frozen experiment cannot accept a generated draft." };
  }
  let draft: GeneratedDraft | null = null;
  let error = "The host did not return a validated draft.";
  for (const value of jsonObjects(text)) {
    try {
      draft = parseGeneratedDraft(template, value);
      error = "";
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }
  if (!draft) return { ...current, error };
  return {
    parameters: draft.parameters,
    criteria: draft.criteria,
    budget: draft.budget ?? current.budget,
    error: null,
  };
}

