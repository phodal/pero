import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { evaluateSpreadsheet } from "../src/spreadsheet.ts";
import { readWorkbook, writeWorkbook } from "../src/workbook.ts";

function worksheetFormulas(buffer: ArrayBuffer): string[] {
  const bytes = Buffer.from(new Uint8Array(buffer));
  const formulas: string[] = [];
  let offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  while (offset >= 0 && offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = bytes.toString("utf8", nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (name.startsWith("xl/worksheets/") && name.endsWith(".xml")) {
      const xml = (method === 0 ? data : inflateRawSync(data)).toString("utf8");
      for (const match of xml.matchAll(/<f(?:\s[^>]*)?>([^<]*)<\/f>/g)) formulas.push(match[1]);
    }
    const next = dataStart + compressedSize;
    if (next <= offset) break;
    offset = next;
  }
  return formulas;
}

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

test("Excel export keeps supported formulas and stores external formulas as text", async () => {
  const sheet = {
    rows: 3, columns: 3,
    cells: {
      A1: '=WEBSERVICE("https://example.invalid/hook")',
      A2: "1",
      A3: "2",
      B1: "=SUM(A2:A3)",
      B2: "='Calibration data'!A1*3",
      B3: "=cmd|'/c calc'!A0",
      C1: '=FILTERXML("<root/>","//root")',
      C2: '=RTD("prog.id","","topic")',
      C3: '=IMPORTXML("https://example.invalid/hook","//a")',
    },
  };
  assert.equal(evaluateSpreadsheet(sheet).A1, "#NAME?");
  assert.equal(evaluateSpreadsheet(sheet).B1, 3);
  const workbook = [{ name: "Results", sheet }, {
    name: "Calibration data",
    sheet: { rows: 1, columns: 1, cells: { A1: "4" } },
  }];
  const bytes = await writeWorkbook(workbook);
  const formulas = worksheetFormulas(bytes);
  assert.deepEqual(formulas.filter(formula => /WEBSERVICE|FILTERXML|RTD|IMPORTXML|cmd\|/i.test(formula)), []);
  assert.ok(formulas.includes("SUM(A2:A3)"), formulas.join("\n"));
  assert.ok(formulas.some(formula => formula.includes("Calibration data")), formulas.join("\n"));

  const [reopened] = await readWorkbook(bytes);
  assert.equal(reopened.sheet.cells.A1, `'=WEBSERVICE("https://example.invalid/hook")`);
  assert.equal(reopened.sheet.cells.B1, "=SUM(A2:A3)");
  assert.equal(reopened.sheet.cells.B3, "'=cmd|'/c calc'!A0");
  assert.equal(evaluateSpreadsheet(reopened.sheet).A1, '=WEBSERVICE("https://example.invalid/hook")');
  assert.equal(evaluateSpreadsheet(reopened.sheet).B1, 3);

  const source = new ExcelJS.Workbook();
  const worksheet = source.addWorksheet("Imported");
  worksheet.getCell("A1").value = { formula: 'WEBSERVICE("https://example.invalid/hook")' };
  worksheet.getCell("A2").value = 1;
  worksheet.getCell("A3").value = 2;
  worksheet.getCell("B1").value = { formula: "SUM(A2:A3)" };
  const importedBytes = new Uint8Array(await source.xlsx.writeBuffer());
  const [imported] = await readWorkbook(importedBytes.buffer);
  assert.equal(imported.sheet.cells.A1, `'=WEBSERVICE("https://example.invalid/hook")`);
  assert.equal(imported.sheet.cells.B1, "=SUM(A2:A3)");
  const reexported = worksheetFormulas(await writeWorkbook([imported]));
  assert.deepEqual(reexported.filter(formula => /WEBSERVICE/i.test(formula)), []);
  assert.ok(reexported.includes("SUM(A2:A3)"), reexported.join("\n"));
});
