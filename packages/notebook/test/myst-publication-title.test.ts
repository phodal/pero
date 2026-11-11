import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMystDocument, type MystNode } from '../src/myst.ts';
import { projectMystPublication } from '../src/myst-publication.ts';
import { exportMystJats } from '../src/myst-jats.ts';

const text = (node: MystNode): string => node.value ?? (node.children ?? []).map(text).join('');
test('labelled publication titles occur once and retain heading numbers', () => {
  const document = parseMystDocument('---\ntitle: Labelled title\nnumbering:\n  title: true\n  heading_1: true\n---\n(title)=\n# Labelled title\n\nBody.\n\n## Section');
  assert.equal(document.ast.children?.find(n => n.type === 'heading')?.enumerator, '1');
  for (const kind of ['docx', 'latex', 'typst'] as const) {
    const projection = projectMystPublication({ document }, kind);
    assert.equal(text(projection.ast).match(/Labelled title/g)?.length, 1);
    assert.match(text(projection.ast), /1 Labelled title/);
  }
  const jats = exportMystJats(document);
  assert.match(jats, /<article-title>1 Labelled title<\/article-title>/);
  assert.doesNotMatch(jats.match(/<body>([\s\S]*)<\/body>/)![1], /Labelled title/);
});
