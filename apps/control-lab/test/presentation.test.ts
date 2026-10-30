import test from "node:test";
import assert from "node:assert/strict";
import {
  curvePath,
  numeric,
  pairedSeries,
  verificationRows,
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
    "M48.00,200.00  M368.00,88.00 L528.00,32.00",
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
