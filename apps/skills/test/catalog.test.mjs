import test from 'node:test';
import assert from 'node:assert/strict';
import { findSkills } from '../ui-src/catalog.mjs';

const skills = [
  { id: 'a', name: 'paper-read', title_zh: '论文阅读', description: 'Read and cite papers', description_zh: '提取原文证据', category: 'literature', category_zh: '文献', kind: 'research_skill', source: {repository: 'lab/papers'} },
  { id: 'b', name: 'statistics', title_zh: '统计检验', description: 'Bayesian statistics', category: 'statistics', category_zh: '统计', kind: 'research_skill', source: {repository: 'lab/stats'} },
  { id: 'c', name: 'shared', title_zh: '共享依赖', category: 'literature', category_zh: '文献', kind: 'internal_dependency', source: {repository: 'lab/papers'} },
];

test('a researcher finds a task across Chinese, original descriptions and source names', () => {
  for (const [query, expected] of [['论文', ['a']], ['BAYESIAN', ['b']], ['lab/papers', ['a', 'c']], ['原文 证据', ['a']]])
    assert.deepEqual(findSkills(skills, { query }).items.map(item => item.id), expected);
  const writing={...skills[0],id:'K-Dense-AI/scientific-agent-skills/skills/scientific-writing/SKILL.md',name:'scientific-writing',title_zh:'scientific-writing',source:{repository:'K-Dense-AI/scientific-agent-skills',commit:'a25cf9ec00e2745d03f8704acf6f6919694ccd9a'}};
  assert.equal(findSkills([writing],{query:'科学论文写作'}).total,1);
  assert.equal(findSkills([{...writing,source:{...writing.source,commit:'older'}}],{query:'科学论文写作'}).total,0);
});

test('installed view, category and search compose without dropping disabled installations', () => {
  const installed = [{id:'a',enabled:false},{id:'b',enabled:true}];
  assert.deepEqual(findSkills(skills, {view:'installed', installed, category:'literature'}).items.map(item => item.id), ['a']);
  assert.deepEqual(findSkills(skills, {view:'installed', installed, query:'no-match'}).items, []);
});

test('bounded pages retain all matches and clamp page after filtering', () => {
  const data = Array.from({length:95}, (_, i) => ({...skills[0],id:String(i)}));
  const first = findSkills(data, {page:0}), third = findSkills(data, {page:7}), last = findSkills(data, {page:99});
  assert.equal(first.items.length,12); assert.equal(third.items.length,11);
  assert.equal(first.total,95); assert.equal(last.page,7); assert.equal(last.pages,8);
  assert.equal(new Set(Array.from({length:8},(_,page)=>findSkills(data,{page}).items).flat().map(item=>item.id)).size,95);
  assert.equal(findSkills([], {page:4}).page,0);
});

test('discovery orders skill names across categories instead of inheriting collection order', () => {
  const data = [
    {...skills[1], id:'z', name:'Workflow 10', category:'ai'},
    {...skills[0], id:'b', name:'Workflow 2', category:'literature'},
    {...skills[1], id:'a', name:'Workflow 2', category:'statistics'},
  ];
  assert.deepEqual(findSkills(data).items.map(item => item.id), ['a','b','z']);
  assert.deepEqual(data.map(item => item.id), ['z','b','a']);
});

// The researcher can narrow discovery to actionable entries without hiding installed disabled ones.
test('installation filter and task ordering compose with discovery', () => {
  const ready={...skills[0],installation:{allowed:true,reason:''},name:'scientific-writing',license:{spdx:'MIT',status:'declared_in_skill',evidence_url:'https://example.org/LICENSE'},source:{repository:'lab/papers',path:'SKILL.md'}};
  const id='K-Dense-AI/scientific-agent-skills/skills/scientific-writing/SKILL.md';
  const data=[{...ready,id:'blocked',name:'a',installation:{allowed:false,reason:'License not reviewed'},license:{...ready.license,status:'repository_only'}},{...ready,id}];
  assert.deepEqual(findSkills(data,{onlyReady:true}).items.map(item=>item.id),[id]);
  assert.deepEqual(findSkills(data,{sort:'flow'}).items.map(item=>item.id),[id,'blocked']);
  assert.deepEqual(findSkills(data,{sort:'name'}).items.map(item=>item.id),['blocked',id]);
});


test('scope composes with disabled installed records and shared document identities', () => {
  const data = [...skills, {...skills[0], id:'general', kind:'general_skill'}, {...skills[0], id:'document', discovery_scopes:['general','research']}];
  assert.deepEqual(findSkills(data,{scope:'general'}).items.map(item=>item.id), ['document','general']);
  assert.equal(findSkills(data,{scope:'research'}).total,4);
  assert.deepEqual(findSkills(data,{scope:'general',view:'installed',installed:[{id:'general',enabled:false}]}).items.map(item=>item.id), ['general']);
  assert.equal(findSkills(data,{scope:'general',onlyReady:true}).total,0,'Missing Host admission is unknown, not ready');
});
