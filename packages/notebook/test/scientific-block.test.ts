import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  defineDocumentBlock, defineReferenceBlock, editorAdapter, evidenceReference, experimentReference,
  noteCardDefinition, registerDocumentBlock, unregisterDocumentBlock, referenceReview,
} from "../src/scientific-block.ts";

const contract = JSON.parse(readFileSync(new URL("./fixtures/document-block-contract.json", import.meta.url), "utf8")) as {
  noteCard: Record<string, { blockId: string; schemaVersion: number; text?: string; extra?: boolean }>;
  axisSpan: Record<string, { blockId: string; schemaVersion: number | string; low: number | string; high?: number; unit?: string; span?: number[] }>;
};

const axisSpan = defineDocumentBlock({
  type: "axisSpan",
  defaults: { low: 0, high: 1, unit: "" },
  versionOne(attrs) {
    if (!Number.isInteger(attrs.low) || !Number.isInteger(attrs.high) || attrs.low >= attrs.high) throw new Error("Invalid axis span order.");
    if (attrs.unit.length > 32) throw new Error("Invalid axis span unit.");
  },
});

test("document and reference definitions do not enumerate example types", () => {
  const note = editorAdapter(noteCardDefinition);
  const span = editorAdapter(axisSpan);
  assert.equal(note.role, "document");
  assert.equal(span.role, "document");
  assert.deepEqual(Object.keys(note.defaults).sort(), ["schemaVersion", "text"]);
  assert.deepEqual(Object.keys(span.defaults).sort(), ["high", "low", "schemaVersion", "unit"]);
  assert.equal(evidenceReference.command, "propose_reference");
  assert.equal(experimentReference.command, "propose_reference");
  assert.equal(defineReferenceBlock("sample").type, "sample");
  assert.throws(() => defineReferenceBlock("bad type"), /type name/);
  note.validate(contract.noteCard.valid);
  note.validate(contract.noteCard.retained);
  span.validate(contract.axisSpan.valid);
  span.validate(contract.axisSpan.retained);
  assert.throws(() => note.validate(contract.noteCard.badVersion), /schema version/);
  assert.throws(() => note.validate(contract.noteCard.extraField), /fields/);
  assert.throws(() => note.validate({ ...contract.noteCard.valid, text: "x".repeat(4001) }), /text/);
  assert.throws(() => span.validate(contract.axisSpan.badOrder), /order/);
  assert.throws(() => span.validate(contract.axisSpan.badVersion), /schema version/);
  assert.throws(() => registerDocumentBlock(noteCardDefinition), /Duplicate/);
  registerDocumentBlock(axisSpan);
  try {
    assert.throws(() => registerDocumentBlock(axisSpan), /Duplicate/);
  } finally {
    unregisterDocumentBlock("axisSpan");
  }
  assert.throws(() => referenceReview({ proposalId: "proposal-1", expectedRevision: 1, decision: "accept", source: {} } as never), /permission|reference/);
});
