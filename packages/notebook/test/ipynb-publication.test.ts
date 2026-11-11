import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMystProject } from '../src/myst-project.ts';
import { parseMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
import { compiledMystEntryPublication } from '../src/ipynb-publication.ts';
import { png, notebookPublicationFixture } from './fixtures/ipynb-publication.ts';
test('compiled notebook publication preserves exact recovery, repeated placements and one admitted image asset',()=>{
 const {source,entry,input}=notebookPublicationFixture();assert.equal(input.recovery?.source,source);
 assert.equal(input.recovery?.kind,'ipynb');assert.equal('source' in input.document,false);assert.equal('metadata' in input.document,false);
 assert.equal(input.assets?.length,1);assert.equal(input.assets?.[0].base64,png);
 const images: string[]=[];const visit=(node:any)=>{if(node.type==='image')images.push(node.url);node.children?.forEach(visit)};visit(input.document.ast);
 assert.equal(images.length,3);assert.equal(new Set(images).size,1);
 assert.match(JSON.stringify(input.document.ast),/Stale recorded outputs/);assert.doesNotMatch(JSON.stringify(input.document.ast),/REMOVED_BODY_SECRET/);
 assert.ok(input.document.diagnostics.some(d=>d.message.includes('text/html')));assert.ok(input.document.diagnostics.some(d=>d.message.includes('remove-cell')));
 if(entry.kind!=='ipynb')throw Error('entry');assert.equal(entry.document.source,source);assert.equal(entry.document.cells[0].images[0].image.base64,png);
});
test('Markdown identity is unchanged and invalid notebook cannot become synthetic prose',()=>{
 const snapshot=parseMystProjectSnapshot({format:'pero-myst-project',version:1,entry:'a.md',files:[{path:'a.md',text:'# Test'}]});const entry=compileMystProject(snapshot).entry;
 if(entry.kind!=='myst')throw Error('entry');assert.equal(compiledMystEntryPublication(entry).document,entry.document);
 assert.throws(()=>compiledMystEntryPublication({kind:'invalid',path:'bad.ipynb',source:'broken',diagnostics:[]}),/Invalid notebook/);
});
