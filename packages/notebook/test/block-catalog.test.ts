import assert from "node:assert/strict";
import test from "node:test";
import { blockCatalog, persistedBlockTypes } from "../src/block-catalog.ts";
import { canReplace, projectNotebook, restoreBlockNote, restoreMyst } from "../src/interchange.ts";

test("the catalog names each persisted block once and does not give tables a prose projection", () => {
  assert.equal(new Set(blockCatalog.map(entry => entry.type)).size, blockCatalog.length);
  assert.deepEqual(persistedBlockTypes, blockCatalog.filter(entry => entry.group === "block").map(entry => entry.type));
  const commands = blockCatalog.filter(entry => entry.command).map(entry => entry.type);
  assert.deepEqual(commands, ["evidence", "experiment"]);
  for (const type of ["inputTable", "registrationTable", "lookupTable", "spreadsheet", "attachment", "chemical", "reactionScheme"]) {
    const entry = blockCatalog.find(item => item.type === type);
    assert.notEqual(entry?.projection.kind, "prose", type);
    assert.equal(entry?.command, undefined, type);
  }
  const sheet = projectNotebook({ type: "doc", content: [{ type: "spreadsheet", attrs: { blockId: "sheet-1", sheet: { rows: 1, columns: 1, cells: { A1: "=SUM(A1)" } } } }] });
  assert.equal(sheet.losses.some(loss => loss.code === "formula-not-exported"), true);
  assert.equal(canReplace(sheet, "blockNote"), false);
  assert.throws(() => restoreBlockNote(sheet), /incomplete/);
  assert.throws(() => restoreMyst(sheet), /incomplete/);
  assert.equal(JSON.stringify(sheet.blockNote).includes("SUM"), false);
  assert.equal((sheet.canonical.content?.[0].attrs?.sheet as { cells: { A1: string } }).cells.A1, "=SUM(A1)");
  const notebook = projectNotebook({ type: "doc", content: [{ type: "ipynbDocument", attrs: { blockId: "nb-1", schemaVersion: 1, source: "{\"nbformat\":4}" } }] });
  assert.equal(notebook.losses.some(loss => loss.code === "ipynb-source-document"), true);
  assert.equal(canReplace(notebook, "myst"), false);
  assert.throws(() => restoreMyst(notebook), /incomplete/);
  assert.equal(JSON.stringify(notebook.blockNote).includes("nbformat"), false);
  assert.equal(notebook.canonical.content?.[0].attrs?.source, "{\"nbformat\":4}");
});

test("catalog losses and outside-subset blocks stay in the notebook document", () => {
  const samples: [string, Record<string, unknown>][] = [
    ["inputTable", { blockId: "t1", marker: "kept-input-table" }],
    ["registrationTable", { blockId: "t2", marker: "kept-registration-table" }],
    ["lookupTable", { blockId: "t3", marker: "kept-lookup-table" }],
    ["mystDocument", { blockId: "m1", source: "kept-myst-source" }],
    ["mystProject", { blockId: "p1", marker: "kept-myst-project" }],
    ["retainedBlock", { blockId: "r1", originalType: "instrumentReading", payload: { type: "instrumentReading", attrs: { blockId: "r1", marker: "kept-retained" } } }],
    ["attachment", { blockId: "a1", filename: "kept-attachment.bin" }],
  ];
  for (const [type, attrs] of samples) {
    const entry = blockCatalog.find(item => item.type === type);
    const content = { type: "doc" as const, content: [{ type, attrs }] };
    const projected = projectNotebook(content);
    assert.deepEqual(projected.canonical, content, type);
    const code = entry?.projection.kind === "loss" ? entry.projection.code : "outside-subset";
    assert.equal(projected.losses.some(loss => loss.code === code), true, type);
    assert.equal(canReplace(projected, "blockNote"), false, type);
    assert.equal(canReplace(projected, "myst"), false, type);
    assert.throws(() => restoreBlockNote(projected), /incomplete/, type);
    assert.throws(() => restoreMyst(projected), /incomplete/, type);
    const marker = JSON.stringify(attrs).match(/kept-[a-z-]+/)?.[0] ?? "";
    assert.equal(JSON.stringify({ blockNote: projected.blockNote, myst: projected.myst }).includes(marker), false, type);
  }
});
