import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { parseMystDocument, exportMystMarkdown, type MystNode } from '../src/myst.ts';
import { renderMystHtml } from '../src/myst-render.ts';
import { exportMystDocx, exportMystLatex, exportMystTypst } from '../src/myst-publication-sdk.ts';
import { exportMystJats } from '../src/myst-jats.ts';
import { projectMystPublication } from '../src/myst-publication.ts';

const text = (node: MystNode): string => node.value ?? (node.children ?? []).map(text).join('');
const families = ['proof', 'axiom', 'lemma', 'definition', 'criterion', 'remark', 'conjecture', 'corollary', 'algorithm', 'example', 'property', 'observation', 'proposition', 'assumption', 'theorem'];

test('official proof families and both aliases parse with rich titles and independent counters', () => {
  const source = families.flatMap(kind => ['prf', 'proof'].map((prefix, i) => `:::{${prefix}:${kind}} A **claim**\n:label: ${kind}-${i}\n\nBody with $x$.\n:::`)).join('\n\n');
  const document = parseMystDocument(source);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(exportMystMarkdown(document), source);
  for (const kind of families) for (const i of [0, 1]) {
    assert.equal(document.references[`${kind}-${i}`].label, `${kind[0].toUpperCase()}${kind.slice(1)} ${i + 1}`);
    assert.equal(text({ type: 'root', children: document.references[`${kind}-${i}`].name }), 'A claim');
  }
  const html = renderMystHtml(document).split('<details class="source">')[0];
  assert.match(html, /Theorem 2 \(A <strong>claim<\/strong>\)/);
  assert.doesNotMatch(html, /preview unavailable/);
});

test('proof options preserve explicit enumerators, nonumber precedence, labels and reference templates', () => {
  const document = parseMystDocument(`:::{proof} Argument\n:label: argument\n:nonumber:\n\nProof body.\n:::\n\n:::{prf:theorem} Named\n:label: named\n:nonumber:\n:enumerated: true\n\nUnnumbered body.\n:::\n\n:::{proof:theorem}\n:label: fixed\n:enumerator: A\n\nFixed body.\n:::\n\n:::{proof:theorem}\n:label: next\n\nNext body.\n:::\n\nSee {ref}\`named\` and [Result {number}: {name}](#fixed).`);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(document.references.argument.label, 'Proof (Argument)');
  assert.equal(document.references.named.label, 'Theorem (Named)');
  assert.equal(document.references.fixed.label, 'Theorem A');
  assert.equal(document.references.next.label, 'Theorem 1');
  const html = renderMystHtml(document).split('<details class="source">')[0];
  assert.match(html, /Theorem \(Named\)/);
  assert.match(html, />Named<\/a>/);
  assert.match(html, /Result A: fixed/);
});

test('unsupported proof families remain source and nested executable content stays disabled', () => {
  const source = '::::{proof:lemma}\n:label: outer\n\n:::{code-cell} python\nprint("never run")\n:::\n::::\n\n:::{proof:unknown}\nUnknown family.\n:::';
  const document = parseMystDocument(source);
  assert.equal(document.source, source);
  assert.ok(document.diagnostics.some(d => d.code === 'directive-disabled'));
  assert.ok(document.diagnostics.some(d => /proof:unknown/.test(d.message)));
  assert.equal(document.references.outer.label, 'Lemma 1');
});

test('proof body, title, number and reference remain visible in every scientific publication', async () => {
  const source = ':::{proof:theorem} Named **result**\n:label: result\n\nVisible body with *reasoning* and $x+1$.\n:::\n\nSee {numref}`result`.';
  const document = parseMystDocument(source);
  for (const kind of ['docx', 'latex', 'typst'] as const) {
    const projection = projectMystPublication({ document }, kind);
    assert.match(text(projection.ast), /Theorem 1 \(Named result\)Visible body with reasoning and x\+1/);
    assert.ok(!projection.losses.some(loss => /Unsupported .*proof/.test(loss)));
  }
  const tex = exportMystLatex({ document }).split('% PERO ORIGINAL SOURCE JSON')[0];
  const typst = exportMystTypst({ document }).split('// PERO ORIGINAL SOURCE JSON')[0];
  const jats = exportMystJats(document).match(/<body>([\s\S]*)<\/body>/)![1];
  const archive = await JSZip.loadAsync(await exportMystDocx({ document }));
  const docx = await archive.file('word/document.xml')!.async('string');
  for (const output of [tex, typst, jats, docx]) {
    assert.match(output, /Visible body with/);
    assert.match(output, /reasoning/);
    assert.match(output, /Theorem/);
    assert.match(output, /Named/);
    assert.doesNotMatch(output, /Unsupported .*node: proof/);
  }
  assert.equal(JSON.parse(await archive.file('pero/source.json')!.async('string')).source, source);
  assert.match(jats, /<disp-quote id="[^"]+"><p><bold>Theorem 1 \(Named <bold>result<\/bold>\)<\/bold><\/p>/);
});
