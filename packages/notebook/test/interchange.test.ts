import assert from "node:assert/strict";
import test from "node:test";
import type { NotebookNode } from "../src/document.ts";
import {
  canReplace, persistedBlockTypes, projectNotebook, protectUnknownNodes, readStoredReference,
  restoreBlockNote, restoreMyst, restoreRetainedNodes,
} from "../src/interchange.ts";

const report = "b".repeat(64);
const experiment = "a".repeat(32);

function doc(content: NotebookNode[]): NotebookNode {
  return { type: "doc", content };
}

function paragraph(text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]): NotebookNode {
  return { type: "paragraph", attrs: { blockId: "p1" }, content: [{ type: "text", text, ...(marks ? { marks } : {}) }] };
}

test("prose round-trips through the BlockNote and MyST subsets without dropping the editor block id", () => {
  const content = doc([
    paragraph("Measured", [{ type: "bold" }, { type: "italic" }]),
    { type: "heading", attrs: { blockId: "h1", level: 2 }, content: [{ type: "text", text: "Setup" }] },
    { type: "codeBlock", attrs: { blockId: "c1", language: "python" }, content: [{ type: "text", text: "print(1)" }] },
  ]);
  const projected = projectNotebook(content);
  assert.equal(projected.losses.length, 0);
  assert.equal(canReplace(projected, "blockNote"), true);
  assert.equal(canReplace(projected, "myst"), true);
  assert.deepEqual(restoreBlockNote(projected), content);
  assert.deepEqual(restoreMyst(projected), content);
  assert.equal(projected.blockNote[0].id, "p1");
  assert.deepEqual(projected.blockNote[0].content?.[0].styles, { bold: true, italic: true });
  assert.equal(JSON.stringify(projected).includes("tableContent"), false);
});

test("a link mark is kept and blocks both export views", () => {
  const content = doc([paragraph("paper", [{ type: "link", attrs: { href: "https://example.test/paper" } }])]);
  const projected = projectNotebook(content);
  assert.equal(canReplace(projected, "myst"), false);
  assert.equal(canReplace(projected, "blockNote"), false);
  assert.equal(projected.myst.children.length, 0);
  assert.equal(projected.blockNote.length, 0);
  assert.equal(projected.canonical.content?.[0].content?.[0].marks?.[0].attrs?.href, "https://example.test/paper");
  assert.throws(() => restoreBlockNote(projected), /incomplete/);
});

test("an evidence block id is not the object version, and a snapshot is not a BlockNote prop", () => {
  const source = {
    app: "control-lab", kind: "verification-report", id: experiment, version: report,
    locator: `pero-app-location://control-lab/main/experiment/${experiment}/trial/${"c".repeat(32)}`,
  };
  const evidence: NotebookNode = {
    type: "evidence",
    attrs: { blockId: "block-1", label: "Control receipt", source, snapshot: null },
  };
  const open = projectNotebook(doc([evidence]));
  assert.equal(open.blockNote[0].id, "block-1");
  assert.equal(open.blockNote[0].props.objectId, experiment);
  assert.equal(open.blockNote[0].props.version, report);
  assert.notEqual(open.blockNote[0].id, open.blockNote[0].props.version);
  assert.equal(canReplace(open, "blockNote"), true);
  assert.equal(canReplace(open, "myst"), false);
  assert.equal(open.losses.some(loss => loss.code === "myst-cite-not-owner-record"), true);
  const cite = open.withheld[0].myst as { identifier: string; error?: string };
  assert.equal(cite.identifier, source.locator);
  assert.equal(cite.identifier.includes("block-1"), false);
  assert.deepEqual(restoreBlockNote(open), doc([evidence]));

  const frozen = projectNotebook(doc([{ ...evidence, attrs: { ...evidence.attrs, snapshot: { kind: "control-receipt", reportId: report } } }]));
  assert.equal(canReplace(frozen, "blockNote"), false);
  assert.equal(frozen.blockNote.length, 0);
  assert.equal(frozen.losses.some(loss => loss.code === "snapshot-not-in-editor-props"), true);
  assert.equal(frozen.canonical.content?.[0].attrs?.snapshot && (frozen.canonical.content[0].attrs.snapshot as { reportId: string }).reportId, report);
  assert.equal(JSON.stringify(frozen.blockNote).includes("control-receipt"), false);
});

test("a missing or unpinned object version is not replaced with the editor block id", () => {
  const unpinned = projectNotebook(doc([{
    type: "experiment",
    attrs: { blockId: "block-9", label: "Trial", source: { app: "control-lab", kind: "verification-report", id: experiment, version: "", locator: "" }, snapshot: null },
  }]));
  assert.equal(unpinned.losses.some(loss => loss.code === "unpinned-object-version"), true);
  assert.equal(unpinned.blockNote.length, 0);
  const cite = unpinned.withheld[0].myst as { identifier: string; error?: string };
  assert.equal(cite.identifier, "");
  assert.equal(cite.error, "not found");
  const missing = projectNotebook(doc([{ type: "evidence", attrs: { blockId: "block-2", label: "", source: null, snapshot: null } }]));
  assert.equal(readStoredReference(missing.canonical.content![0]).editorBlockId, "block-2");
  assert.equal(readStoredReference(missing.canonical.content![0]).reference, null);
  assert.equal(missing.losses.some(loss => loss.code === "missing-object-identity"), true);
});

