import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotebookDocument } from '../src/document.ts';
import { defaultPrintSettings, notebookPrintSections, notebookPageRule, parsePrintSettings } from '../src/notebook-print.ts';

test('print preferences choose actual sections and validate persisted page settings without modifying content', () => {
  const doc = createNotebookDocument('Print sample');
  doc.content.content.push({ type: 'section', attrs: { blockId: 's1', label: 'Results' }, content: [{ type: 'paragraph' }] });
  doc.procedures = [{ id: 'p1', title: 'Procedure', description: '', materials: [], steps: [] }];
  const before = structuredClone(doc), defaults = defaultPrintSettings(doc);
  assert.deepEqual(notebookPrintSections(doc).map(section => section.id), ['notes', 'section:s1', 'procedure:p1']);
  const configured = parsePrintSettings({ ...defaults, paper: 'Letter', orientation: 'landscape', marginMm: 12, sections: ['section:s1', 'section:removed', 'section:s1'] }, doc);
  assert.deepEqual(configured.sections, ['section:s1']); assert.match(notebookPageRule(configured), /size: Letter landscape; margin: 12mm/);
  for (const patch of [{ marginMm: Infinity }, { marginMm: 0 }, { paper: 'A4; } body { display:none' }, { orientation: 'upside-down' }, { sections: [3] }]) assert.deepEqual(parsePrintSettings({ ...defaults, ...patch }, doc), defaults);
  assert.deepEqual(parsePrintSettings({ ...defaults, sections: [] }, doc).sections, []); assert.deepEqual(doc, before);
});
