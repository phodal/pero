import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cancellationLabel, checkInput, currentDefinitions, inputPresentation, requestIdentity } from './automation-model.ts';
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

test('exact schedules expose a pinned revision, never a misleading publish action',()=>{
  const time={...definition('Timer',1),trigger:{kind:'time',subject:'sample',exact:{revision:'v1',digest:'digest'},anchor:1,interval_seconds:60,max_lateness_seconds:60}} as AutomationDefinition;
  assert.deepEqual(inputPresentation(time),{editable:false,pinnedRevision:'v1'});
  assert.deepEqual(inputPresentation({...time,input:'recheck_latest'}),{editable:true,pinnedRevision:null});
  assert.deepEqual(inputPresentation(definition('Manual',1)),{editable:true,pinnedRevision:null});
});
test('reconciliation offers a cancellation request, not retry or confirmed stop',()=>{
  assert.equal(cancellationLabel('reconcile'),'Request cancellation');
  assert.equal(cancellationLabel('running'),'Cancel');
  assert.equal(cancellationLabel('completed'),null);
  assert.equal(cancellationLabel('cancelled'),null);
});

test('explicit reprocess retains its source identity without implying a retry',()=>{
  assert.equal(requestIdentity({id:'new',reprocess_of:'original'}),'new · Reprocess of original');
  assert.equal(requestIdentity({id:'original',reprocess_of:null}),'original');
});
