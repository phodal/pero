import assert from "node:assert/strict";
import test from "node:test";
import { parsePaperCitation, scientificReferenceState, type ScientificReference, type ScientificReferenceState } from "../src/document.ts";

test("Paper citation imports preserve the owner, report digest and exact location", () => {
  const reportId = "a".repeat(64);
  const root = `pero-app-location://paper-agent/main/report/${reportId}`;
  assert.deepEqual(parsePaperCitation(` ${root}/citation/0 `), {
    app: "paper-agent", kind: "report-citation", id: reportId, version: reportId, locator: `${root}/citation/0`,
  });
  assert.equal(parsePaperCitation(`${root}/passage/${"b".repeat(64)}`)?.kind, "report-passage");
  for (const input of [root, `${root}/citation/0?changed=1`, `${root}/citation/-1`, `${root.replace("paper-agent", "notebook")}/citation/0`]) {
    assert.equal(parsePaperCitation(input), null);
  }
});

test("Scientific reference state records identity completeness without claiming verification", () => {
  const source: ScientificReference = { app: "paper-agent", kind: "report-citation", id: "report", version: "version", locator: "" };
  const cases: { name: string; source: ScientificReference | null | undefined; expected: ScientificReferenceState }[] = [
    { name: "no reference", source: null, expected: "missing" },
    { name: "absent reference", source: undefined, expected: "missing" },
    { name: "empty draft", source: { app: "", kind: "", id: "", version: "", locator: "" }, expected: "partial" },
    ...(["app", "kind", "id"] as const).map(field => ({
      name: `blank ${field} despite a version`, source: { ...source, [field]: "  " }, expected: "partial" as const,
    })),
    { name: "complete identity without a version", source: { ...source, version: "" }, expected: "unpinned" },
    { name: "whitespace version", source: { ...source, version: "  " }, expected: "unpinned" },
    { name: "version supplied without a locator", source, expected: "pinned" },
    { name: "locator does not validate a missing identity", source: { ...source, id: "", locator: "some-location" }, expected: "partial" },
    { name: "surrounding whitespace", source: { ...source, app: " paper-agent ", version: " version " }, expected: "pinned" },
  ];
  for (const row of cases) assert.equal(scientificReferenceState(row.source), row.expected, row.name);
});
