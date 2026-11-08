import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
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


test("Excel date imports retain serial values in both workbook date systems", async () => {
  for (const date1904 of [false, true]) {
    const workbook = new ExcelJS.Workbook();
    workbook.properties.date1904 = date1904;
    const worksheet = workbook.addWorksheet("Dates");
    worksheet.getCell("A1").value = new Date("2024-01-01T12:00:00Z");
    const serial = date1904 ? 43830.5 : 45292.5;
    worksheet.getCell("B1").value = serial;
    worksheet.getCell("C1").value = { formula: "A1-B1" };
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const [imported] = await readWorkbook(bytes.buffer);
    assert.equal(imported.sheet.cells.A1, String(serial));
    assert.equal(evaluateSpreadsheet(imported.sheet).C1, 0);
    assert.deepEqual(await readWorkbook(await writeWorkbook([imported])), [imported]);
  }
});
