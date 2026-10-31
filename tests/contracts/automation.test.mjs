// Public client contract deliberately cannot forge execution-owner observations.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with {type:'json'};
const ajv=new Ajv2020({strict:true,strictTypes:false});
ajv.addSchema(schema);
const valid=ajv.getSchema(`${schema.$id}#/$defs/AutomationRequest`);
const envelope=command=>({method:'automation',id:'request-1',command});
test('public Automation commands expose trusted input operations, not execution receipts',()=>{
  assert.equal(valid(envelope({action:'query'})),true);
  assert.equal(valid(envelope({action:'manual_input',definition_id:'inspect',intent_id:'intent',subject:'sample',content:'frozen input'})),true);
  assert.equal(valid(envelope({action:'publish_input',binding_id:'local',subject:'sample',revision:'r1',content:'bytes',latest:true})),true);
  for(const command of [{action:'observe',request_id:'r',execution_id:'e',outcome:'completed'},{action:'reserve',request_id:'r',execution_id:'e'},{action:'pump',execution_id:'e'},{action:'recover'},{action:'time',definition_id:'a',slot:1,subject:'sample',exact:null}])
    assert.equal(valid(envelope(command)),false);
  assert.equal(valid(envelope({action:'accept',event:{binding_id:'local',producer_id:'1',event_kind:'changed',subject:'sample',exact:null,digest:'forged'}})),false);
});
test('schedule carries fixed subject, input reference and explicit catch-up window',()=>{
  const command={action:'create_local',id:'daily',input:'process_exact',agent_id:'fixture',prompt:'Inspect',trigger:{kind:'time',subject:'sample',exact:{revision:'r1',digest:'a'.repeat(64)},anchor:1800000000,interval_seconds:3600,max_lateness_seconds:60}};
  assert.equal(valid(envelope(command)),true);
  const {exact,...trigger}=command.trigger;
  assert.equal(valid(envelope({...command,trigger})),false);
  assert.equal(valid(envelope({...command,trigger:{...command.trigger,interval_seconds:-1}})),false);
});

test('operator reconciliation binds an execution and requires explicit attestations',()=>{
  const command={action:'reconcile',request_id:'r',expected_execution_id:'e',disposition:'failed',evidence:'Inspected process and outputs',execution_stopped:true,effects_checked:true};
  assert.equal(valid(envelope(command)),true);
  for(const edit of [{execution_stopped:false},{effects_checked:false},{expected_execution_id:undefined},{evidence:''},{disposition:'verified'},{outcome:'completed'}]) assert.equal(valid(envelope({...command,...edit})),false);
});
