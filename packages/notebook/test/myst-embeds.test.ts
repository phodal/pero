import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseMystDocument, type MystNode } from '../src/myst.ts';
import { compileMystProject } from '../src/myst-project.ts';
import { parseMystProjectSnapshot, exportMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
import { renderMystHtml } from '../src/myst-render.ts';
import { renderMystProjectHtml } from '../src/myst-project-render.ts';
import { mystExportFormats } from '../src/myst-formats.ts';
import { mystProjectExportFormats } from '../src/myst-project-formats.ts';
import { exportMystDocx, exportMystPublicationArchive } from '../src/myst-publication-sdk.ts';
const project = (files: Record<string, string>) => parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'main.md', files: Object.entries(files).map(([path, text]) => ({ path, text })) });
const nodes = (node: MystNode): MystNode[] => [node, ...(node.children ?? []).flatMap(nodes)];
const text = (node: MystNode): string => node.value ?? (node.children ?? []).map(text).join(' ');
const embeds = (node: MystNode): MystNode[] => nodes(node).filter(item => item.embedSource);

test('local block and section embeds retain source, strip copied identities and preserve captions', () => {
  const source = '(note)=\nA **finding**.\n\n```{embed} #note\n```\n\n```{figure} image.png\n:label: original\nOriginal caption.\n```\n\n```{figure} #original\n:label: copy\nNew caption.\n```\n\n(section)=\n## Results\n\nMeasured values.\n\n### Detail\n\nMore detail.\n\n## Next\n\n![](#section)\n';
  const doc = parseMystDocument(source), copied = embeds(doc.ast);
  assert.equal(copied.length, 2); // A figure lifts its embedded content into its own captioned container.
  assert.match(text(copied[0]), /A\s+finding/);
  assert.match(text(copied[1]), /Results.*Measured values.*Detail.*More detail/);
  assert.doesNotMatch(text(copied[1]), /Next/);
  assert.ok(copied.every(copy => nodes(copy).every(node => !node.identifier)));
  const figure = nodes(doc.ast).find(node => node.identifier === 'copy')!;
  assert.match(text(figure), /New caption/); assert.doesNotMatch(text(figure), /Original caption/);
  assert.equal(nodes(figure).filter(node => node.type === 'caption').length, 1);
  const html = renderMystHtml(doc);
  assert.equal((html.match(/id="myst-note"/g) ?? []).length, 1);
  assert.match(html, /<figcaption><p>New caption\.<\/p><\/figcaption>/);
  assert.equal(doc.source, source);
  assert.ok(!doc.diagnostics.some(d => d.code === 'directive-disabled' || d.code.startsWith('embed-')));
});

