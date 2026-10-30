import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AppDocuments} from './app-document.ts';
test('panel sources retain revisions, isolate identities and reject authority spoofing',()=> {
  const docs=new AppDocuments('data','main');
  const input={id:'result',title:'Complete result',text:'[{"n":9007199254740993}]',format:{kind:'json'}};
  const first=docs.admit(input);
  assert.equal(first.text,input.text);
  assert.equal(docs.admit({...input,title:'Renamed'}).header.revision,first.header.revision);
  assert.equal(docs.admit({...input,text:'[]'}).header.revision,2);
  assert.notEqual(new AppDocuments('other','main').admit(input).header.source.id,first.header.source.id);
  assert.deepEqual(first.header.source.origin,{kind:'app',app:'data',panel:'main'});
  for(const value of [{...input,origin:{kind:'file',path:'/secret'}},{...input,revision:10},{...input,format:{kind:'html'}},{...input,format:{kind:'text',language:'rust'}}])assert.throws(()=>docs.admit(value));
});
