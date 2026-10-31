import type { AutomationCommand, AutomationDefinition, AutomationResult, AutomationTrigger } from '../../protocol/generated/host';
import { canReviewOutcome, cancellationLabel, checkInput, checkReconciliation, currentDefinitions, inputPresentation, requestIdentity, requestStatus } from './automation-model';
import './automation.css';

type Event = {kind:string; request_id:string|null; text:string; data?:unknown};
type Pending = {resolve:(value:AutomationResult)=>void; reject:(error:Error)=>void; timer:ReturnType<typeof setTimeout>};

// A view and request adapter only. Host state owns every scheduling transition.
export function installAutomation(send:(command:object)=>Promise<void>) {
  const modal = document.createElement('dialog');
  modal.className = 'automation';
  modal.setAttribute('aria-labelledby', 'automation-title');
  modal.innerHTML = `<header><h1 id="automation-title">Automation</h1><button type="button" aria-label="Close Automation">×</button></header>
    <div class="automation-toolbar"><span data-scope>Local published inputs · runs while open</span><button type="button" data-new disabled>New</button><button type="button" data-refresh>Refresh</button></div>
    <p role="alert" class="automation-error" hidden></p>
    <form data-create hidden>
      <h2>New Automation</h2>
      <div class="automation-fields"><label>Name<input name="name" required maxlength="128"></label><label><span id="automation-agent-label">Agent</span><select aria-labelledby="automation-agent-label" name="agent" required></select></label>
      <label><span id="automation-trigger-label">Trigger</span><select aria-labelledby="automation-trigger-label" name="trigger"><option value="manual">Manual</option><option value="event">Local event</option><option value="time">Schedule</option></select></label>
      <label><span id="automation-input-label">Input</span><select aria-labelledby="automation-input-label" name="input"><option value="process_exact">Exact version</option><option value="recheck_latest">Latest published input</option></select></label></div>
      <label>Method prompt<textarea name="prompt" rows="3" required maxlength="16000"></textarea></label>
      <div data-event hidden><label><span id="automation-event_kind-label">Event kind</span><select aria-labelledby="automation-event_kind-label" name="event_kind"></select></label></div>
      <div data-time hidden class="automation-fields"><label>First run<input name="anchor" type="datetime-local"></label><label>Repeat (seconds)<input name="interval" type="number" min="60" max="31536000" value="3600"></label><label>Catch up within (seconds)<input name="lateness" type="number" min="0" max="31536000" value="3600"></label></div>
      <div data-seed hidden><label>Subject<input name="subject" maxlength="128" value="default"></label><label>Initial input<textarea name="content" rows="3"></textarea></label></div>
      <p class="automation-muted" data-workspace></p><div class="automation-actions"><button type="button" data-create-cancel>Cancel</button><button type="button" data-save>Create</button></div>
    </form>
    <section data-catalog aria-label="Automation definitions"><p data-empty>Loading…</p><table hidden><thead><tr><th>Name</th><th>Trigger</th><th>Input</th><th>Status</th><th></th></tr></thead><tbody></tbody></table></section>
    <section data-detail hidden aria-label="Automation details"><h2 data-detail-title></h2><p class="automation-muted" data-detail-binding></p><p class="automation-muted" data-pinned hidden></p>
      <form data-input><div class="automation-fields"><label>Subject<input name="subject" required maxlength="128" value="default"></label></div><label>Input<textarea name="content" required rows="3"></textarea></label><div class="automation-actions"><button type="button" data-submit-input>Run</button></div></form>
      <table data-requests><thead><tr><th>Request</th><th>State</th><th>Input / execution</th><th></th></tr></thead><tbody></tbody></table>
    </section>
    <form data-review hidden aria-label="Review execution outcome">
      <h2>Review outcome</h2><p class="automation-muted">Manual attestation, not platform verification. Recording pauses this automation; resume it separately.</p>
      <p class="automation-muted" data-review-identity></p>
      <label><span id="automation-disposition-label">Reported outcome</span><select name="disposition" aria-labelledby="automation-disposition-label" required><option value="">Choose checked outcome</option><option value="not_started">Not started</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select></label>
      <label>Evidence<textarea name="evidence" required rows="3" maxlength="4096" placeholder="What did you check? (4096 bytes maximum)"></textarea></label>
      <label><input type="checkbox" name="execution_stopped" required>I checked that this execution and its child processes are no longer running.</label>
      <label><input type="checkbox" name="effects_checked" required>I checked its outputs and side effects against the reported outcome.</label>
      <div class="automation-actions"><button type="button" data-review-cancel>Back</button><button type="button" data-reconcile>Record outcome</button></div>
    </form>`;
  document.body.append(modal);
  const find = <T extends Element = HTMLElement>(selector:string) => modal.querySelector<T>(selector)!;
  const create = find<HTMLFormElement>('form[data-create]');
  const input = find<HTMLFormElement>('form[data-input]');
  const review = find<HTMLFormElement>('form[data-review]');
  let reviewTarget: { requestId:string; executionId:string } | undefined;
  const error = find<HTMLElement>('[role="alert"]');
  let result:AutomationResult|undefined, selected='', busy=false, timer:ReturnType<typeof setTimeout>|undefined;
  let manualIntent = crypto.randomUUID(), seedRevision = crypto.randomUUID();
  const pending = new Map<string, Pending>();
  const showError = (value:unknown) => { error.textContent=value instanceof Error ? value.message : String(value); error.hidden=false; };
  const command = (value:AutomationCommand) => new Promise<AutomationResult>((resolve,reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {pending.delete(id);reject(new Error('Response unavailable. Refresh status before retrying this action.'));},15000);
    pending.set(id,{resolve,reject,timer:timeout});
    send({method:'automation',id,command:value}).catch(error => {clearTimeout(timeout);pending.delete(id);reject(error);});
  });
  const run = async (operation:()=>Promise<void>) => {
    if (busy) return;
    busy=true;error.hidden=true;render();
    try {await operation();} catch (e) {showError(e);} finally {busy=false;render();}
  };
  const query = async () => {result=await command({action:'query'});render();};
  const poll = () => {clearTimeout(timer);if(modal.open)timer=setTimeout(async()=>{try{await query();}catch(e){showError(e);}poll();},1500);};
  const button = (text:string, click:()=>void) => {const element=document.createElement('button');element.type='button';element.textContent=text;element.disabled=busy;element.addEventListener('click',click);return element;};
  const cell = (row:HTMLTableRowElement,text:string) => {const element=row.insertCell();element.textContent=text;return element;};
  function render() {
    if (!result) return;
    const definitions=currentDefinitions(result.state);
    if(result.fault)showError(result.fault);
    find<HTMLButtonElement>('[data-new]').disabled=busy||!result.capabilities.available;
    const body=find<HTMLTableSectionElement>('[data-catalog] tbody');body.replaceChildren();
    find<HTMLElement>('[data-empty]').hidden=definitions.length>0;
    find<HTMLElement>('[data-empty]').textContent='No automations yet.';
    find<HTMLTableElement>('[data-catalog] table').hidden=!definitions.length;
    for(const definition of definitions){
      const control=result.state.controls[definition.id];const row=body.insertRow();
      cell(row,'').append(button(definition.id,()=>{selected=definition.id;manualIntent=crypto.randomUUID();render();}));
      cell(row,definition.trigger.kind);cell(row,definition.input==='process_exact'?'Exact':'Latest');
      cell(row,control?.revoked?'Revoked':control?.paused?'Paused':'Enabled');
      const toggle=button(control?.paused?'Resume':'Pause',()=>void run(async()=>{result=await command({action:'control',definition_id:definition.id,paused:!control?.paused,revoked:false});}));
      toggle.disabled=busy||!!control?.revoked||!result.capabilities.available;cell(row,'').append(toggle);
    }
    const definition=definitions.find(value=>value.id===selected);
    find<HTMLElement>('[data-detail]').hidden=!definition;
    if(definition){
      find<HTMLElement>('[data-detail-title]').textContent=definition.id;
      find<HTMLElement>('[data-detail-binding]').textContent=`${definition.method.agent_id} · ${definition.method.workspace} · revision ${definition.revision}`;
      const presentation=inputPresentation(definition);input.hidden=!presentation.editable;
      const pinned=find<HTMLElement>('[data-pinned]');pinned.hidden=presentation.pinnedRevision===null;pinned.textContent=presentation.pinnedRevision===null?'':`Pinned revision: ${presentation.pinnedRevision}`;
      const subject=input.elements.namedItem('subject') as HTMLInputElement;
      if(definition.trigger.kind==='time'){subject.value=definition.trigger.subject;subject.readOnly=true;}else subject.readOnly=false;
      find<HTMLButtonElement>('[data-submit-input]').textContent=definition.trigger.kind==='manual'?'Run':'Publish latest input';
      const rows=find<HTMLTableSectionElement>('[data-requests] tbody');
      const expanded=new Set([...rows.querySelectorAll<HTMLDetailsElement>('details[open]')].map(element=>element.dataset.request));rows.replaceChildren();
      for(const request of result.state.requests.filter(value=>value.definition.id===definition.id).reverse()){
        const row=rows.insertRow();cell(row,requestIdentity(request));cell(row,[requestStatus(request),result.attention[request.id],request.status.kind==='reconcile'?'Cancellation requests do not confirm the execution has stopped.':null].filter(Boolean).join(' · '));
        const references=[request.snapshot?.revision,request.snapshot?.digest,request.execution_id].filter((value):value is string=>!!value);
        const evidence=cell(row,references.map(value=>value.length>24?`${value.slice(0,12)}…${value.slice(-6)}`:value).join(' · ')||request.subject);
        evidence.title=references.join('\n')||request.subject;
        const actions=cell(row,'');
        if(request.operator_reconciliation){
          const record=request.operator_reconciliation, details=document.createElement('details'), summary=document.createElement('summary'), evidence=document.createElement('p'), metadata=document.createElement('p');
          details.dataset.request=request.id;details.open=expanded.has(request.id);summary.textContent='Operator record';evidence.textContent=record.evidence;
          metadata.textContent=`${record.authority} · ${new Date(record.recorded_at*1000).toISOString()} · previous state: ${record.previous_status.kind}`;
          details.append(summary,evidence,metadata);actions.append(details);
        }
        if(canReviewOutcome(request))actions.append(button('Review outcome',()=>{
          reviewTarget={requestId:request.id,executionId:request.execution_id!};review.reset();review.hidden=false;
          find<HTMLElement>('[data-review-identity]').textContent=`Request ${request.id} · Execution ${request.execution_id} · ${request.definition.id} revision ${request.definition.revision} · Binding ${request.snapshot?.binding_id??request.definition.input_binding_id} · Subject ${request.subject} · Input ${request.snapshot?.revision??'unavailable'} · Digest ${request.snapshot?.digest??'unavailable'}`;
          render();review.scrollIntoView({block:'nearest'});
        }));
        const cancelLabel=cancellationLabel(request.status.kind);
        if(cancelLabel)actions.append(button(cancelLabel,()=>void run(async()=>{result=await command({action:'cancel',request_id:request.id});})));
        if(request.status.kind==='definition_changed')actions.append(button('Continue original',()=>void run(async()=>{result=await command({action:'continue_old',request_id:request.id});})));
      }
    }
    for(const action of modal.querySelectorAll<HTMLButtonElement>('[data-save],[data-submit-input]'))action.disabled=busy||!result.capabilities.available;
    const reviewing=result.state.requests.find(request=>request.id===reviewTarget?.requestId&&request.execution_id===reviewTarget.executionId);
    find<HTMLButtonElement>('[data-reconcile]').disabled=busy||!result.capabilities.available||!reviewing||!canReviewOutcome(reviewing);
    find<HTMLElement>('[data-workspace]').textContent=`Local workspace: ${result.capabilities.workspace}`;
  }
  const changeTrigger=()=>{
    const kind=(create.elements.namedItem('trigger') as HTMLSelectElement).value;
    find<HTMLElement>('[data-event]').hidden=kind!=='event';find<HTMLElement>('[data-time]').hidden=kind!=='time';find<HTMLElement>('[data-seed]').hidden=kind!=='time';
    for(const name of ['anchor','interval','lateness','subject','content']) (create.elements.namedItem(name) as HTMLInputElement).required=kind==='time';
  };
  review.addEventListener('submit',event=>event.preventDefault());
  find('[data-review-cancel]').addEventListener('click',()=>{if(!busy){review.hidden=true;reviewTarget=undefined;}});
  find('[data-reconcile]').addEventListener('click',()=>void run(async()=>{
    if(!result||!reviewTarget||!review.reportValidity())return;
    const fields=new FormData(review), evidence=String(fields.get('evidence'));
    checkReconciliation(evidence,fields.get('execution_stopped')==='on',fields.get('effects_checked')==='on');
    result=await command({action:'reconcile',request_id:reviewTarget.requestId,expected_execution_id:reviewTarget.executionId,disposition:String(fields.get('disposition')) as 'not_started'|'completed'|'failed'|'cancelled',evidence,execution_stopped:true,effects_checked:true});
    review.hidden=true;reviewTarget=undefined;
  }));
  create.addEventListener('submit',event=>event.preventDefault());input.addEventListener('submit',event=>event.preventDefault());
  find<HTMLSelectElement>('[name="trigger"]').addEventListener('change',changeTrigger);
  find('[data-new]').addEventListener('click',()=>{
    if(!result)return;create.reset();seedRevision=crypto.randomUUID();
    const agents=create.elements.namedItem('agent') as HTMLSelectElement;agents.replaceChildren();
    for(const agent of result.capabilities.agents.filter(agent=>agent.available)){const option=document.createElement('option');option.value=agent.id;option.textContent=agent.name;agents.append(option);}
    const kinds=create.elements.namedItem('event_kind') as HTMLSelectElement;kinds.replaceChildren();
    for(const kind of result.state.bindings.find(binding=>binding.id===result!.capabilities.sourceBindingId)?.event_kinds??[]){const option=document.createElement('option');option.value=kind;option.textContent=kind;kinds.append(option);}
    const next=new Date(Date.now()+60000);next.setMinutes(next.getMinutes()-next.getTimezoneOffset());(create.elements.namedItem('anchor') as HTMLInputElement).value=next.toISOString().slice(0,16);
    create.hidden=false;changeTrigger();render();
  });
  find('[data-create-cancel]').addEventListener('click',()=>{if(!busy)create.hidden=true;});
  find('[data-save]').addEventListener('click',()=>void run(async()=>{
    if(!result||!create.reportValidity())return;
    const fields=new FormData(create), mode=String(fields.get('trigger')), contract=String(fields.get('input')) as AutomationDefinition['input'];
    let trigger:AutomationTrigger={kind:'manual'};
    if(mode==='event')trigger={kind:'event',binding_id:result.capabilities.sourceBindingId,event_kind:String(fields.get('event_kind'))};
    if(mode==='time'){
      const content=String(fields.get('content')), subject=String(fields.get('subject'));checkInput(content,result.capabilities.maxInputBytes);
      result=await command({action:'publish_input',binding_id:result.capabilities.sourceBindingId,subject,revision:seedRevision,content,latest:true});
      const candidate=result.state.snapshots.find(value=>value.binding_id===result!.capabilities.sourceBindingId&&value.subject===subject&&value.revision===seedRevision);
      if(!candidate)throw new Error('Published input receipt is unavailable. Refresh before retrying.');
      trigger={kind:'time',subject,exact:contract==='process_exact'?{revision:candidate.revision,digest:candidate.digest}:null,anchor:Math.floor(new Date(String(fields.get('anchor'))).getTime()/1000),interval_seconds:Number(fields.get('interval')),max_lateness_seconds:Number(fields.get('lateness'))};
    }
    result=await command({action:'create_local',id:String(fields.get('name')),trigger,input:contract,agent_id:String(fields.get('agent')),prompt:String(fields.get('prompt'))});
    selected=String(fields.get('name'));create.hidden=true;
  }));
  find('[data-submit-input]').addEventListener('click',()=>void run(async()=>{
    if(!result||!input.reportValidity())return;
    const definition=currentDefinitions(result.state).find(value=>value.id===selected);if(!definition||!inputPresentation(definition).editable)return;
    const fields=new FormData(input), content=String(fields.get('content')), subject=String(fields.get('subject'));checkInput(content,result.capabilities.maxInputBytes);
    result=await command(definition.trigger.kind==='manual'?{action:'manual_input',definition_id:definition.id,intent_id:manualIntent,subject,content}:{action:'publish_input',binding_id:definition.input_binding_id,subject,revision:manualIntent,content,latest:true});
    manualIntent=crypto.randomUUID();input.reset();
  }));
  find('[data-refresh]').addEventListener('click',()=>void run(query));
  find('[aria-label="Close Automation"]').addEventListener('click',()=>{modal.close();clearTimeout(timer);});
  modal.addEventListener('close',()=>clearTimeout(timer));
  return {event(event:Event){
    if(event.kind==='automation_open'){if(!modal.open)modal.showModal();void run(query).then(poll);return;}
    if(event.kind!=='automation_result'&&event.kind!=='automation_error')return;
    if(event.kind==='automation_error'&&!event.request_id){showError(event.text);return;}
    const request=event.request_id?pending.get(event.request_id):undefined;
    if(!request)return;
    clearTimeout(request.timer);pending.delete(event.request_id!);
    if(event.kind==='automation_error')request.reject(new Error(event.text||'Automation request failed.'));
    else request.resolve(event.data as AutomationResult);
  }};
}