test('provided cross-page targets retain nested asset origin and reference destinations', async () => {
  const snapshot = project({ 'main.md': '```{embed} parts/figure.md#group\n```', 'parts/figure.md': '(group)=\n```{note}\n![Local](../image.png)\n\nSee {ref}`other.md#detail`.\n```', 'parts/other.md': '(detail)=\n# Detail' });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAATklEQVR4nO3PUQkAIBTAwBfHdOY0liH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjx2AdM/8JeZhLHoAAAAAElFTkSuQmCC';
  const supplied = parseMystProjectSnapshot({ ...JSON.parse(exportMystProjectSnapshot(snapshot)), version: 2, assets: [{ path: 'image.png', mediaType: 'image/png', base64: png }] });
  const before = exportMystProjectSnapshot(supplied), result = compileMystProject(supplied);
  assert.equal(result.entry.kind, 'myst'); if (result.entry.kind !== 'myst') return;
  const copy = embeds(result.entry.document.ast)[0];
  assert.deepEqual(copy.embedSource, { path: 'parts/figure.md', identifier: 'group' });
  const image = nodes(copy).find(node => node.type === 'image')!;
  assert.equal(image.provenance?.path, 'parts/figure.md'); assert.equal(image.url, 'image.png'); assert.equal(image.imageData?.base64, png);
  const ref = nodes(copy).find(node => node.type === 'crossReference')!;
  assert.equal(ref.projectTarget?.path, 'parts/other.md');
  assert.ok(!result.diagnostics.some(d => d.code.startsWith('embed-') || d.code === 'resource-missing'));
  assert.match(renderMystProjectHtml(result), /src="data:image\/png;base64,/);
  const format = mystProjectExportFormats.find(f => f.id === 'html')!;
  assert.equal(await format.serialize({ snapshot: before, projection: result }), renderMystProjectHtml(result));
  assert.match(await format.serialize({ snapshot: before }), /<aside><img src="data:image\/png;base64,/);
  const zip = await JSZip.loadAsync(await exportMystDocx({ document: result.entry.document, assets: supplied.assets }));
  assert.match(await zip.file('word/document.xml')!.async('string'), /<w:drawing>/);
  assert.equal(exportMystProjectSnapshot(supplied), before);
});

test('missing, ambiguous, cyclic, unsupported and inline embeds remain visible without discovery', () => {
  const snapshot = project({ 'main.md': '```{embed} #duplicate\n```\n\n![](#missing)\n\n```{embed} ../../escape.md#target\n```\n\n```{embed} https://example.invalid/file.md#target\n```\n\n```{embed} #a\n```\n\n```{embed} #unique\n:unknown: yes\n```\n\nPrefix ![](#unique) suffix.\n\n(unique)=\nUnique.', 'one.md': '(duplicate)=\nOne\n\n(a)=\n```{embed} #b\n```', 'two.md': '(duplicate)=\nTwo\n\n(b)=\n```{embed} #a\n```' });
  const compiled = compileMystProject(snapshot);
  for (const code of ['embed-ambiguous', 'embed-missing', 'embed-unsupported', 'embed-cycle', 'embed-options', 'embed-inline-unsupported']) assert.ok(compiled.diagnostics.some(d => d.code === code), code);
  if (compiled.entry.kind !== 'myst') throw Error('Expected Markdown');
  const html = renderMystHtml(compiled.entry.document);
  for (const source of ['#duplicate', '#missing', '../../escape.md#target', ':unknown: yes', 'Prefix', 'suffix.']) assert.ok(html.includes(source), source);
  assert.doesNotMatch(html, /<img[^>]+src="https/);
});

test('repeated and recursive embeds use existing expansion count, byte and depth limits', () => {
  const many = '(item)=\nItem.\n\n' + Array.from({ length: 130 }, () => '```{embed} #item\n```').join('\n\n');
  assert.ok(parseMystDocument(many).diagnostics.some(d => d.code === 'embed-budget'));
  const large = project({ 'main.md': Array.from({ length: 8 }, () => '![](large.md#item)').join('\n\n'), 'large.md': '(item)=\n' + 'x'.repeat(200000) });
  assert.ok(compileMystProject(large).diagnostics.some(d => d.code === 'embed-budget'));
  const chain = Array.from({ length: 15 }, (_, i) => `(item${i})=\n\`\`\`{embed} #item${i + 1}\n\`\`\``).join('\n\n') + '\n\n(item15)=\nEnd.';
  assert.ok(parseMystDocument(chain).diagnostics.some(d => d.code === 'embed-depth'));
});

test('actual source codecs and scientific archives include copied content and exact recovery', async () => {
  const source = '(data)=\n| Sample | Value |\n| --- | --- |\n| A | 42 |\n\n```{embed} #data\n```';
  const doc = parseMystDocument(source), html = mystExportFormats.find(f => f.id === 'html')!.serialize({ source });
  assert.equal((String(html).match(/<table/g) ?? []).length, 2);
  const word = await JSZip.loadAsync(await exportMystDocx({ document: doc }));
  assert.equal((await word.file('word/document.xml')!.async('string')).match(/<w:tbl>/g)?.length, 2);
  assert.equal(JSON.parse(await word.file('pero/source.json')!.async('string')).source, source);
  for (const kind of ['latex', 'typst', 'jats'] as const) {
    const archive = await JSZip.loadAsync(await exportMystPublicationArchive({ document: doc }, kind));
    const body = await archive.file(`article.${kind === 'latex' ? 'tex' : kind === 'typst' ? 'typ' : 'xml'}`)!.async('string');
    assert.ok((body.match(/42/g) ?? []).length >= 2, kind);
    assert.equal(JSON.parse(await archive.file('source.json')!.async('string')).source, source);
  }
});

test('proof blocks accept local embeds while retaining shared expansion limits', () => {
  const source = '(evidence)=\nRecorded evidence.\n\n::::{prf:proof} Argument\n\n```{embed} #evidence\n```\n\n::::';
  const document = parseMystDocument(source);
  const proof = nodes(document.ast).find(node => node.type === 'proof');
  assert.ok(proof);
  assert.equal(embeds(proof).length, 1);
  assert.match(text(proof), /Recorded evidence/);
  assert.ok(!document.diagnostics.some(item => item.code.startsWith('embed-')));
  assert.equal(nodes(proof).filter(node => node.identifier === 'evidence').length, 0);
  const repeated = '(evidence)=\nRecorded evidence.\n\n::::{prf:proof} Argument\n\n' + Array.from({ length: 140 }, () => '```{embed} #evidence\n```').join('\n\n') + '\n\n::::';
  const bounded = parseMystDocument(repeated);
  assert.ok(bounded.diagnostics.some(item => item.code === 'embed-budget'));
  assert.equal(bounded.source, repeated);
});
