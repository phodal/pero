import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { parseMystDocument, importMystBundle, type MystNode } from '../src/myst.ts';
import { compileMystProject } from '../src/myst-project.ts';
import { parseMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
import { projectMystPublication } from '../src/myst-publication.ts';
import { exportMystJatsResult } from '../src/myst-jats.ts';
import { exportMystDocx, exportMystLatex, exportMystTypst } from '../src/myst-publication-sdk.ts';

const source = '---\nabbreviations:\n  DNA: Deoxyribonucleic acid\n---\nBefore DNA after.\n\n```{glossary}\nApple\n: A fruit.\n\nPear\n: Another fruit.\n```\n\n{abbr}`RNA (Ribonucleic acid)` follows.';
const input = { document: parseMystDocument(source) };
const loss = 'Abbreviation text preserved; tooltip expansions are retained in source, not interactive publication fields.';
const visible = ['Before DNA after.', 'Apple', 'A fruit.', 'Pear', 'Another fruit.', 'RNA follows.'];

test('scientific term projections retain inline text and definition structure without nested paragraphs', () => {
  const before = JSON.stringify(input);
  for (const kind of ['docx', 'latex', 'typst'] as const) {
    const result = projectMystPublication(input, kind);
    const walk = (node: MystNode, parent?: MystNode): void => {
      assert.ok(!(node.type === 'paragraph' && parent?.type === 'paragraph'));
      node.children?.forEach(child => walk(child, node));
    };
    walk(result.ast);
    assert.ok(result.losses.includes(loss));
    assert.ok(!result.losses.some(item => /Unsupported .* (glossary|abbreviation)/.test(item)));
    assert.equal(result.ast.children?.filter(node => node.type === 'definitionList').length, 1);
  }
  assert.equal(JSON.stringify(input), before);
});

test('actual DOCX, TeX, Typst and parsed JATS bodies keep terms rather than unsupported placeholders', async () => {
  const zip = await JSZip.loadAsync(await exportMystDocx(input));
  const docx = await zip.file('word/document.xml')!.async('string');
  const parsed = spawnSync('python3', ['-c', `import sys,xml.etree.ElementTree as E,json
r=E.fromstring(sys.stdin.read()); ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
assert r.find('.//w:p/w:p', ns) is None
print(json.dumps([''.join(p.itertext()) for p in r.findall('.//w:p', ns)]))`], { input: docx, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  const paragraphs = JSON.parse(parsed.stdout) as string[];
  for (const text of visible) assert.ok(paragraphs.some(paragraph => paragraph.trim() === text), `${text} missing from DOCX body`);
  assert.ok((await zip.file('pero/publication-losses.json')!.async('string')).includes(loss));
  assert.equal(importMystBundle(await zip.file('pero/source.json')!.async('string')).source, source);
  for (const [format, output, delimiter] of [
    ['TeX', exportMystLatex(input), '% PERO PUBLICATION LOSSES'],
    ['Typst', exportMystTypst(input), '// PERO PUBLICATION LOSSES'],
  ]) {
    const body = output.split(delimiter)[0];
    for (const text of visible) assert.ok(body.includes(text), `${text} missing from ${format} body`);
    assert.ok(!body.includes('Unsupported'));
    assert.ok(output.includes(loss));
  }
  const jats = exportMystJatsResult(input);
  const body = spawnSync('python3', ['-c', `import sys,xml.etree.ElementTree as E,json
r=E.fromstring(sys.stdin.read()); b=r.find('body')
assert [t.text for t in b.findall('.//def-item/term')]==['Apple','Pear']
assert [t.text for t in b.findall('.//def-item/def/p')]==['A fruit.','Another fruit.']
assert b.find('.//p/p') is None
print(''.join(b.itertext()))
assert json.loads(r.find('.//custom-meta/meta-value').text)['source']==${JSON.stringify(source)}`], { input: jats.xml, encoding: 'utf8' });
  assert.equal(body.status, 0, body.stderr);
  for (const text of visible) assert.ok(body.stdout.includes(text));
  assert.ok(!body.stdout.includes('Unsupported'));
  assert.ok(jats.losses.includes(loss));
});


test('scientific references retain resolved rich wording locally and across pages without resolving ambiguity', () => {
  const definitions = ':::{prf:theorem} My **result**\n:label: thm\n\nBody\n:::\n\n```{glossary}\nApple\n: A fruit.\n```';
  const refs = '{ref}`thm` and {numref}`Result {number}: {name} <thm>` and {term}`custom apple <Apple>`';
  const project = compileMystProject(parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'main.md', files: [
    { path: 'main.md', text: refs }, { path: 'terms.md', text: definitions },
  ] }));
  if (project.entry.kind !== 'myst') throw Error('Expected MyST');
  const text = (node: MystNode): string => node.value ?? (node.children ?? []).map(text).join('');
  for (const document of [parseMystDocument(`${definitions}\n\n${refs}`), project.entry.document]) {
    const before = JSON.stringify(document);
    for (const kind of ['docx', 'latex', 'typst'] as const) {
      const result = projectMystPublication({ document }, kind);
      assert.equal(text(result.ast.children!.at(-1)!), 'My result and Result 1: My result and custom apple');
      assert.equal(result.ast.children!.at(-1)!.children!.filter(node => node.type === 'strong').length, 2);
    }
    assert.match(exportMystJatsResult({ document }).xml, /<p>My <bold>result<\/bold> and Result 1: My <bold>result<\/bold> and custom apple<\/p>/);
    assert.equal(JSON.stringify(document), before);
  }
  const ambiguous = parseMystDocument(`${definitions}\n\n${definitions}\n\n{ref}\`thm\``);
  assert.ok(ambiguous.diagnostics.some(item => item.code === 'reference-duplicate'));
  for (const kind of ['docx', 'latex', 'typst'] as const) assert.equal(text(projectMystPublication({ document: ambiguous }, kind).ast.children!.at(-1)!), '[Unresolved reference: thm]');
  assert.match(exportMystJatsResult({ document: ambiguous }).xml, /<p>\[Unresolved reference: thm\]<\/p>/);
});
