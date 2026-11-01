export type Run = {key:{request_id?:string;slot:string;trigger:string};scheduled_for:string;state:string;session_id?:string;error?:string;skip_reason?:string};
export type Automation = {id:string;name:string;prompt:string;enabled:boolean;rule:string;timezone:string;next?:string;in_flight?:string;scheduled:boolean;error?:string;event?:{event:string};runs:Run[]};
export type Schedule = 'manual'|'hourly'|'daily'|'weekly'|'monthly'|'custom';
export type Draft = {id?:string;name:string;prompt:string;schedule:Schedule;hour:number;minute:number;monthDay:number;interval:number;days:string[];timezone:string;rule:string;enabled:boolean};
export const weekdays = ['MO','TU','WE','TH','FR','SA','SU'];
export const templates = [
  {name:'Daily research brief',prompt:'Review research material in this workspace. Summarize changes and cite the files used. Do not modify files.',schedule:'daily' as const},
  {name:'Weekly project review',prompt:'Review this workspace and summarize progress, open questions and suggested next steps. Do not modify files.',schedule:'weekly' as const},
  {name:'Check experiment results',prompt:'Inspect available experiment outputs. Report missing evidence and failed checks; do not equate execution success with scientific validity.',schedule:'manual' as const},
];
export function newDraft():Draft {return {name:'',prompt:'',schedule:'manual',hour:9,minute:0,monthDay:1,interval:1,days:['MO'],timezone:'Local',rule:'',enabled:false};}
export function editDraft(record:Automation):Draft {return {...newDraft(),id:record.id,name:record.name,prompt:record.prompt,timezone:record.timezone,enabled:record.enabled,rule:record.rule,schedule:record.rule?'custom':'manual'};}
export function scheduleRule(draft:Draft):string {
  if(draft.schedule==='manual')return '';
  if(draft.schedule==='custom')return draft.rule.trim();
  if(!Number.isInteger(draft.minute)||draft.minute<0||draft.minute>59)throw new Error('Minute must be 0–59');
  if(!Number.isInteger(draft.interval)||draft.interval<1||draft.interval>366)throw new Error('Interval must be 1–366');
  if(draft.schedule==='hourly')return `FREQ=HOURLY;INTERVAL=${draft.interval};BYMINUTE=${draft.minute};BYSECOND=0`;
  if(!Number.isInteger(draft.hour)||draft.hour<0||draft.hour>23)throw new Error('Hour must be 0–23');
  if(draft.schedule==='monthly'&&(!Number.isInteger(draft.monthDay)||draft.monthDay<1||draft.monthDay>31))throw new Error('Day of month must be 1–31');
  if(draft.schedule==='weekly'&&(!draft.days.length||draft.days.some(day=>!weekdays.includes(day))))throw new Error('Select at least one weekday');
  return `FREQ=${draft.schedule.toUpperCase()}${draft.interval>1?`;INTERVAL=${draft.interval}`:''}${draft.schedule==='monthly'?`;BYMONTHDAY=${draft.monthDay}`:''}${draft.schedule==='weekly'?`;BYDAY=${weekdays.filter(day=>draft.days.includes(day)).join(',')}`:''};BYHOUR=${draft.hour};BYMINUTE=${draft.minute};BYSECOND=0`;
}
export function draftBody(draft:Draft) {
  if(!draft.name.trim()||!draft.prompt.trim())throw new Error('Name and instructions are required');
  if(!draft.timezone.trim())throw new Error('Timezone is required');
  return {name:draft.name.trim(),prompt:draft.prompt.trim(),rule:scheduleRule(draft),timezone:draft.timezone.trim(),enabled:draft.enabled,target:{kind:'local'}};
}
