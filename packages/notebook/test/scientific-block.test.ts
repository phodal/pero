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
  const current = note.validate(contract.noteCard.valid);
  assert.equal(current.status, "current");
  if (current.status === "current") assert.equal(current.attrs.text, "Keep this note");
  const retained = note.validate({
    blockId: "note-future", schemaVersion: 2, text: { rich: true }, detail: { samples: [{ id: "sample-kept", note: null }] },
  });
  assert.equal(retained.status, "opaque");
  if (retained.status === "opaque") {
    assert.deepEqual(retained.attrs.text, { rich: true });
    assert.deepEqual(retained.attrs.detail, { samples: [{ id: "sample-kept", note: null }] });
  }
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

test("current fields validate before identity assignment while future records follow explicit policy", () => {
  const definition = defineDocumentBlock({
    type: "sourceDocument",
    defaults: { source: "" },
    futureVersions: "reject",
    versionOne(attrs) {
      if (new TextEncoder().encode(attrs.source).length > 8) throw new Error("Source exceeds 8 bytes.");
    },
  });
  const fields = { schemaVersion: 1, source: "科研" };
  assert.deepEqual(definition.validateFields(fields), fields);
  assert.throws(() => definition.validate(fields), /Block id/);
  assert.deepEqual(definition.validate({ blockId: "source-1", ...fields }), { status: "current", attrs: { blockId: "source-1", ...fields } });
  for (const invalid of [
    { schemaVersion: 1, source: 3 },
    { schemaVersion: 1, source: "", ast: {} },
    { schemaVersion: 1, source: "科研文" },
    { schemaVersion: 2, source: "" },
    { source: "" },
  ]) {
    assert.throws(() => definition.validateFields(invalid));
    assert.throws(() => definition.validate({ blockId: "source-1", ...invalid }));
  }
  const future = { blockId: "future-1", schemaVersion: 2, replacement: { content: ["retained"] } };
  assert.deepEqual(noteCardDefinition.validate(future), { status: "opaque", schemaVersion: 2, attrs: future });
  assert.deepEqual(axisSpan.validate(future), { status: "opaque", schemaVersion: 2, attrs: future });
  assert.throws(() => noteCardDefinition.validateFields(future), /schema version/);
  assert.throws(() => axisSpan.validateFields(future), /schema version/);
  assert.throws(() => definition.validate(future), /schema version/);
});
