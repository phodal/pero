import test from "node:test";
import assert from "node:assert/strict";
import {
  chartTarget,
  checkConcepts,
  curvePath,
  draftRangeError,
  matchingCandidate,
  signalForCheck,
  signalLabel,
  suggestedDraft,
  candidateParameterSummary,
  failedCheckGroups,
  numeric,
  pairedSeries,
  responseComparison,
  verdictSummary,
  verificationRows,
  worstMetrics,
} from "../ui-src/presentation.ts";
import type { Experiment, Trial } from "../ui-src/types.ts";

test("verification denominator includes missing, failed and cancelled final scenarios only for the locked candidate", () => {
  const experiment = {
    lockedCandidateId: "chosen",
    scenarios: [
      { id: "search", role: "search" },
      { id: "pass", role: "verification" },
      { id: "failed", role: "verification" },
      { id: "missing", role: "verification" },
      { id: "cancelled", role: "verification" },
    ],
    trials: [
      {
        candidateId: "chosen",
        scenarioId: "pass",
        phase: "verification",
        status: "completed",
        report: { verdict: "PASS" },
      },
      {
        candidateId: "chosen",
        scenarioId: "failed",
        phase: "verification",
        status: "failed",
        report: null,
      },
      {
        candidateId: "other",
        scenarioId: "missing",
        phase: "verification",
        status: "completed",
        report: { verdict: "PASS" },
      },
      {
        candidateId: "chosen",
        scenarioId: "cancelled",
        phase: "verification",
        status: "cancelled",
        report: null,
      },
    ],
  } as Experiment;
  assert.deepEqual(
    verificationRows(experiment).map((row) => row.verdict),
    ["PASS", "INCONCLUSIVE", "INCONCLUSIVE", "INCONCLUSIVE"],
  );
});

test("process success without a verifier report never becomes PASS", () => {
  const experiment = {
    lockedCandidateId: "chosen",
    scenarios: [{ id: "one", role: "verification" }],
    trials: [
      {
        candidateId: "chosen",
        scenarioId: "one",
        phase: "verification",
        status: "completed",
        report: null,
      },
    ],
  } as unknown as Experiment;
  assert.equal(verificationRows(experiment)[0].verdict, "INCONCLUSIVE");
});

test("plot preserves missing observation gaps and does not fabricate zeros", () => {
  assert.equal(
    curvePath(
      { name: "response", unit: "V", x: [0, 1, 2, 3], y: [0, NaN, 2, 3] },
      [0, 3, 0, 3],
    ),
    "M80.00,200.00  M378.67,88.00 L528.00,32.00",
  );
  assert.equal(numeric(null), "Not available");
  assert.equal(numeric(Infinity), "Not available");
  assert.equal(numeric(0), "0");
});

test("baseline and candidate pairing matches observable names, not array order", () => {
  const trial = (names: string[]) =>
    ({
      observation: {
        series: names.map((name) => ({ name, unit: "s", x: [0], y: [1] })),
      },
    }) as Trial;
  const paired = pairedSeries(
    trial(["output", "effort"]),
    trial(["effort", "output"]),
  );
  assert.equal(paired[0].baseline?.name, "effort");
  assert.equal(paired[1].candidate?.name, "output");
  assert.equal(pairedSeries(undefined, undefined).length, 0);
});

test("cancelled second verification cannot reuse a prior batch's passing evidence", () => {
  const experiment = {
    lockedCandidateId: "chosen",
    verificationOperationId: "second",
    scenarios: [
      { id: "one", role: "verification" },
      { id: "two", role: "verification" },
    ],
    trials: [
      {
        operationId: "first",
        candidateId: "chosen",
        scenarioId: "one",
        phase: "verification",
        status: "completed",
        report: { verdict: "PASS" },
      },
      {
        operationId: "first",
        candidateId: "chosen",
        scenarioId: "two",
        phase: "verification",
        status: "completed",
        report: { verdict: "PASS" },
      },
      {
        operationId: "second",
        candidateId: "chosen",
        scenarioId: "one",
        phase: "verification",
        status: "cancelled",
        report: null,
      },
    ],
  } as unknown as Experiment;
  const rows = verificationRows(experiment);
  assert.deepEqual(
    rows.map((row) => row.verdict),
    ["INCONCLUSIVE", "INCONCLUSIVE"],
  );
  assert.equal(rows[0].trial?.status, "cancelled");
  assert.equal(rows[1].trial, undefined);
});


