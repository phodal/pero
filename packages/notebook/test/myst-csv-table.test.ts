import test from 'node:test';
import assert from 'node:assert/strict';
import { mystParse } from 'myst-parser';
import { compileMystProject } from '../src/myst-project.ts';
import { parseMystProjectSnapshot,exportMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
import { renderMystProjectHtml } from '../src/myst-project-render.ts';
import type { MystNode } from '../src/myst.ts';
const project=(source:string,resources:Record<string,string>={})=>parseMystProjectSnapshot({format:'pero-myst-project',version:1,entry:'pages/main.md',files:[{path:'pages/main.md',text:source},...Object.entries(resources).map(([path,text])=>({path,text}))]});
const table=(node:MystNode):MystNode|undefined=>node.type==='table'?node:node.children?.map(table).find(Boolean);
const text=(node:MystNode):string=>node.value??node.children?.map(text).join('')??'';
const cells=(node:MystNode)=>table(node)?.children?.map(row=>row.children?.map(cell=>({header:!!cell.header,text:text(cell)})));
test('file CSV matches actual official inline quoting, captions and both header sources',()=>{
 const data='"**Name**","Result, value"\r\n"First line\nsecond line","He said ""yes"""\r\n';
 const snapshot=project('```{csv-table} **Measurements**\n:file: ../data/results.csv\n:header: Supplemental, Header\n:header-rows: 1\n:label: results\n```',{'data/results.csv':data});
 const before=exportMystProjectSnapshot(snapshot),result=compileMystProject(snapshot);if(result.entry.kind!=='myst')throw Error('Markdown');
 const expected=mystParse('```{csv-table} **Measurements**\n:header: Supplemental, Header\n:header-rows: 1\n:label: results\n\n'+data+'\n```',{extensions:{smartquotes:false}}) as MystNode;
 assert.deepEqual(cells(result.entry.document.ast),cells(expected));assert.equal(cells(result.entry.document.ast)?.length,3);
 assert.equal(table(result.entry.document.ast)?.provenance?.path,'data/results.csv');assert.equal(result.entry.document.references.results.kind,'table');assert.equal(result.diagnostics.length,0);assert.equal(exportMystProjectSnapshot(snapshot),before);assert.match(renderMystProjectHtml(result),/<strong>Measurements<\/strong>/);
});
test('inline and nested relative CSV resources support official delimiters without I/O',()=>{
 const result=compileMystProject(project('```{csv-table}\n\na,b\n1,2\n```\n```{include} ../parts/fragment.md\n```',{'parts/fragment.md':'```{csv-table} Data\n:file: rows.tsv\n:delim: tab\n:header-rows: 1\n```','parts/rows.tsv':'Name\tValue\nAlpha\t42'}));
 assert.match(renderMystProjectHtml(result),/<th scope="col">Value<\/th>/);assert.match(renderMystProjectHtml(result),/Alpha/);assert.ok(!result.diagnostics.some(d=>d.code==='directive-disabled'||d.code.startsWith('csv-table-')||d.code==='resource-unused'));
});
test('invalid CSV, unsafe/missing resources and unsupported parameters preserve source',()=>{
 for(const [source,resources,code] of [
 ['```{csv-table}\n:file: absent.csv\n```',{},'csv-table-missing'],
 ['```{csv-table}\n:file: https://example.org/a.csv\n```',{},'csv-table-unsupported'],
 ['```{csv-table}\n:file: ../../escape.csv\n```',{},'csv-table-unsupported'],
 ['```{csv-table}\n:file: rows.csv\n:encoding: utf8\n```',{'pages/rows.csv':'a,b'},'csv-table-invalid'],
 ['```{csv-table}\n:file: rows.csv\n\na,b\n```',{'pages/rows.csv':'a,b'},'csv-table-options'],
 ['```{csv-table}\n:file: rows.csv\n```',{'pages/rows.csv':'"unclosed,b'},'csv-table-invalid'],
 ['```{csv-table}\n:file: rows.csv\n:header: One\n```',{'pages/rows.csv':'a,b'},'csv-table-invalid'],
 ['```{csv-table}\n:file: rows.csv\n:header-rows: -1\n```',{'pages/rows.csv':'a,b'},'csv-table-invalid'],
 ['```{csv-table}\n:file: rows.csv\n```',{'pages/rows.csv':'<script>never()</script>,safe'},'csv-table-invalid'],
 ]as const){const result=compileMystProject(project(source,resources));assert.ok(result.diagnostics.some(d=>d.code===code),source);if(result.entry.kind!=='myst')throw Error('Markdown');assert.equal(result.entry.document.source,source);assert.ok(!table(result.entry.document.ast));assert.ok(!renderMystProjectHtml(result).includes('<script>'));}
});
test('CSV row,column,cell,record and repeated expansion budgets remain finite',()=>{
 for(const data of [Array.from({length:1001},()=> 'a').join('\n'),Array.from({length:65},()=> 'x').join(','),Array.from({length:200},()=>Array.from({length:64},()=> 'x').join(',')).join('\n'),'x'.repeat(16385),'x'.repeat(65537)])assert.ok(compileMystProject(project('```{csv-table}\n:file: rows.csv\n```',{'pages/rows.csv':data})).diagnostics.some(d=>d.code==='csv-table-invalid'));
 const many=Array.from({length:65},()=> '```{csv-table}\n:file: rows.csv\n```').join('\n');assert.ok(compileMystProject(project(many,{'pages/rows.csv':'1'})).diagnostics.some(d=>d.code==='csv-table-budget'));
});
