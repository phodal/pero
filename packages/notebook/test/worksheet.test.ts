import assert from "node:assert/strict";
import test from "node:test";
import { renameWorksheet, type NotebookWorksheet } from "@pero/notebook/worksheet";

const worksheets = (): NotebookWorksheet[] => [
  { id: "control", name: "Controls", sheet: { rows: 1, columns: 2, cells: { A1: "4", B1: "=Controls!A1" } } },
  { id: "result", name: "Results", sheet: { rows: 1, columns: 2, cells: { A1: "=Controls!A1*3", B1: '=IF(TRUE,"Controls!A1",0)' } } },
  { id: "other", name: "Notes", sheet: { rows: 1, columns: 1, cells: { A1: "Controls!A1" } } },
];

test("worksheet rename preserves identities, input values and unambiguous formula dependencies", () => {
  for (const [name, reference] of [["Calibration data", "'Calibration data'"], ["O'Brien", "'O''Brien'"], ["controls", "controls"]]) {
    const original = worksheets();
    const before = structuredClone(original);
    const result = renameWorksheet(original, "control", name);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") throw new Error(result.status);
    assert.deepEqual(original, before);
    assert.deepEqual(result.worksheets.map(sheet => sheet.id), ["control", "result", "other"]);
    assert.equal(result.worksheets[0].name, name);
    assert.equal(result.worksheets[0].sheet.cells.B1, `=${reference}!A1`);
    assert.equal(result.worksheets[1].sheet.cells.A1, `=${reference}!A1*3`);
    assert.equal(result.worksheets[1].sheet.cells.B1, before[1].sheet.cells.B1);
    assert.deepEqual(result.worksheets[2], before[2]);
  }
});

test("worksheet rename refuses invalid or duplicate names and retains ambiguous references", () => {
  const original = worksheets();
  for (const name of ["", " ", "History", "a/b", "a?b", "'quoted'", "a".repeat(32)]) {
    assert.equal(renameWorksheet(original, "control", name).status, "invalid", name);
  }
  for (const name of ["Results", "RESULTS", "notes"]) {
    assert.equal(renameWorksheet(original, "control", name).status, "duplicate", name);
  }
  assert.deepEqual(renameWorksheet(original, "missing", "New"), { status: "ok", worksheets: original });
  assert.deepEqual(renameWorksheet(original, "control", "Controls"), { status: "ok", worksheets: original });
  const ambiguous = [...original, { ...original[0], id: "duplicate", name: "CONTROLS" }];
  const renamed = renameWorksheet(ambiguous, "control", "Calibration");
  assert.equal(renamed.status, "ok");
  if (renamed.status !== "ok") throw new Error(renamed.status);
  assert.equal(renamed.worksheets[0].name, "Calibration");
  assert.equal(renamed.worksheets[3].name, "CONTROLS");
  assert.deepEqual(renamed.worksheets.map(worksheet => worksheet.sheet), ambiguous.map(worksheet => worksheet.sheet));
});

test('worksheet calculations stay keyed to stable IDs when names collide, including letter case', async () => {
  const { calculateNotebookWorksheets, resolveWorksheetNames } = await import('../src/worksheet.ts');
  for (const secondName of ['Data', 'data']) {
    const original = [
      { id: 'first', name: 'Data', sheet: { rows: 1, columns: 3, cells: { A1: '2', B1: '=A1*3', C1: '=Data!A1' } } },
      { id: 'second', name: secondName, sheet: { rows: 1, columns: 2, cells: { A1: '9', B1: '=A1*3' } } },
      { id: 'third', name: 'Summary', sheet: { rows: 1, columns: 1, cells: { A1: '=Data!A1' } } },
    ];
    const before = structuredClone(original), result = calculateNotebookWorksheets(original);
    assert.deepEqual(result.get('first'), { name: 'Data', ambiguous: true, values: { A1: 2, B1: 6, C1: '#REF!' } });
    assert.deepEqual(result.get('second'), { name: secondName, ambiguous: true, values: { A1: 9, B1: 27 } });
    assert.equal(result.get('third')!.values.A1, '#REF!');
    assert.deepEqual(original, before);
  }
  const unnamed = [
    { id: 'named', name: 'Sheet1', sheet: { rows: 1, columns: 1, cells: { A1: '4' } } },
    { id: 'empty', name: '', sheet: { rows: 1, columns: 1, cells: { A1: '=Sheet1!A1*2' } } },
    { id: 'spaces', name: '   ', sheet: { rows: 1, columns: 1, cells: { A1: '=Sheet2!A1*2' } } },
  ];
  assert.deepEqual(resolveWorksheetNames(unnamed).map(sheet => sheet.name), ['Sheet1', 'Sheet2', 'Sheet3']);
  const result = calculateNotebookWorksheets(unnamed);
  assert.equal(result.get('empty')!.values.A1, 8); assert.equal(result.get('spaces')!.values.A1, 16);
});
