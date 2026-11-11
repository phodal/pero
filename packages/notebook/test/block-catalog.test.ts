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
