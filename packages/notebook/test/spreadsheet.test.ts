import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isExternalFormula } from "../src/formula-policy.ts";
import { fillCellRange, pasteCellGrid } from "../src/spreadsheet-range.ts";
import {
  cellAddress,
  evaluateSpreadsheet,
  evaluateWorkbook,
  renameWorksheetReferences,
  shiftFormula,
} from "../src/spreadsheet.ts";

test("recalculates sparse formulas and preserves imported literal types", () => {
  const cells = {
    A1: "2",
    A2: "=A1*3",
    A3: "=SUM(A1:A2)",
    A4: "=AVERAGE(A1:A2)",
    A5: "=MIN(A1:A2)",
    A6: "=MAX(A1:A2)",
    A7: "=MEDIAN(A1:A2)",
    A8: "=COUNTBLANK(B1:B6)",
    A9: "=SUM(C:C)",
    A10: "=A20",
    B1: "'001",
    B2: "'=A1",
    B3: "TRUE",
    B4: "12.5%",
    B5: "1.2e3",
    C1: "=A2+4",
    C2: "=SUMIF(A1:A2,\">3\",A1:A2)",
    C3: '=LEN(B2)',
  };
  assert.deepEqual(evaluateSpreadsheet({ rows: 20, columns: 5, cells }), {
    A1: 2, A2: 6, A3: 8, A4: 4, A5: 2, A6: 6, A7: 4, A8: 1, A9: 19, A10: 0,
    B1: "001", B2: "=A1", B3: true, B4: 0.125, B5: 1200, C1: 10, C2: 6, C3: 3,
  });
  const changed = evaluateSpreadsheet({ rows: 20, columns: 5, cells: { ...cells, A1: "3" } });
  assert.equal(changed.A3, 12);
  assert.equal(changed.C1, 13);
  assert.equal(cells.A3, "=SUM(A1:A2)");
});

test("propagates spreadsheet errors and labels every cell of a circular dependency", () => {
  const result = evaluateSpreadsheet({ rows: 10, columns: 3, cells: {
    A1: "=B1+1",
    B1: "=IFERROR(A1,9)",
    C1: "=SUM(A1:B1)",
    A2: "=1/0",
    A3: "=SUM(A1:A2)",
    A4: "=SUM(A2:A2)",
    A5: "=IFERROR(A4,0)",
    A6: "=MADEUP(1)",
    A7: "=1+",
    A8: "=SUM(Missing!A1:A2)",
    A9: '=WEBSERVICE("https://example.invalid/")',
    A10: "=TODAY()",
    B2: "=SUM(#REF!:B3)",
    B3: "=IFERROR(SUM(B4:#REF!),3)",
    B4: '="A1:#REF!"',
  } });
  assert.deepEqual(result, {
    A1: "#CIRC!", B1: "#CIRC!", C1: "#CIRC!", A2: "#DIV/0!", A3: "#CIRC!",
    A4: "#DIV/0!", A5: 0, A6: "#NAME?", A7: "#ERROR!", A8: "#REF!", A9: "#NAME?", A10: "#NAME?",
    B2: "#REF!", B3: 3, B4: "A1:#REF!",
  });
});

test("uses real range values in lookup and regression", () => {
  const result = evaluateSpreadsheet({ rows: 10, columns: 5, cells: {
    A1: "2", A2: "4", A3: "6",
    B1: "5", B2: "9", B3: "13",
    C1: "Sample", C2: "sample", C3: "Control",
    D1: '=XLOOKUP("SAMPLE",C1:C3,B1:B3)',
    D2: '=XLOOKUP("sample",C1:C3,B1:B3,,0,-1)',
    D3: "=XLOOKUP(3,A1:A3,B1:B3,,1)",
    D4: '=XLOOKUP("absent",C1:C3,B1:B3,"missing")',
    D5: "=SLOPE(B1:B3,A1:A3)",
    D6: "=INTERCEPT(B1:B3,A1:A3)",
    D7: "=RSQ(B1:B3,A1:A3)",
    D8: "=XLOOKUP(3,A1:A3,B1:B3,,2)",
    D9: "=XLOOKUP(3,A1:A3,B1:B3)",
  } });
  assert.deepEqual(
    Object.fromEntries(Object.entries(result).filter(([cell]) => cell.startsWith("D"))),
    { D1: 5, D2: 9, D3: 9, D4: "missing", D5: 2, D6: 1, D7: 1, D8: "#VALUE!", D9: "#N/A" },
  );
});

