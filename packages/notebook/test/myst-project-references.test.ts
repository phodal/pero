import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMystProject } from '../src/myst-project.ts';
import { renderMystProjectHtml } from '../src/myst-project-render.ts';
import { mystAnchor } from '../src/myst-project-references.ts';
import { parseMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
const project = (files:Record<string,string>) => compileMystProject(parseMystProjectSnapshot({format:'pero-myst-project',version:1,entry:'main.md',files:Object.entries(files).map(([path,text])=>({path,text}))}));
test('explicit paths and included relative links resolve into one HTML publication',()=>{
 const result=project({'main.md':'See {ref}`result` and [page](Parts/Other.md).\n```{include} Parts/snippet.txt\n```','Parts/Other.md':'(result)=\n# Results','Parts/snippet.txt':'[Nested](Other.md#result)'});
 assert.ok(!result.diagnostics.some(d=>/^reference-/.test(d.code)));
 const html=renderMystProjectHtml(result);
 for(const attribute of ['href','#id']) { const name=attribute.replace('#',''); assert.ok(html.includes(`${name}="${attribute==='href'?'#':''}${mystAnchor('result','Parts/Other.md')}"`)); }
 assert.ok(html.includes(`id="${mystAnchor('','Parts/Other.md')}"`));
 assert.ok(!html.includes('href="Parts/Other.md'));
 const ids=[...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
});
test('ambiguous and missing targets never silently select a destination',()=>{
 const result=project({'main.md':'{ref}`same`, {ref}`Other.md#same` [unsafe](../../escape.md#same) [missing](absent.md)','Other.md':'(same)=\n# One','two.md':'(same)=\n# Two'});
 for(const code of ['reference-ambiguous','reference-unsupported','reference-missing']) assert.ok(result.diagnostics.some(d=>d.code===code),code);
 const html=renderMystProjectHtml(result);assert.ok(html.includes('same [unresolved]'));assert.ok(html.includes(`href="#${mystAnchor('same','Other.md')}"`));
});
test('duplicate local labels suppress duplicate target anchors',()=>{
 const result=project({'main.md':'[Dup](other.md#same)','other.md':'(same)=\n# One\n\n(same)=\n# Two'});
 assert.ok(result.diagnostics.some(d=>d.code==='reference-ambiguous'));
 const html=renderMystProjectHtml(result);assert.ok(!html.includes(`id="${mystAnchor('same','other.md')}"`));
});
test('shorthand and fragment references preserve explicit citation roles',()=>{
 const result=project({'main.md':'@result, [](#result), {doc}`other.md`, {cite}`result`.','other.md':'(result)=\n# Result'});
 const html=renderMystProjectHtml(result);assert.equal(html.split(`href="#${mystAnchor('result','other.md')}"`).length-1,2);
 assert.ok(html.includes('[result: unresolved]'));assert.ok(result.diagnostics.some(d=>d.code==='citation-unresolved'));
});
test('raster assets embed while SVG and remote URLs never become active images',()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
 const result=compileMystProject(parseMystProjectSnapshot({format:'pero-myst-project',version:2,entry:'main.md',files:[{path:'main.md',text:'![pixel](pixel.png)\n![svg](danger.svg)\n![remote](https://example.org/a.png)'}],assets:[{path:'pixel.png',mediaType:'image/png',base64:png},{path:'danger.svg',mediaType:'image/svg+xml',base64:btoa('<svg><script>never()</script></svg>')}]}));
 const html=renderMystProjectHtml(result);assert.ok(html.includes(`src="data:image/png;base64,${png}"`));assert.equal([...html.matchAll(/<img /g)].length,1);assert.ok(!html.includes('data:image/svg+xml'));assert.ok(!html.includes('<script>'));assert.ok(result.diagnostics.some(d=>d.code==='asset-unsupported'));
});
test('namespace encoding preserves distinctions and excludes HTML delimiters',()=>{
 const values=['a:b','a~3a~b','a/b','a?b','a"b','汉字','<script>'];assert.equal(new Set(values.map(v=>mystAnchor(v,'p.md'))).size,values.length);for(const v of values)assert.ok(!/["<>]/.test(mystAnchor(v,v)));
});
