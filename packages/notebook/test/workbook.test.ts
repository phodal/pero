import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSpreadsheet } from "../src/spreadsheet.ts";
import { readWorkbook, writeWorkbook } from "../src/workbook.ts";

test("round trips Excel formulas, typed text and worksheet names without saving computed values as formulas", async () => {
  const original = [{
    name: "Assay results",
    sheet: {
      rows: 3, columns: 2,
      cells: { A1: "'001", A2: "1.5", A3: "2.5", B1: "'=literal", B2: "TRUE", B3: "=SUM(A2:A3)" },
    },
  }, {
    name: "Controls",
    sheet: { rows: 1, columns: 1, cells: { A1: "Control" } },
  }];
  const reopened = await readWorkbook(await writeWorkbook(original));
  assert.deepEqual(reopened, original);
  assert.equal(evaluateSpreadsheet(reopened[0].sheet).B3, 4);
});

test("Excel import rejects an out-of-bounds value instead of silently truncating the worksheet", async () => {
  const bytes = await writeWorkbook([{
    name: "Wide results",
    sheet: { rows: 1, columns: 51, cells: { AY1: "measurement" } },
  }]);
  await assert.rejects(readWorkbook(bytes), /exceeds 200 rows or 50 columns/);
});