test("calculates cross-sheet ranges and cycles using case-insensitive worksheet names", () => {
  const values = evaluateWorkbook([
    { name: "Summary", sheet: { rows: 5, columns: 3, cells: {
      A1: "=SUM('Input data'!A1:A2)",
      A2: "='O''Neil'!A1+'input DATA'!A2",
      A3: "='Input data'!B1",
      A4: "=IFERROR(Missing!A1,9)",
      A5: "=Input2!A1",
    } } },
    { name: "Input data", sheet: { rows: 2, columns: 2, cells: { A1: "3", A2: "=A1*2", B1: "=Summary!A3" } } },
    { name: "O'Neil", sheet: { rows: 1, columns: 1, cells: { A1: "5" } } },
    { name: "Input2", sheet: { rows: 1, columns: 1, cells: { A1: "=SUM('Input data'!A:A)" } } },
  ]);
  assert.deepEqual(values.Summary, { A1: 9, A2: 11, A3: "#CIRC!", A4: 9, A5: 9 });
  assert.deepEqual(values["Input data"], { A1: 3, A2: 6, B1: "#CIRC!" });
});

test("shifts relative addresses, preserves anchors and treats an invalid range as #REF", () => {
  assert.equal(cellAddress(26, 0), "AA1");
  assert.equal(cellAddress(16_383, 1_048_575), "XFD1048576");
  assert.equal(cellAddress(-1, 0), "#REF!");
  assert.equal(
    shiftFormula(`=SUM(A1:B2,$C3,D$4,$E$5,A:C,2:$4)+'A1'!A1+LOG10(A1)+1E10&"A1""B2"`, 1, 2),
    `=SUM(B3:C4,$C5,E$4,$E$5,B:D,4:$4)+'A1'!B3+LOG10(B3)+1E10&"A1""B2"`,
  );
  const invalid = shiftFormula("=SUM(A1:B2)", -1, 0);
  assert.equal(invalid, "=SUM(#REF!)");
  assert.equal(evaluateSpreadsheet({ rows: 2, columns: 2, cells: { A1: invalid } }).A1, "#REF!");
  assert.equal(shiftFormula("A1", 1, 2), "A1");
});

test("renames only matching local worksheet qualifiers and keeps absolute cell references", () => {
  const original = "=SUM(Input!$A$1:'iNput'!$A$2)+input!A$3+Inputs!A1";
  assert.equal(renameWorksheetReferences(original, "Input", "Sample_2"),
    "=SUM(Sample_2!$A$1:'Sample_2'!$A$2)+Sample_2!A$3+Inputs!A1");
  assert.equal(renameWorksheetReferences("=INPUT!A1", "input", "Input"), "=Input!A1");
  const renamed = renameWorksheetReferences("=SUM('O''Neil'!$A$1:$A$2)", "o'neil", "Sam's data");
  assert.equal(renamed, "=SUM('Sam''s data'!$A$1:$A$2)");
  assert.deepEqual(evaluateWorkbook([
    { name: "Summary", sheet: { rows: 1, columns: 1, cells: { A1: renamed } } },
    { name: "Sam's data", sheet: { rows: 2, columns: 1, cells: { A1: "2", A2: "5" } } },
  ]).Summary, { A1: 7 });
});