test("response selection falls back across experiments and never mixes verification into search", () => {
  const search = { candidateId: "chosen", scenarioId: "nominal", phase: "search", status: "completed", observation: { series: [{ name: "output", unit: "", x: [0, 1], y: [0, 1] }] } };
  const experiment = { candidates: [{ id: "baseline" }, { id: "chosen" }], scenarios: [{ id: "nominal", role: "search" }, { id: "held-out", role: "verification" }], trials: [search, { ...search, phase: "verification" }] } as Experiment;
  const response = responseComparison(experiment, "chosen", "previous-experiment-scenario");
  assert.equal(response.scenario?.id, "nominal");
  assert.equal(response.scenarios.length, 1);
  assert.equal(response.selected, search);
  assert.equal(response.series[0].candidate?.y[1], 1);
  assert.equal(response.series[0].baseline, undefined);
});

test("missing selected response never substitutes a baseline as candidate data", () => {
  const baseline = { candidateId: "baseline", scenarioId: "nominal", phase: "search", observation: { series: [{ name: "output", unit: "", x: [0, 1], y: [0, 0.5] }] } };
  const experiment = { candidates: [{ id: "baseline" }, { id: "chosen" }], scenarios: [{ id: "nominal", role: "search" }], trials: [baseline] } as Experiment;
  const response = responseComparison(experiment, "chosen", "nominal");
  assert.equal(response.selected, undefined);
  assert.equal(response.series[0].candidate, undefined);
  assert.deepEqual(response.series[0].baseline?.y, [0, 0.5]);
});


test("compact failed metrics retain each scenario actual and limit without recomputing verdicts", () => {
  const check = { name: "overshoot", verdict: "FAIL", actual: 20, limit: 10, message: "Above limit" };
  const experiment = { lockedCandidateId: "chosen", scenarios: [{ id: "a", label: "A", role: "verification" }, { id: "b", label: "B", role: "verification" }], trials: [
    { candidateId: "chosen", scenarioId: "a", phase: "verification", report: { checks: [check, { ...check, name: "stability", verdict: "PASS" }] } },
    { candidateId: "chosen", scenarioId: "b", phase: "verification", report: { checks: [{ ...check, actual: 30 }] } },
  ] } as Experiment;
  const groups = failedCheckGroups(experiment);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].failures.map(({ scenario, check }) => [scenario, check.actual, check.limit]), [["A", 20, 10], ["B", 30, 10]]);
});


test("signal labels are concise without changing observation keys", () => {
  assert.deepEqual(["reference", "disturbance", "controlEffort", "disturbanceControlEffort", "frequencyGain", "frequencyPhase"].map(signalLabel),
    ["Tracking", "Disturbance", "Control effort", "Disturbance effort", "Gain", "Phase"]);
  assert.equal(signalLabel("otherSignal"), "other Signal");
});

test("saved search metrics stay unavailable until every scenario has a finite actual", () => {
  const check = (name: string, actual: number | null) => ({ name, verdict: actual == null ? "INCONCLUSIVE" : "PASS", actual, limit: 1, message: "" });
  const trial = (scenarioId: string, overshoot: number | null) => ({
    candidateId: "chosen", scenarioId, phase: "search", status: "completed",
    report: { checks: [check("Target overshoot", overshoot), check("Target settling time", 4), check("Final-window target error", 0.001)] },
  });
  const experiment = {
    templateId: "robust-pid",
    scenarios: [{ id: "nominal", role: "search" }, { id: "gain-low", role: "search" }, { id: "held", role: "verification" }],
    trials: [trial("nominal", 0.2), trial("gain-low", 0.05), { ...trial("held", 0.9), phase: "verification" }],
  } as Experiment;
  assert.deepEqual(worstMetrics(experiment, "chosen").map((item) => item.value), [0.2, 4, 0.001]);
  const partial = { ...experiment, trials: [trial("nominal", null), trial("gain-low", 0.05)] } as Experiment;
  assert.equal(worstMetrics(partial, "chosen")[0].value, null);
});