test("sheets and structured tables are not flattened into rich-text cells or recalculated", () => {
  const content = doc([
    { type: "spreadsheet", attrs: { blockId: "sheet", sheet: { rows: 1, columns: 1, cells: { A1: "=SUM(A1)" } } } },
    { type: "inputTable", attrs: { blockId: "table", table: { id: "rows", columns: [{ id: "mass", type: "quantity", unit: "mg" }] }, receipts: [] } },
    { type: "section", attrs: { blockId: "section", label: "Notes", date: "" }, content: [paragraph("inside")] },
  ]);
  const projected = projectNotebook(content);
  assert.deepEqual(projected.blockNote, []);
  assert.deepEqual(projected.myst.children, []);
  assert.equal(projected.losses.some(loss => loss.code === "formula-not-exported"), true);
  assert.equal(projected.losses.some(loss => loss.code === "table-content-is-not-measurement"), true);
  assert.equal(projected.losses.some(loss => loss.code === "outside-subset" && loss.detail.startsWith("section")), true);
  assert.equal(JSON.stringify(projected.blockNote).includes("SUM"), false);
  assert.equal(JSON.stringify(projected.myst).includes("mg"), false);
  assert.equal((projected.canonical.content?.[0].attrs?.sheet as { cells: { A1: string } }).cells.A1, "=SUM(A1)");
});

test("an unknown block is retained and restored, and a block without an id is refused intact", () => {
  const future: NotebookNode = { type: "instrumentReading", attrs: { blockId: "inst-1", reading: "kept" }, content: [paragraph("raw")] };
  const content = doc([future, paragraph("stays")]);
  const protectedDocument = protectUnknownNodes(content);
  assert.equal(protectedDocument.changed, true);
  assert.equal(protectedDocument.content.content?.[0].type, "retainedBlock");
  assert.deepEqual(restoreRetainedNodes(protectedDocument.content), content);
  const projected = projectNotebook(protectedDocument.content);
  assert.equal(projected.losses.some(loss => loss.code === "retained-envelope"), true);
  assert.equal(JSON.stringify(projected.blockNote).includes("instrumentReading"), false);
  const plain = doc([paragraph("stays")]);
  const unchanged = protectUnknownNodes(plain);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.content, plain);
  const refused = protectUnknownNodes(doc([{ type: "instrumentReading", attrs: { reading: "orphan" } }]));
  assert.deepEqual(refused.errors, ["content.0 instrumentReading has no editor block id, so it was left untouched and was not removed"]);
  assert.equal(refused.content.content?.[0].type, "instrumentReading");
});

test("template origin and any other stored attribute block replacement instead of being dropped", () => {
  const origin = { templateId: "template-1", revision: 3, instanceId: "instance-1", parameterValues: { sample: "A" }, idMap: { paragraph: "p1" } };
  const content = doc([
    { ...paragraph("Measured"), attrs: { blockId: "p1", templateOrigin: origin } },
    { type: "heading", attrs: { blockId: "h1", level: 2, note: "kept" }, content: [{ type: "text", text: "Setup" }] },
    { type: "evidence", attrs: { blockId: "block-1", label: "Paper", templateOrigin: origin, source: {
      app: "paper-agent", kind: "report-citation", id: "report", version: "report", locator: "page 2",
    }, snapshot: null } },
  ]);
  const projected = projectNotebook(content);
  assert.equal(canReplace(projected, "blockNote"), false);
  assert.equal(canReplace(projected, "myst"), false);
  assert.equal(projected.losses.filter(loss => loss.code === "unrepresented-attribute").length >= 3, true);
  assert.deepEqual(projected.canonical.content?.[0].attrs?.templateOrigin, origin);
  assert.equal(projected.canonical.content?.[1].attrs?.note, "kept");
  assert.throws(() => restoreBlockNote(projected), /incomplete/);
  assert.throws(() => restoreMyst(projected), /incomplete/);
});

test("retention refuses an illegal type name, an oversized payload, and an unknown child of a paragraph", () => {
  const illegal = protectUnknownNodes(doc([{ type: "bad.type", attrs: { blockId: "bad-1" } }]));
  assert.equal(illegal.changed, false);
  assert.match(illegal.errors[0], /cannot be stored/);
  const huge = "x".repeat(70_000);
  const oversized = protectUnknownNodes(doc([{ type: "instrumentReading", attrs: { blockId: "big-1", reading: huge } }]));
  assert.equal(oversized.changed, false);
  assert.match(oversized.errors[0], /too large/);
  const nested = protectUnknownNodes(doc([{ type: "paragraph", attrs: { blockId: "p1" }, content: [
    { type: "text", text: "before" }, { type: "instrumentReading", attrs: { blockId: "inside" } },
  ] }]));
  assert.equal(nested.changed, false);
  assert.match(nested.errors[0], /cannot be retained inside paragraph/);
  assert.equal(nested.content.content?.[0].content?.[1].type, "instrumentReading");
});

test("the persisted block list is the parser list plus the retention envelope", () => {
  assert.equal(persistedBlockTypes.includes("retainedBlock"), true);
  assert.equal(new Set(persistedBlockTypes).size, persistedBlockTypes.length);
});