test("leaves formula text, errors, non-formulas and external workbook qualifiers alone", () => {
  const formula = '=Input!$A$1&"Input!A1""quoted"&[Other.xlsx]Input!A1&\'C:\\[Other.xlsx]Input\'!A1';
  assert.equal(renameWorksheetReferences(formula, "Input", "New data"),
    '=\'New data\'!$A$1&"Input!A1""quoted"&[Other.xlsx]Input!A1&\'C:\\[Other.xlsx]Input\'!A1');
  assert.equal(renameWorksheetReferences("=SUM(0!A1,#DIV/0!)", "0", "Data"), "=SUM(Data!A1,#DIV/0!)");
  assert.equal(renameWorksheetReferences("=IFERROR(REF!A1,#REF!)", "REF", "Data"), "=IFERROR(Data!A1,#REF!)");
  assert.equal(renameWorksheetReferences("'=Input!A1", "Input", "New data"), "'=Input!A1");
  assert.equal(renameWorksheetReferences("='Input!", "Input", "New data"), "='Input!");
});


test("conditional and product aggregates preserve errors without including unselected cells", () => {
  const cases: [string, number | string][] = [
    ['SUMIF(A1:A3,">0",B1:B3)', "#DIV/0!"],
    ['AVERAGEIF(A1:A3,">0",B1:B3)', "#DIV/0!"],
    ['SUMIF(A1:A3,"<2",B1:B3)', 3],
    ['AVERAGEIF(A1:A3,"<2",B1:B3)', 3],
    ['SUMIF(A1:A3,">0")', 6],
    ['AVERAGEIF(A1:A3,">0")', 2],
    ['SUMIF(A1:A3,">9",B1:B3)', 0],
    ['AVERAGEIF(A1:A3,">9",B1:B3)', "#DIV/0!"],
    ['SUMIF(D1:D3,"sample*",A1:A3)', 3],
    ['SUMPRODUCT(A1:A3,B1:B3)', "#DIV/0!"],
    ['SUMPRODUCT(A1:A3,A1:A3)', 14],
    ['SUMPRODUCT(A1:A3,D1:D3)', 0],
    ['SUMPRODUCT(D1:D3)', 0],
    ['SUMPRODUCT(A1:A3,A1:A2)', "#VALUE!"],
    ['IFERROR(SUMPRODUCT(A1:A3,B1:B3),99)', 99],
  ];
  for (const [formula, expected] of cases) {
    const result = evaluateSpreadsheet({ rows: 3, columns: 5, cells: {
      A1: "1", A2: "2", A3: "3", B1: "3", B2: "#DIV/0!", B3: "text",
      D1: "sample-1", D2: "sample-2", D3: "control", E1: "=" + formula,
    } });
    assert.equal(result.E1, expected, formula);
  }
});

test("external formula policy matches the shared cases and keeps supported edits", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/external-formulas.json", import.meta.url), "utf8")) as {
    external: string[];
    ordinary: string[];
  };
  for (const formula of fixture.external) assert.equal(isExternalFormula(formula), true, formula);
  for (const formula of fixture.ordinary) assert.equal(isExternalFormula(formula), false, formula);

  const sheet = { rows: 2, columns: 2, cells: { A1: "=SUM(B1)", B1: "1" } };
  assert.equal(pasteCellGrid(sheet, { column: 1, row: 1 }, [['=WEBSERVICE("https://example.invalid/hook")']]), null);
  assert.equal(sheet.cells.B1, "1");
  assert.equal(pasteCellGrid(sheet, { column: 1, row: 1 }, [["=A1*2"]])?.cells.B2, "=A1*2");
  const filled = fillCellRange(sheet, { start: { column: 0, row: 0 }, end: { column: 0, row: 1 } }, "down");
  assert.equal(filled?.cells.A2, "=SUM(B2)");
  assert.equal(fillCellRange(
    { rows: 2, columns: 1, cells: { A1: '=WEBSERVICE("https://example.invalid/hook")' } },
    { start: { column: 0, row: 0 }, end: { column: 0, row: 1 } },
    "down",
  ), null);
});
