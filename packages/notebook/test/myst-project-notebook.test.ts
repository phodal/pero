import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMystProjectHtml } from '../src/myst-project-render.ts';
import { mystAnchor } from '../src/myst-project-references.ts';
import { compileMystProject } from '../src/myst-project.ts';
import { parseMystProjectSnapshot, exportMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
const notebook=(cells: unknown[],metadata:Record<string,unknown>={})=>JSON.stringify({nbformat:4,nbformat_minor:5,metadata,cells});
const markdown=(id:string,source:string)=>({cell_type:'markdown',id,metadata:{},source});
const project=(source:string)=>parseMystProjectSnapshot({format:'pero-myst-project',version:1,entry:'experiment.ipynb',files:[{path:'experiment.ipynb',text:source},{path:'intro.md',text:'(intro)=\n# Introduction\nSee {ref}`experiment.ipynb#experiment`.'},{path:'myst.yml',text:'version: 1\nproject:\n  authors:\n    - name: Project Author\n  bibliography: refs.bib'},{path:'refs.bib',text:'@article{Study,title={Shared citation}}'}]});
test('typed notebook entry retains outputs and gives cells shared metadata, bibliography and crossdoc references',()=>{
 const source=notebook([markdown('first','---\ntitle: First-cell title\nauthors:\n  - name: First-cell Author\n---\n(experiment)=\n# Experiment\n@Study and {ref}`discussion`.'),{cell_type:'code',id:'code',metadata:{},source:'raise Exception("never executed")',execution_count:2,outputs:[{output_type:'stream',name:'stdout',text:'Recorded 42'}]},markdown('last','(discussion)=\n# Discussion\nSee {ref}`intro`.')],{title:'Notebook title',author:'Notebook Author',doi:'10.1234/test'});
 const snapshot=project(source),before=exportMystProjectSnapshot(snapshot),result=compileMystProject(snapshot);
 assert.equal(result.entry.kind,'ipynb');if(result.entry.kind!=='ipynb')throw Error('Notebook');
 assert.equal(result.entry.document.source,source);assert.equal(result.entry.document.cells[1].outputs[0].text,'Recorded 42');
 assert.equal(result.entry.scholarly.title,'First-cell title');assert.equal(result.entry.scholarly.authors?.[0].name,'First-cell Author');assert.equal(result.entry.scholarly.doi,'10.1234/test');
 assert.equal(result.entry.markdownCells[1].document.scholarly.title,'First-cell title');
 assert.equal(result.entry.markdownCells[0].bibliography[0].csl.title,'Shared citation');
 assert.ok(!result.diagnostics.some(d=>d.code.startsWith('reference-')||d.code==='citation-unresolved'));
 const html=renderMystProjectHtml(result);assert.ok(html.includes('Recorded 42'));assert.ok(html.includes(`href="#${mystAnchor('discussion','experiment.ipynb:cell-2')}"`));assert.ok(html.includes(`id="${mystAnchor('discussion','experiment.ipynb:cell-2')}"`));assert.equal(html.split('aria-label="Authors"').length-1,2,'one notebook header and one Markdown page header');
 assert.equal(exportMystProjectSnapshot(snapshot),before);
});
test('only literal cell zero supplies YAML metadata; unknown notebook metadata stays raw',()=>{
 const source=notebook([{cell_type:'code',id:'first',metadata:{},source:'0',execution_count:null,outputs:[]},markdown('second','---\ntitle: Not frontmatter\n---\nText')],{title:'Notebook title',myst:{title:'Nonstandard'},custom:{retained:true}});
 const result=compileMystProject(project(source));if(result.entry.kind!=='ipynb')throw Error('Notebook');
 assert.equal(result.entry.scholarly.title,'Notebook title');assert.equal(result.entry.scholarly.authors?.[0].name,'Project Author');
 assert.equal(result.entry.markdownCells[0].document.metadata.title,'Notebook title');
 assert.ok(JSON.stringify(result.entry.markdownCells[0].document.ast).includes('Not frontmatter'));
 assert.ok(result.diagnostics.some(d=>d.code==='notebook-metadata-inert'));
});
test('malformed notebook remains a typed invalid source instead of flattening to Markdown',()=>{
 const result=compileMystProject(project('{broken'));assert.equal(result.entry.kind,'invalid');assert.ok(result.diagnostics.some(d=>d.code==='notebook-invalid'));
});
test('notebook and first-cell bibliographies combine once and remain available in later cells',()=>{
 const source=notebook([markdown('first','---\nbibliography: [first.bib, shared.bib]\n---\n@First'),markdown('next','@Notebook @Shared')],{bibliography:['notebook.bib','shared.bib']});
 const wire=JSON.parse(exportMystProjectSnapshot(project(source)));
 wire.files.push({path:'first.bib',text:'@article{First,title={First record}}'},{path:'notebook.bib',text:'@article{Notebook,title={Notebook record}}'},{path:'shared.bib',text:'@article{Shared,title={Shared record}}'});
 const result=compileMystProject(parseMystProjectSnapshot(wire));if(result.entry.kind!=='ipynb')throw Error('Notebook');
 for(const cell of result.entry.markdownCells){assert.ok(cell.document.bibliography.first);assert.ok(cell.document.bibliography.notebook);assert.ok(cell.document.bibliography.shared);assert.equal(cell.bibliography.filter(record=>record.path==='shared.bib').length,1);}
 assert.ok(!result.diagnostics.some(d=>d.code==='citation-unresolved'||d.code==='citation-duplicate'));
});
