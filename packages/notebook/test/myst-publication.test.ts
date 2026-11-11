import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { parseMystDocument, importMystBundle } from '../src/myst.ts';
import { projectMystPublication, inertPublicationMath } from '../src/myst-publication.ts';
import { exportMystJats } from '../src/myst-jats.ts';
import { exportMystDocx, exportMystLatex, exportMystTypst, exportMystPublicationArchive } from '../src/myst-publication-sdk.ts';
const source = '---\ntitle: Scientific publication\nauthors:\n  - name: Ada Example\ndoi: 10.1234/example\n---\n# Scientific publication\n\nA real formula $x^2$ and equation:\n\n$$\nN = N_0 e^{rt} + \\frac{x^2}{\\sqrt{y}}\n$$\n\n![Figure](figure.png)\n\n| Trial | Result |\n| --- | --- |\n| A | 42 |\n\n- First\n- Second\n\n## Discussion\n\nA **bold** finding.\n';
const assets = [{ path: 'figure.png', mediaType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAIAAABhdOiYAAAAfklEQVR4nO3QQRHAIADAMEDCVKILpVOw65M9EgW9zmefwbd1O+DvDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFB4AX3CAXwOGfvwAAAAAElFTkSuQmCC' }];
const input = { document: parseMystDocument(source), assets };
test('official adapters produce deterministic genuine artifacts and never mutate source', async () => {
  const before = JSON.stringify(input);
  const a = await exportMystDocx(input), b = await exportMystDocx(input);
  assert.deepEqual(a, b);
  const zip = await JSZip.loadAsync(a), xml = await zip.file('word/document.xml')!.async('string');
  for (const tag of ['<w:tbl>', '<w:drawing>', '<m:sSup>', '<m:sSub>', '<m:f>', '<m:rad>']) assert.ok(xml.includes(tag), tag);
  assert.equal(importMystBundle(await zip.file('pero/source.json')!.async('string')).source, source);
  assert.equal(await zip.file('word/media/image1.png')!.async('base64'), assets[0].base64);
  for (const file of Object.values(zip.files)) assert.equal(file.date.toISOString(), '1980-01-01T00:00:00.000Z');
  for (const render of [exportMystLatex, exportMystTypst]) { assert.equal(render(input), render(input)); assert.ok(render(input).includes('42')); }
  assert.equal(JSON.stringify(input), before);
});
test('JATS is parsed XML with metadata, tables, formulas and exact source recovery', () => {
  const xml = exportMystJats(input.document);
  const result = spawnSync('python3', ['-c', 'import sys,xml.etree.ElementTree as E,json; r=E.fromstring(sys.stdin.read()); assert r.find(".//article-title").text=="Scientific publication"; assert r.find(".//tex-math") is not None; assert r.find(".//table") is not None; print(json.loads(r.find(".//custom-meta/meta-value").text)["source"])'], { input: xml, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trimEnd(), source.trimEnd());
});
test('hostile commands remain inert and unsupported native equations report exact loss', async () => {
  for (const value of ['^^5cinput{/etc/passwd}', '^^5Cinput{x}', '^^^^005cinput{x}', '^^\n5cinput{x}', '\\input{x}']) assert.equal(inertPublicationMath(value), false);
  const i = { document: parseMystDocument('$\\overline{x}$\n\n$\\input{/etc/passwd}$\n\n<script>bad()</script>') };
  const zip = await JSZip.loadAsync(await exportMystDocx(i));
  const losses = await zip.file('pero/publication-losses.json')!.async('string');
  assert.ok(losses.includes('unsupported MathML element mover')); assert.ok(losses.includes('unsupported math command'));
  assert.ok(!exportMystJats(i.document).includes('<script>')); assert.ok(!exportMystTypst(i).includes('#include'));
});
test('offline archives carry admitted exact raster bytes, explicit format losses and no remote imports', async () => {
  for (const kind of ['latex', 'typst', 'jats'] as const) {
    const bytes = await exportMystPublicationArchive(input, kind); assert.deepEqual(bytes, await exportMystPublicationArchive(input, kind));
    const zip = await JSZip.loadAsync(bytes);
    assert.equal(await zip.file('assets/image-1.png')!.async('base64'), assets[0].base64);
    assert.equal(importMystBundle(await zip.file('source.json')!.async('string')).source, source);
    const text = await zip.file(`article.${kind === 'latex' ? 'tex' : kind === 'typst' ? 'typ' : 'xml'}`)!.async('string');
    assert.ok(text.includes('assets/image-1.png')); assert.ok(!text.includes('@preview/'));
    if (kind === 'jats') assert.ok((await zip.file('publication-losses.json')!.async('string')).includes('JATS metadata'));
  }
});
test('image amplification is bounded for repeated and distinct assets before serialization', async () => {
  const source = Array.from({length:140}, () => 'Text ![repeat](figure.png)').join('\n\n');
  const i = { document: parseMystDocument(source), assets };
  const count = (n: typeof i.document.ast): number => Number(n.type === 'image') + (n.children ?? []).reduce((sum,c) => sum + count(c),0);
  assert.equal(count(projectMystPublication(i,'docx').ast),128);
  const large = [{...assets[0],base64:Buffer.alloc(256*1024).toString('base64')}];
  assert.equal(count(projectMystPublication({...i,assets:large},'docx').ast),64);
  const docx = await JSZip.loadAsync(await exportMystDocx(i));
  assert.equal((await docx.file('word/document.xml')!.async('string')).match(/<w:drawing>/g)?.length,128);
  const distinct = Array.from({length:140},(_,n)=>({...assets[0],path:`image-${n}.png`}));
  const d = {document:parseMystDocument(distinct.map(a=>`Text ![image](${a.path})`).join('\n\n')),assets:distinct};
  const before = JSON.stringify(d), zip = await JSZip.loadAsync(await exportMystPublicationArchive(d,'jats'));
  assert.equal(JSON.parse(await zip.file('assets.json')!.async('string')).length,128);
  assert.ok((await zip.file('article.xml')!.async('string')).includes('content-type="missing-image"'));
  assert.ok((await zip.file('publication-losses.json')!.async('string')).includes('12 image placement(s) omitted'));
  assert.equal(JSON.stringify(d),before);
});
test('notebook publication preserves required exact raw notebook without inventing MyST source',async()=>{
  const original=' {"nbformat":4,"nbformat_minor":5,"metadata":{},"cells":[]}\r\n';
  const document={ast:input.document.ast,scholarly:input.document.scholarly,references:{},bibliography:{},diagnostics:[],citationRendering:undefined};
  const i={document,recovery:{kind:'ipynb' as const,filename:'notebook.ipynb' as const,source:original},assets};
  const zip=await JSZip.loadAsync(await exportMystDocx(i)); assert.equal(await zip.file('pero/notebook.ipynb')!.async('string'),original);assert.equal(zip.file('pero/source.json'),null);
  for(const kind of ['latex','typst','jats'] as const){const zip=await JSZip.loadAsync(await exportMystPublicationArchive(i,kind));assert.equal(await zip.file('notebook.ipynb')!.async('string'),original);assert.equal(zip.file('source.json'),null);}
});
test('alias-heavy source recovery uses the importer canonical source-only bundle',async()=>{
  const source='---\ntitle: &text '+ 'a'.repeat(240000)+'\nsubtitle: *text\ndescription: *text\nshort_title: *text\nabstract: *text\n---\n';
  const zip=await JSZip.loadAsync(await exportMystDocx({document:parseMystDocument(source)}));
  assert.equal(importMystBundle(await zip.file('pero/source.json')!.async('string')).source,source);
});
