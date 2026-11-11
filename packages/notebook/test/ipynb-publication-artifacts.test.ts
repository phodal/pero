import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { notebookPublicationFixture } from './fixtures/ipynb-publication.ts';
import { exportMystDocx, exportMystLatex, exportMystTypst, exportMystPublicationArchive } from '../src/myst-publication-sdk.ts';
import { exportMystJatsResult } from '../src/myst-jats.ts';
test('actual DOCX embeds exact notebook and inert recorded body, never fake MyST recovery',async()=>{
 const {source,input}=notebookPublicationFixture();const zip=await JSZip.loadAsync(await exportMystDocx(input));
 assert.equal(await zip.file('pero/notebook.ipynb')!.async('string'),source);assert.equal(zip.file('pero/source.json'),null);
 const body=await zip.file('word/document.xml')!.async('string');assert.match(body,/Stale recorded outputs/);assert.match(body,/drawing/);assert.doesNotMatch(body,/REMOVED_BODY_SECRET/);
 const media=Object.keys(zip.files).filter(p=>p.startsWith('word/media/')&&!zip.files[p].dir);assert.ok(media.length);
 assert.ok((await Promise.all(media.map(p=>zip.file(p)!.async('base64')))).includes(input.assets![0].base64));
 assert.match(await zip.file('pero/publication-losses.json')!.async('string'),/text\/html/);
});
test('actual TeX Typst JATS archives preserve original notebook and deduplicate repeated raster placements',async()=>{
 const {source,input}=notebookPublicationFixture();
 for(const kind of ['latex','typst','jats'] as const){const zip=await JSZip.loadAsync(await exportMystPublicationArchive(input,kind));
 assert.equal(await zip.file('notebook.ipynb')!.async('string'),source);assert.equal(zip.file('source.json'),null);
 const assets=JSON.parse(await zip.file('assets.json')!.async('string'));assert.equal(assets.length,1);assert.equal(await zip.file(assets[0].path)!.async('base64'),input.assets![0].base64);
 const article=await zip.file(`article.${kind==='latex'?'tex':kind==='typst'?'typ':'xml'}`)!.async('string');assert.match(article,/assets\/image-1.png/);
 if(kind==='jats'){const body=article.split('<body>')[1].split('</body>')[0];assert.doesNotMatch(body,/REMOVED_BODY_SECRET/);assert.equal((body.match(/<graphic /g)??[]).length,3);}
 }
});
test('text and XML recovery records explicitly identify exact IPYNB source',()=>{
 const {source,input}=notebookPublicationFixture();
 const tex=exportMystLatex(input);const record=tex.split('% PERO ORIGINAL SOURCE JSON\n')[1].split('\n').map(l=>l.replace(/^% ?/,'')).join('\n').trim();
 assert.deepEqual(JSON.parse(record),{format:'ipynb',source});
 const typst=exportMystTypst(input);assert.deepEqual(JSON.parse(typst.split('// PERO ORIGINAL SOURCE JSON ')[1]),{format:'ipynb',source});
 const xml=exportMystJatsResult(input).xml;assert.match(xml,/&quot;format&quot;: &quot;ipynb&quot;/);assert.doesNotMatch(xml,/pero-myst/);
});
