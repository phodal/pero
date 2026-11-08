import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPaperCitationSnapshot } from "../src/paper-evidence.ts";
import { isControlEvidenceSnapshot } from "../src/control-evidence.ts";

// Python storage runs this same portable shape corpus. Digest verification remains
// at its existing owner-import/storage boundaries, not in these synchronous guards.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/snapshot-contract.json", import.meta.url), "utf8"));

test("portable snapshot shapes agree with the Python document boundary", () => {
  for (const { name, owner, accepted, changes } of fixture.cases) {
    const snapshot = { ...fixture.bases[owner], ...changes };
    const valid = owner === "paper" ? isPaperCitationSnapshot(snapshot) : isControlEvidenceSnapshot(snapshot);
    assert.equal(valid, accepted, `${owner}: ${name}`);
  }
});
