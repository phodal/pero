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
  unsavedExperiment,
  worstMetrics,
  applyTranscriptDraft,
  generationPrompt,
  parseGeneratedDraft,
} from "../ui-src/presentation.ts";
import type { Experiment, Field, Trial } from "../ui-src/types.ts";

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

function draftField(name: string, min: number, max: number, step = 0.1, unit = ""): Field {
  return { name, label: name, value: min, min, max, step, unit };
}

test("unsaved example exposes only the template search space and no observations", () => {
  const template = {
    id: "robust-pid",
    title: "Robust filtered PID",
    description: "",
    engine: "python-control",
    parameters: [draftField("kp", 0, 8), draftField("n", 12, 12, 1, "rad/s")],
    criteria: [draftField("overshootMax", 0, 2, 0.01)],
    scenarios: [{ id: "nominal", label: "Nominal", role: "search" as const, parameters: { gain: 1, damping: 1 } }],
  };
  const example = unsavedExperiment(template, { kp: 2, n: 12 }, { overshootMax: 0.1 }, 8);
  assert.deepEqual(Object.keys(example.searchSpace), ["kp"]);
  assert.equal(example.candidates.length, 0);
  assert.equal(example.trials.length, 0);
  assert.equal(example.scenarios[0].id, "nominal");
  assert.deepEqual(unsavedExperiment({ ...template, id: "p-golden" }, { n: 12 }, { overshootMax: 0.1 }, 1).searchSpace, {});
});

test("generated draft accepts only the selected template fields inside their bounds", () => {
  const pid = {
    parameters: [
      draftField("kp", 0, 8), draftField("ki", 0, 5), draftField("kd", 0, 2),
      draftField("n", 12, 12, 1), draftField("horizon", 2, 50, 1, "s"), draftField("samples", 101, 5001, 100),
    ],
    criteria: [draftField("overshootMax", 0, 2, 0.01)],
  };
  const draft = parseGeneratedDraft(pid, {
    parameters: { kp: 2, ki: 1, kd: 0.3, n: 12, horizon: 10, samples: 1001 },
    criteria: { overshootMax: 0.1 },
    candidateBudget: 6,
  });
  assert.equal(draft.budget, 6);
  assert.equal(draft.parameters.samples, 1001);
  const golden = {
    parameters: [draftField("horizon", 2, 50, 1, "s"), draftField("samples", 101, 5001, 100)],
    criteria: [draftField("overshootMax", 0, 2, 0.01)],
  };
  assert.equal(parseGeneratedDraft(golden, {
    parameters: { horizon: 10, samples: 1000 },
    criteria: { overshootMax: 0.1 },
  }).budget, null);
  const filter = {
    parameters: [draftField("r", 100, 10000, 100, "Ω"), draftField("c", 1e-9, 1e-5, 1e-8, "F"), draftField("gain", 1, 2.8, 0.01)],
    criteria: [draftField("cutoffTarget", 10, 50000, 10, "Hz")],
  };
  assert.equal(parseGeneratedDraft(filter, {
    parameters: { r: 1000, c: 1e-7, gain: 1.586 },
    criteria: { cutoffTarget: 1591.5494309 },
  }).criteria.cutoffTarget, 1591.5494309);
  const goldenDraft = { parameters: { horizon: 10, samples: 1001 }, criteria: { overshootMax: 0.1 } };
  assert.throws(() => parseGeneratedDraft(golden, { ...goldenDraft, parameters: { ...goldenDraft.parameters, kp: 1 } }), /Unknown draft field kp/);
  assert.throws(() => parseGeneratedDraft(filter, {
    parameters: { r: 1000, c: 1e-7, gain: 1.586, kp: 1 },
    criteria: { cutoffTarget: 1000 },
  }), /Unknown draft field kp/);
  assert.throws(() => parseGeneratedDraft(golden, { ...goldenDraft, scenarios: [] }), /Unknown draft field scenarios/);
  assert.throws(() => parseGeneratedDraft(golden, { ...goldenDraft, specHash: "abc" }), /Unknown draft field specHash/);
  assert.throws(() => parseGeneratedDraft(golden, { ...goldenDraft, engine: "python-control" }), /Unknown draft field engine/);
  assert.throws(() => parseGeneratedDraft(golden, { ...goldenDraft, parameters: { horizon: 90, samples: 1001 } }), /between 2 and 50/);
  assert.throws(() => parseGeneratedDraft(golden, { ...goldenDraft, parameters: { horizon: 10, samples: 1001.5 } }), /integer/);
  assert.throws(() => parseGeneratedDraft(golden, { ...goldenDraft, parameters: { horizon: 10 } }), /samples is required/);
  assert.throws(() => parseGeneratedDraft(golden, { ...goldenDraft, parameters: { horizon: "10", samples: 1001 } }), /finite number/);
  assert.throws(() => parseGeneratedDraft(golden, { ...goldenDraft, candidateBudget: 0 }), /1 to 30/);
  assert.throws(() => parseGeneratedDraft(golden, { ...goldenDraft, candidateBudget: 1.5 }), /1 to 30/);
  assert.throws(() => parseGeneratedDraft(golden, { ...goldenDraft, budget: 6 }), /Unknown draft field budget/);
  assert.throws(() => parseGeneratedDraft(golden, null), /object/);
  assert.throws(() => parseGeneratedDraft(golden, []), /object/);
  const prompt = generationPrompt(
    { id: "p-golden", title: "P controller · analytic golden", ...golden },
    { horizon: 10, samples: 1001 },
    { overshootMax: 0.1 },
    6,
  );
  assert.match(prompt, /P controller · analytic golden/);
  assert.match(prompt, /not an engineering pass/);
  assert.match(prompt, /End the reply with one JSON object/);
  assert.match(prompt, /candidateBudget/);
  assert.match(prompt, /- horizon \(horizon\): current 10 s; min 2; max 50; step 1/);
  assert.equal(prompt.includes("\n- kp "), false);
  const active = generationPrompt(
    { id: "active-filter", title: "Sallen–Key active low-pass", ...filter },
    { r: 1000, c: 1e-7, gain: 1.586 },
    { cutoffTarget: 1591.5494309 },
    6,
  );
  assert.match(active, /- r \(r\): current 1000 Ω/);
  assert.match(active, /- gain \(gain\)/);
  assert.equal(active.includes("\n- kp "), false);
});