test("verification concepts do not point the chart at a held-out scenario", () => {
  const check = { name: "Target overshoot", verdict: "FAIL", actual: 0.2, limit: 0.1, message: "Above limit" };
  const experiment = {
    templateId: "robust-pid",
    criteria: { overshootMax: 0.1 },
    lockedCandidateId: "chosen",
    verificationOperationId: "final",
    scenarios: [{ id: "nominal", role: "search" }, { id: "nominal-final", role: "verification" }],
    trials: [{
      candidateId: "chosen", scenarioId: "nominal-final", phase: "verification", operationId: "final",
      report: { checks: [check] },
    }, {
      candidateId: "chosen", scenarioId: "nominal", phase: "search",
      report: { checks: [{ ...check, actual: 0.01, verdict: "PASS" }] },
    }],
  } as Experiment;
  const [concept] = checkConcepts(experiment, "chosen", "verification");
  assert.equal(concept.verdict, "FAIL");
  assert.equal(concept.chartScenarioId, null);
  assert.equal(concept.actual, 0.2);
  assert.equal(signalForCheck(concept.name), "reference");
  assert.equal(chartTarget("robust-pid", "reference"), 1);
  assert.equal(chartTarget("robust-pid", "controlEffort"), null);
  assert.equal(chartTarget("active-filter", "reference"), null);
  const summary = verdictSummary([concept], 1);
  assert.equal(summary.title, "1 constraint failed");
});

test("draft proposal stays inside the frozen range and does not claim acceptance", () => {
  const ranges = { kp: { min: 0, max: 8 }, ki: { min: 0, max: 5 }, kd: { min: 0, max: 2 } };
  const current = { kp: 3.5, ki: 1.8, kd: 0.5 };
  const failed = suggestedDraft("robust-pid", current, ranges, [{ name: "Target overshoot", verdict: "FAIL" }]);
  assert.ok(failed.values);
  assert.ok(failed.values.kp < current.kp && failed.values.ki < current.ki && failed.values.kd > current.kd);
  assert.equal(failed.values.kp >= 0 && failed.values.kd <= 2, true);
  assert.equal(failed.message.includes("acceptance") || failed.message.includes("passed"), false);
  const passed = suggestedDraft("robust-pid", current, ranges, [{ name: "Target overshoot", verdict: "PASS" }]);
  assert.equal(passed.values, null);
  assert.match(passed.message, /Review the evidence/);
  assert.equal(draftRangeError({ kp: 9, ki: 1, kd: 0.2 }, ranges), "kp must be between 0 and 8");
  assert.equal(draftRangeError({ kp: 2, ki: 1, kd: 0.2 }, ranges), null);
  const candidates = [{ id: "baseline", parameters: { kp: 2, ki: 1, kd: 0.3 } }, { id: "other", parameters: { kp: 3, ki: 1, kd: 0.4 } }];
  assert.equal(matchingCandidate(candidates, { kp: 3, ki: 1, kd: 0.4 }, ["kp", "ki", "kd"])?.id, "other");
  assert.equal(matchingCandidate(candidates, { kp: 3.1, ki: 1, kd: 0.4 }, ["kp", "ki", "kd"]), undefined);
});

test("candidate rows show design parameters and units, retaining source metadata unchanged", () => {
  const control = { kp: 2, ki: 1, kd: .3, n: 12, horizon: 12, samples: 1201 };
  assert.equal(candidateParameterSummary(control), "Kp = 2, Ki = 1, Kd = 0.3, N = 12 rad/s");
  assert.equal(candidateParameterSummary({ r: 1000, c: 1e-7, gain: 1.586, horizon: .005, samples: 1001 }), "R = 1000 Ω, C = 1e-7 F, Gain = 1.586");
  assert.equal(candidateParameterSummary({ horizon: 12, samples: 1201 }), "Fixed controller");
  assert.deepEqual(control, { kp: 2, ki: 1, kd: .3, n: 12, horizon: 12, samples: 1201 });
});
