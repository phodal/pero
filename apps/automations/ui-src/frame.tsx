import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppProvider} from '@pero/app-sdk';
import {Button, Checkbox, EmptyIllustration, EmptyState, Feedback, Input, LibraryHeader, Select, Table, Textarea} from '@pero/app-sdk/ui';
import {automationRequest,openSession} from './transport';
import {draftBody,editDraft,newDraft,templates,weekdays,type Automation,type Draft} from './model';
import './frame.css';
const path=(id:string)=>`/api/automations/${encodeURIComponent(id)}`;
const date=(value?:string)=>value?new Date(value).toLocaleString():'—';
function Automations(){
  const [items,setItems]=useState<Automation[]>([]),[selected,select]=useState<string>();
  const [draft,setDraft]=useState<Draft>(),[gallery,setGallery]=useState(false),[query,search]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const refresh=async()=>{const result=await automationRequest<{items:Automation[]}>('GET','/api/automations');setItems(result.items);setLoading(false);};
  useEffect(()=>{let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const tick=async()=>{try{if(!stopped)await refresh();}catch(e){if(!stopped){setError((e as Error).message);setLoading(false);}}finally{if(!stopped)timer=setTimeout(tick,5000);}};
    void tick();return()=>{stopped=true;clearTimeout(timer);};
  },[]);
  const perform=async(operation:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await operation();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const save=()=>perform(async()=>{if(!draft)return;const saved=await automationRequest<Automation>(draft.id?'PUT':'POST',draft.id?path(draft.id):'/api/automations',draftBody(draft));select(saved.id);setDraft(undefined);setNotice('Saved');});
  const patch=(value:Partial<Draft>)=>setDraft(previous=>previous?{...previous,...value}:previous);
  const record=items.find(item=>item.id===selected);
  const visible=items.filter(item=>`${item.name} ${item.prompt}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="automation-app">
    <LibraryHeader title="Automations" density="compact" actions={<div className="actions"><Button type="button" onClick={()=>setGallery(!gallery)}>Templates</Button><Button variant="primary" onClick={()=>{setDraft(newDraft());setGallery(false);}}>New automation</Button></div>}/>
    {error&&<Feedback kind="error" variant="block" className="feedback">{error}<Button type="button" disabled={busy} onClick={()=>void perform(refresh)}>Retry</Button></Feedback>}
    {notice&&<Feedback>{notice}</Feedback>}
    {gallery&&<section aria-label="Templates" className="templates">{templates.map(template=><Button type="button" key={template.name} onClick={()=>{setDraft({...newDraft(),...template});setGallery(false);}}><strong>{template.name}</strong><span>{template.schedule}</span></Button>)}</section>}
    <div className="workspace"><section className="catalog" aria-label="Automation list">
      <Input aria-label="Search automations" type="search" placeholder="Search automations" value={query} onChange={e=>search(e.target.value)}/>
      {loading?<Feedback>Loading…</Feedback>:!items.length?!error&&<EmptyState icon={<EmptyIllustration kind="data"/>} heading="No automations yet" description="Create one or choose a template."/>:!visible.length?<EmptyState icon={<EmptyIllustration kind="search" size="compact"/>} heading="No matching automations" description="Try a different search."/>:<Table label="Automations" rows={visible} rowId={item=>item.id} columns={[
        {id:'name',header:'Name',size:260,cell:item=><><Button variant="link" className="automation-name" aria-current={item.id===selected?'true':undefined} onClick={()=>{select(item.id);setDraft(undefined);}}>{item.name}</Button><small>{item.event?`Event: ${item.event.event}`:item.rule||'Manual'}</small></>},
        {id:'status',header:'Status',size:180,cell:item=><>{!item.scheduled?'Unavailable':item.in_flight?'Running':item.kind==='research_watch'&&!item.rule?'Manual':item.enabled?'Enabled':'Paused'}{item.error&&<small role="alert">{item.error}</small>}</>},
        {id:'next',header:'Next run',size:180,cell:item=>date(item.next)},
        {id:'actions',header:'Actions',size:220,cell:item=>item.kind==='research_watch'?<span className="muted">Managed in Paper</span>:<div className="actions"><Button disabled={busy} onClick={()=>void perform(async()=>{await automationRequest('PUT',path(item.id),{enabled:!item.enabled});})}>{item.enabled?'Pause':'Enable'}</Button><Button disabled={busy||!!item.in_flight||!item.enabled||!item.scheduled} onClick={()=>void perform(async()=>{const receipt=await automationRequest<{request_id:string}>('POST',`${path(item.id)}/run`);select(item.id);setNotice(`Run queued · ${receipt.request_id}`);})}>Run now</Button></div>},
      ]}/>}
    </section>
    {draft?<section className="details" aria-label="Automation editor" onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void save();}}}>
      <header><h2>{draft.id?'Edit automation':'New automation'}</h2><Button type="button" onClick={()=>setDraft(undefined)}>Close</Button></header>
      <label>Name<Input value={draft.name} onChange={e=>patch({name:e.target.value})} maxLength={200}/></label>
      <label>Instructions<Textarea value={draft.prompt} onChange={e=>patch({prompt:e.target.value})} rows={6} maxLength={16000}/></label>
      <label>Schedule<Select label="Schedule" value={draft.schedule} onChange={value=>patch({schedule:value as Draft['schedule']})} options={['manual','hourly','daily','weekly','monthly','custom'].map(value=>({value,label:value==='custom'?'RRULE (advanced)':value[0].toUpperCase()+value.slice(1)}))}/></label>
      {draft.schedule==='custom'?<label>RRULE<Input value={draft.rule} onChange={e=>patch({rule:e.target.value})}/><small>Unsupported rules are rejected by Host.</small></label>:draft.schedule!=='manual'&&<>
        <label>Repeat every ({draft.schedule==='hourly'?'hours':draft.schedule==='daily'?'days':draft.schedule==='weekly'?'weeks':'months'})<Input type="number" min={1} max={366} value={draft.interval} onChange={e=>patch({interval:e.target.valueAsNumber})}/></label>
        <div className="time-fields">{draft.schedule!=='hourly'&&<label>Hour<Input type="number" min={0} max={23} value={draft.hour} onChange={e=>patch({hour:e.target.valueAsNumber})}/></label>}<label>Minute<Input type="number" min={0} max={59} value={draft.minute} onChange={e=>patch({minute:e.target.valueAsNumber})}/></label></div>
      </>}
      {draft.schedule==='monthly'&&<label>Day of month<Input type="number" min={1} max={31} value={draft.monthDay} onChange={e=>patch({monthDay:e.target.valueAsNumber})}/><small>Months without this day are skipped.</small></label>}
      {draft.schedule==='weekly'&&<fieldset><legend>Weekdays</legend><div className="weekdays">{weekdays.map(day=><label key={day}><Checkbox checked={draft.days.includes(day)} onCheckedChange={checked=>patch({days:checked===true?[...draft.days,day]:draft.days.filter(value=>value!==day)})}/>{day}</label>)}</div></fieldset>}
      <label>Timezone<Input value={draft.timezone} placeholder="Local or Europe/London" onChange={e=>patch({timezone:e.target.value})}/></label>
      <label className="check"><Checkbox checked={draft.enabled} onCheckedChange={checked=>patch({enabled:checked===true})}/>Enable after saving</label>
      <small>Runs use the Host's local workspace and configured Agent. Templates do not run until enabled.</small>
      <div className="actions editor-save"><Button variant="primary" disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save automation'}</Button></div>
    </section>:record&&<section className="details" aria-label="Automation details"><header><h2>{record.name}</h2>{record.kind!=='research_watch'&&<Button type="button" disabled={!!record.event} onClick={()=>setDraft(editDraft(record))}>Edit</Button>}</header>
      {record.event&&<p className="muted">Event rule editing is not available here.</p>}<p className="instructions">{record.prompt}</p><p className="muted">{record.timezone} · {record.rule||'Manual'}</p><h3>Run history</h3>
      {!record.runs.length?<p className="muted">No runs yet.</p>:<ol className="history">{[...record.runs].reverse().map((run,index)=><li key={run.key.request_id||`${run.key.slot}-${index}`}><div><strong>{run.state}</strong><small>{date(run.scheduled_for)} · {run.key.trigger}</small>{(run.error||run.skip_reason)&&<p>{run.error||run.skip_reason}</p>}</div>{run.session_id&&<Button type="button" onClick={()=>openSession(run.session_id!)}>Open session</Button>}</li>)}</ol>}
    </section>}
    </div>
  </main>;
}
createRoot(document.getElementById('app')!).render(<AppProvider><Automations/></AppProvider>);