test("transcript JSON applies the last valid draft and leaves the current values when it does not", () => {
  const golden = {
    parameters: [draftField("horizon", 2, 50, 1, "s"), draftField("samples", 101, 5001, 100)],
    criteria: [draftField("overshootMax", 0, 2, 0.01)],
  };
  const current = {
    parameters: { horizon: 10, samples: 1001 },
    criteria: { overshootMax: 0.1 },
    budget: 6,
  };
  const valid = '{"parameters":{"horizon":12,"samples":2001},"criteria":{"overshootMax":0.2},"candidateBudget":4}';
  const applied = applyTranscriptDraft(current, golden, `Notes before the draft.\n${valid}\nThis is not an engineering pass.`, false);
  assert.equal(applied.error, null);
  assert.equal(applied.parameters.horizon, 12);
  assert.equal(applied.parameters.samples, 2001);
  assert.equal(applied.criteria.overshootMax, 0.2);
  assert.equal(applied.budget, 4);
  const earlier = '{"parameters":{"horizon":8,"samples":501},"criteria":{"overshootMax":0.05},"candidateBudget":3}';
  const newer = applyTranscriptDraft(current, golden, `${earlier}\n${valid}`, false);
  assert.equal(newer.error, null);
  assert.equal(newer.parameters.horizon, 12);
  assert.equal(newer.budget, 4);
  const lastValid = applyTranscriptDraft(current, golden, `${earlier}\n{"parameters":{"kp":1},"criteria":{"overshootMax":0.1}}`, false);
  assert.equal(lastValid.error, null);
  assert.equal(lastValid.parameters.horizon, 8);
  assert.equal(lastValid.budget, 3);
  const invalid = applyTranscriptDraft(current, golden, `Try this {"parameters":{"horizon":90,"samples":1001},"criteria":{"overshootMax":0.1}}`, false);
  assert.equal(invalid.parameters, current.parameters);
  assert.equal(invalid.criteria, current.criteria);
  assert.equal(invalid.budget, current.budget);
  assert.match(invalid.error ?? "", /between 2 and 50/);
  const broken = applyTranscriptDraft(current, golden, "not json {", false);
  assert.equal(broken.parameters, current.parameters);
  assert.match(broken.error ?? "", /did not return a validated draft/);
  const frozen = applyTranscriptDraft(current, golden, valid, true);
  assert.equal(frozen.parameters, current.parameters);
  assert.equal(frozen.criteria, current.criteria);
  assert.equal(frozen.budget, current.budget);
  assert.match(frozen.error ?? "", /frozen experiment/);
});

for (const phase of ["search", "verification"] as const) {
  test(`${phase} partial checks keep incomplete evidence inconclusive without crashing`, () => {
    const saved = { name: "Target overshoot", verdict: "PASS", actual: 0.05, limit: 0.1, message: "Within limit" };
    const experiment = {
      templateId: "robust-pid", criteria: { overshootMax: 0.1 },
      scenarios: [{ id: "first", role: phase }, { id: "pending", role: phase }],
      trials: [{ candidateId: "chosen", scenarioId: "first", phase, report: { checks: [saved] } }],
    } as Experiment;
    const [partial] = checkConcepts(experiment, "chosen", phase);
    assert.equal(partial.verdict, "INCONCLUSIVE");
    assert.equal(partial.actual, saved.actual);
    assert.equal(partial.scenarioId, "first");
    assert.match(partial.message, /Not every frozen scenario has this check/);
    assert.notEqual(verdictSummary([partial], 2).title, "All checks passed");
    const complete = { ...experiment, trials: [...experiment.trials, { ...experiment.trials[0], scenarioId: "pending" }] };
    assert.equal(checkConcepts(complete, "chosen", phase)[0].verdict, "PASS");
    for (const verdict of ["FAIL", "INCONCLUSIVE"] as const) {
      const explicit = { ...complete, trials: [complete.trials[0], { ...complete.trials[1], report: { checks: [{ ...saved, verdict, actual: null, message: "Explicit evidence" }] } }] } as Experiment;
      const [concept] = checkConcepts(explicit, "chosen", phase);
      assert.equal(concept.verdict, verdict);
      assert.equal(concept.scenarioId, "pending");
      assert.equal(concept.message, "Explicit evidence");
    }
  });
}
