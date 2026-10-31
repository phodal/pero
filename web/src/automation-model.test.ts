import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canReviewOutcome, cancellationLabel, checkInput, checkReconciliation, currentDefinitions, inputPresentation, requestIdentity, requestStatus } from './automation-model.ts';
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

test('operator review is offered only for unresolved executions, never a retry',()=>{
  for(const kind of ['reconcile','cancel_requested'] as const) assert.equal(canReviewOutcome({status:{kind},execution_id:'e'}),true);
  for(const kind of ['running','completed','reconciled'] as const) assert.equal(canReviewOutcome({status:{kind},execution_id:'e'}),false);
  assert.equal(canReviewOutcome({status:{kind:'reconcile'},execution_id:null}),false);
  assert.equal(requestStatus({status:{kind:'reconciled'},operator_reconciliation:{execution_id:'e',disposition:'not_started',evidence:'checked',recorded_at:1,previous_status:{kind:'reconcile'},authority:'local_operator'}}),'Reconciled · operator-reported not started');
});
test('operator evidence has a UTF-8 limit and requires both explicit attestations',()=>{
  assert.doesNotThrow(()=>checkReconciliation('温'.repeat(1365),true,true));
  assert.throws(()=>checkReconciliation('温'.repeat(1366),true,true),/4096/);
  assert.throws(()=>checkReconciliation(' ',true,true),/evidence/);
  assert.throws(()=>checkReconciliation('checked',false,true),/both/);
  assert.throws(()=>checkReconciliation('checked',true,false),/both/);
});
