import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isControlEvidenceSnapshot, parseControlEvidenceLocation, readControlEvidence,
} from "../src/control-evidence.ts";

// Generated with fixtures/control-export.py from the actual Control Lab store
// using the deterministic test oracle. Kept as bytes to retain Python numbers.
const raw = readFileSync(new URL("./fixtures/control-export.json", import.meta.url), "utf8");
const experiment = JSON.parse(raw).experiment;

test("imports distinct Control Lab trial reports with their owner location and exact check numbers", async () => {
  const receipts = await readControlEvidence(new Blob([raw]));
  const exportSha256 = createHash("sha256").update(raw).digest("hex");
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map(({ snapshot }) => snapshot.phase), ["search", "verification"]);
  for (const [index, { title, reference, snapshot }] of receipts.entries()) {
    const trial = experiment.trials[index];
    assert.ok(isControlEvidenceSnapshot(snapshot));
    assert.equal(title, experiment.title);
    assert.deepEqual(parseControlEvidenceLocation(reference.locator), { experimentId: experiment.id, trialId: trial.id });
    assert.equal(parseControlEvidenceLocation(reference.locator + "\n"), null);
    assert.equal(reference.version, trial.report.id);
    assert.equal(snapshot.reportId, trial.report.id);
    assert.equal(snapshot.observationId, trial.observation.id);
    assert.equal(snapshot.inputDigest, trial.observation.inputDigest);
    assert.equal(snapshot.verdict, trial.report.verdict);
    assert.equal(snapshot.exportSha256, exportSha256);
    assert.equal(snapshot.checks[0].actual, "1.0");
    assert.equal(snapshot.checks[0].limit, "1.0");
  }
});

test("refuses detached or modified Control Lab evidence at the owning digest boundary", async () => {
  const firstTrial = experiment.trials[0];
  const wrongDigest = "a".repeat(64);
  for (const [mutated, reason] of [
    [raw.replaceAll('"horizon":2.0', '"horizon":3.0'), /specification integrity/],
    [raw.replace(firstTrial.observation.inputDigest, wrongDigest), /trial input integrity/],
    [raw.replace('"engineVersion":"test-oracle"', '"engineVersion":"unrelated"'), /observation integrity/],
    [raw.replace(firstTrial.report.id, wrongDigest), /verification report integrity/],
    [raw.replace("Fixture observation", "Changed observation"), /artifact integrity/],
  ] as const) {
    assert.notEqual(mutated, raw, "fixture must exercise " + reason);
    await assert.rejects(readControlEvidence(new Blob([mutated])), reason);
  }
});
