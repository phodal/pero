import assert from "node:assert/strict";
import test from "node:test";
import { editorAdapter, noteCardDefinition, referenceBlocks, referenceReview } from "../src/scientific-block.ts";

test("a document block and a reference block declare different capabilities", () => {
  const adapter = editorAdapter(noteCardDefinition);
  assert.equal(adapter.name, "noteCard");
  adapter.validate({ blockId: "note-1", schemaVersion: 1, text: "Keep this note" });
  adapter.validate({ blockId: "note-2", schemaVersion: 2, text: "kept", extra: true });
  assert.throws(() => adapter.validate({ blockId: "note-1", schemaVersion: 0, text: "" }), /schema version/);
  assert.throws(() => adapter.validate({ blockId: "note-1", schemaVersion: 1, text: "x".repeat(4001) }), /text/);
  assert.deepEqual(referenceBlocks.map(block => block.command), ["propose_reference", "propose_reference"]);
  assert.equal("command" in noteCardDefinition, false);
  assert.throws(() => referenceReview({ proposalId: "proposal-1", expectedRevision: 1, decision: "accept", source: {} } as never), /permission|reference/);
});
