import assert from "node:assert/strict";
import test from "node:test";
import { parsePaperCitation } from "../src/document.ts";

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
