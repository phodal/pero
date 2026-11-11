import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMystInclude } from '../src/myst-includes.ts';
import { parseMystProjectSnapshot, exportMystProjectSnapshot } from '../src/myst-project-snapshot.ts';
import { compileMystProject } from '../src/myst-project.ts';
import { renderMystHtml } from '../src/myst-render.ts';
const project = (files: Record<string, string>) => parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: 'main.md', files: Object.entries(files).map(([path, text]) => ({ path, text })) });
test('include selection follows pinned inclusive line and whole-marker semantics', () => {
  const source = 'zero\none\ntwo\nthree\nfour';
  for (const [options, expected] of [[{},source],[{'start-line':'1','end-line':'2'},'one\ntwo'],[{'start-line':'-2'},'three\nfour'],[{lines:'1,3-4,5-'},'zero\ntwo\nthree\nfour'],[{'start-at':'one','end-at':'three'},'one\ntwo\nthree'],[{'start-after':'one','end-before':'four'},'two\nthree']] as const) assert.equal(selectMystInclude(source, options).text, expected);
  for (const options of [{lines:'0'},{lines:'4-2'},{'start-after':'absent'},{encoding:'latin1'},{'start-line':'1',lines:'2'},{literal:'false'}]) assert.throws(() => selectMystInclude(source, options));
});
test('nested relative include and literalinclude preserve exact source and provenance', () => {
  const snapshot = project({'main.md':'```{include} parts/one.md\n```','parts/one.md':'Text **included**.\n```{literalinclude} ../code.py\n:lines: 2-3\n```','code.py':'ignored\nprint("<script>")\n# trailing\n'});
  const before = exportMystProjectSnapshot(snapshot), result = compileMystProject(snapshot);
  assert.match(renderMystHtml(result.entry), /Text <strong>included<\/strong>/);
  assert.match(renderMystHtml(result.entry), /&lt;script&gt;/);
  assert.match(JSON.stringify(result.entry.ast), /"path":"code.py"/);
  assert.equal(exportMystProjectSnapshot(snapshot), before);
});
test('cycles, missing resources, root escapes and unsupported options retain directives', () => {
  const result = compileMystProject(project({'main.md':'```{include} other.txt\n```\n```{include} ../../escape.md\n```\n```{include} absent.md\n```\n```{literalinclude} other.txt\n:encoding: utf8\n```','other.txt':'```{include} main.md\n```'}));
  for (const code of ['include-cycle','include-unsupported','include-missing','include-options']) assert.ok(result.diagnostics.some(d => d.code === code),code);
  assert.match(renderMystHtml(result.entry), /:encoding: utf8/);
});
test('repeated expansion, selected text and recursion are bounded', () => {
  const many = project({'main.md':Array.from({length:130},()=> '```{include} part.txt\n```').join('\n'),'part.txt':'x'});
  assert.ok(compileMystProject(many).diagnostics.some(d=>d.code==='include-budget'));
  const large = project({'main.md':Array.from({length:6},()=> '```{include} part.txt\n```').join('\n'),'part.txt':'x'.repeat(256*1024)});
  assert.ok(compileMystProject(large).diagnostics.some(d=>d.code==='include-budget'));
  assert.throws(()=>selectMystInclude('x'.repeat(256*1024),{lines:'1,1,1,1,1'}),/1 MiB/);
  const files:Record<string,string>={'main.md':'```{include} p0.txt\n```'};
  for(let i=0;i<15;i++) files[`p${i}.txt`]=`\`\`\`{include} p${i+1}.txt\n\`\`\``;
  assert.ok(compileMystProject(project(files)).diagnostics.some(d=>d.code==='include-depth'));
});
test('unsupported directive bodies and parsed notebook includes remain visible', () => {
  const result=compileMystProject(project({'main.md':'```{include} text.txt\nBody\n```\n```{include} file.ipynb\n```','text.txt':'Text','file.ipynb':'{}'}));
  for(const code of ['include-body-unsupported','include-format-unsupported']) assert.ok(result.diagnostics.some(d=>d.code===code));
  assert.match(renderMystHtml(result.entry),/Body/);
});
