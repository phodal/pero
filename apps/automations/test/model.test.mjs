import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newDraft,editDraft,draftBody,scheduleRule,templates} from '../ui-src/model.ts';
test('supported schedules are explicit and templates never enable execution',()=>{
  const draft=newDraft();assert.equal(draft.enabled,false);assert.equal(scheduleRule(draft),'');
  for(const [schedule,extra,expected] of [
    ['hourly',{interval:2,minute:15},'FREQ=HOURLY;INTERVAL=2;BYMINUTE=15;BYSECOND=0'],
    ['daily',{},'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0'],
    ['weekly',{days:['FR','MO']},'FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=0;BYSECOND=0'],
    ['monthly',{monthDay:31,interval:2},'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=31;BYHOUR=9;BYMINUTE=0;BYSECOND=0'],
  ])assert.equal(scheduleRule({...draft,schedule,...extra}),expected);
  for(const extra of [{schedule:'weekly',days:[]},{schedule:'daily',hour:24},{schedule:'hourly',interval:0},{schedule:'monthly',monthDay:32}])assert.throws(()=>scheduleRule({...draft,...extra}));
  assert.throws(()=>draftBody(draft),/required/);
  for(const template of templates)assert.equal(draftBody({...draft,...template}).enabled,false);
});
test('edits retain exact advanced rules and zones for Host validation',()=>{
  const record={id:'example',name:'Existing',prompt:'Review',enabled:true,rule:'FREQ=YEARLY;BYMONTH=3',timezone:'Asia/Shanghai'};
  const body=draftBody(editDraft(record));assert.equal(body.rule,record.rule);assert.equal(body.timezone,record.timezone);
  assert.deepEqual(Object.keys(body).sort(),['enabled','name','prompt','rule','target','timezone']);
});
test('legacy unavailable schedules remain editable without automatic migration',()=>{
  const record={id:'legacy',name:'Legacy',prompt:'Review',enabled:true,scheduled:false,error:'Re-save this schedule to freeze its IANA time zone',rule:'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',timezone:'Local'};
  const draft=editDraft(record),body=draftBody(draft);
  assert.equal(draft.id,record.id);assert.equal(body.timezone,'Local');assert.equal(body.rule,record.rule);
  assert.equal('error' in body,false);assert.equal('scheduled' in body,false);
  assert.equal(record.error,'Re-save this schedule to freeze its IANA time zone');
});
