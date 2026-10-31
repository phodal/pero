import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkInput, currentDefinitions } from './automation-model.ts';
import type { AutomationDefinition, AutomationState } from '../../protocol/generated/host';
const definition = (id:string, revision:number):AutomationDefinition => ({ id, revision, owner:'host', trigger:{kind:'manual'}, input:'process_exact', input_binding_id:'local', method:{kind:'agent',agent_id:'fixture',workspace:'/workspace',prompt:'Inspect'},target:{kind:'local_host',owner:'host'} });
test('definition projection retains highest immutable revision per identity',()=>{
  const a=definition('A',1), newer=definition('A',3), stale=definition('A',2), b=definition('B',1);
  const state={definitions:[a,newer,b,stale]} as AutomationState;
  assert.deepEqual(currentDefinitions(state),[newer,b]);
  assert.equal(state.definitions.length,4);
});
test('input limit measures actual UTF-8 bytes before IPC submission',()=>{
  assert.doesNotThrow(()=>checkInput('温度',6));
  assert.throws(()=>checkInput('温度',5),/exceeds/);
  assert.throws(()=>checkInput(' \n ',6),/Enter/);
});
