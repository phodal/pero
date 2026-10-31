// Development Desktop UI -> durable Host Automation -> real fixture ACP owner.
// No external source, provider, model or tool calls; not standalone/installer acceptance.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root=resolve(import.meta.dirname,'../..');
const output=resolve(root,'test-results/automation');
await mkdir(output,{recursive:true});
for(const name of ['result.json','failure.json'])await rm(resolve(output,name),{force:true});
const temp=await mkdtemp(resolve(tmpdir(),'pero-automation-ui-'));
const capture=resolve(temp,'prompts.jsonl'), agents=resolve(temp,'agents.json');
await writeFile(capture,'');
await writeFile(agents,JSON.stringify([{id:'automation-fixture',name:'Automation fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/automation-acp.mjs')],env:{AUTOMATION_FIXTURE_LOG:capture}}]));
const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'profile'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'sessions.jsonl'),PERO_AGENTS_FILE:agents,PERO_LOCALE:'en'};
delete env.ELECTRON_RUN_AS_NODE;delete env.PERO_APPS_ROOT;
let app,page,panel;
const checks=[],errors=[];
async function query(){
 return page.evaluate(()=>new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();
  const timer=setTimeout(()=>{unsubscribe();reject(new Error('Automation query timed out'));},10000);
  const unsubscribe=window.pero.onEvent(event=>{if(event.request_id!==id)return;clearTimeout(timer);unsubscribe();event.kind==='automation_result'?resolve(event.data):reject(new Error(event.text));});
  window.pero.sessionCommand({method:'automation',id,command:{action:'query'}}).catch(error=>{clearTimeout(timer);unsubscribe();reject(error);});
 }));
}
async function launch(){
 app=await electron.launch({args:[resolve(root,'desktop')],cwd:root,env});
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
 await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('automation').click());
 panel=page.getByRole('dialog',{name:'Automation',exact:true});
 await expect(panel).toBeVisible();
 await expect(panel.getByRole('button',{name:'New',exact:true})).toBeEnabled();
}
async function close(){if(app){const current=app;app=undefined;await current.close();}}
// Only inspect children of the test-owned process; worker threads may spawn ACP.
async function ownedChildren(pid){
 const children=new Set();
 for(const tid of await readdir(`/proc/${pid}/task`)){
  try{for(const child of (await readFile(`/proc/${pid}/task/${tid}/children`,'utf8')).trim().split(/\s+/).filter(Boolean))children.add(child);}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return [...children];
}
try{
 await launch();
 expect((await query()).state.definitions).toEqual([]);
 await panel.getByRole('button',{name:'New',exact:true}).click();
 const create=panel.locator('form[data-create]');
 await create.getByLabel('Name',{exact:true}).fill('Fixture inspection');
 await expect(create.getByRole('combobox',{name:'Agent',exact:true})).toHaveAccessibleName('Agent');
 await create.getByLabel('Agent',{exact:true}).selectOption('automation-fixture');
 await create.getByLabel('Trigger',{exact:true}).selectOption('event');
 await expect(create.getByLabel('Event kind',{exact:true})).toBeVisible();
 await create.getByLabel('Trigger',{exact:true}).selectOption('manual');
 await create.getByLabel('Input',{exact:true}).selectOption('process_exact');
 await create.getByLabel('Method prompt',{exact:true}).fill('Inspect this fixed local input.');
 await create.getByRole('button',{name:'Create',exact:true}).click();
 await expect(create).toBeHidden();
 const detail=panel.getByRole('region',{name:'Automation details',exact:true});
 await expect(detail).toBeVisible();
 await detail.getByLabel('Subject',{exact:true}).fill('fixture-sample');
 await detail.getByLabel('Input',{exact:true}).fill('sample=17');
 await detail.getByRole('button',{name:'Run',exact:true}).click();
 let finished;
 await expect.poll(async()=>{finished=await query();return finished.state.requests[0]?.status.kind;},{timeout:30000}).toBe('completed');
 await expect(detail.locator('[data-requests] tbody')).toContainText('completed');
 const request=finished.state.requests[0];
 expect(request.snapshot.subject).toBe('fixture-sample');
 expect(request.execution_id).toBeTruthy();
 expect(finished.evidence.admissions[0].record.authority.permissionPolicy).toBe('deny');
 const prompts=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);
 expect(prompts).toHaveLength(1);
 expect(prompts[0].workspace).toBe(request.definition.method.workspace);
 expect(prompts[0].text).toContain('sample=17');
 checks.push('native menu creates a fixed local definition; UI Run enters existing ACP owner with frozen input/workspace');
 // A fresh Run click is an explicit intent even when its input bytes are unchanged.
 await detail.getByLabel('Subject',{exact:true}).fill('fixture-sample');
 await detail.getByLabel('Input',{exact:true}).fill('sample=17');
 await detail.getByRole('button',{name:'Run',exact:true}).click();
 let rerun;
 await expect.poll(async()=>{const projection=await query();rerun=projection.state.requests.find(value=>value.id!==request.id);return rerun?.status.kind;},{timeout:30000}).toBe('completed');
 expect(rerun.reprocess_of).toBe(request.id);
 expect(rerun.execution_id).not.toBe(request.execution_id);
 expect(rerun.snapshot).toEqual(request.snapshot);
 await expect(detail.locator('[data-requests] tbody')).toContainText(`Reprocess of ${request.id}`);
 expect((await readFile(capture,'utf8')).trim().split('\n')).toHaveLength(2);
 checks.push('two explicit UI Run clicks with identical input produce two linked executions');
 await panel.getByRole('button',{name:'Pause',exact:true}).click();
 await expect(panel.locator('[data-catalog] tbody')).toContainText('Paused');
 await page.screenshot({path:resolve(output,'automation.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,700));
 expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
 await page.screenshot({path:resolve(output,'automation-narrow.png')});
 // A real frozen scheduled definition: publishing newer input cannot edit its pin.
 await panel.getByRole('button',{name:'New',exact:true}).click();
 await create.getByLabel('Name',{exact:true}).fill('Pinned schedule');
 await create.getByLabel('Agent',{exact:true}).selectOption('automation-fixture');
 await create.getByLabel('Trigger',{exact:true}).selectOption('time');
 await create.getByLabel('Input',{exact:true}).selectOption('process_exact');
 await create.getByLabel('Method prompt',{exact:true}).fill('Inspect the frozen scheduled sample.');
 const future=new Date(Date.now()+86400000);future.setMinutes(future.getMinutes()-future.getTimezoneOffset());
 await create.getByLabel('First run',{exact:true}).fill(future.toISOString().slice(0,16));
 await create.getByLabel('Subject',{exact:true}).fill('scheduled-sample');
 await create.getByLabel('Initial input',{exact:true}).fill('sample=23');
 await create.getByRole('button',{name:'Create',exact:true}).click();
 await expect(create).toBeHidden();
 const schedule=(await query()).state.definitions.find(value=>value.id==='Pinned schedule');
 expect(schedule.trigger.exact.revision).toBeTruthy();
 await expect(detail.locator('[data-pinned]')).toHaveText(`Pinned revision: ${schedule.trigger.exact.revision}`);
 await expect(detail.locator('form[data-input]')).toBeHidden();
 await expect(detail.getByRole('button',{name:'Publish latest input',exact:true})).toBeHidden();
 expect((await query()).state.requests).toHaveLength(2);
 checks.push('real exact schedule displays its frozen revision and offers no misleading latest-input edit');
 const before=await query();
 await close();await launch();
 const restored=await query();
 expect(restored.state.definitions).toEqual(before.state.definitions);
 expect(restored.state.controls['Fixture inspection'].paused).toBe(true);
 expect(restored.state.requests).toEqual(before.state.requests);
 await expect(panel.locator('[data-catalog] tbody')).toContainText('Paused');
 expect((await readFile(capture,'utf8')).trim().split('\n')).toHaveLength(2);
 expect(errors).toEqual([]);
 checks.push('pause and completed input/execution references survive restart without prompt replay');
 if(process.platform==='linux'){
  await panel.getByRole('button',{name:'New',exact:true}).click();
  const recoveryCreate=panel.locator('form[data-create]');
  await recoveryCreate.getByLabel('Name',{exact:true}).fill('Recover held execution');
  await recoveryCreate.getByLabel('Agent',{exact:true}).selectOption('automation-fixture');
  await recoveryCreate.getByLabel('Method prompt',{exact:true}).fill('[hold] Inspect recovery input');
  await recoveryCreate.getByRole('button',{name:'Create',exact:true}).click();
  await expect(recoveryCreate).toBeHidden();
  const recoveryDetail=panel.getByRole('region',{name:'Automation details',exact:true});
  await recoveryDetail.getByLabel('Subject',{exact:true}).fill('recovery-sample');
  await recoveryDetail.getByLabel('Input',{exact:true}).fill('frozen recovery bytes');
  await recoveryDetail.getByRole('button',{name:'Run',exact:true}).click();
  let held;
  await expect.poll(async()=>{held=(await query()).state.requests.find(value=>value.definition.id==='Recover held execution');return held?.status.kind;}).toBe('running');
  await expect.poll(async()=>(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse).at(-1).text).toContain('frozen recovery bytes');
  // Fault only the real Host directly parented by this test-owned Electron.
  const electronPid=app.process().pid;
  const childIds=await ownedChildren(electronPid);
  const binary=await realpath(resolve(root,'target/debug/pero-host'));
  const hostIds=[];
  for(const pid of childIds){try{if(await readlink(`/proc/${pid}/exe`)===binary)hostIds.push(Number(pid));}catch(error){if(error.code!=='ENOENT')throw error;}}
  expect(hostIds).toHaveLength(1);
  const hostPid=hostIds[0];
  const hostChildren=await ownedChildren(hostPid);
  expect(hostChildren.length).toBeGreaterThan(0);
  const fixturePids=[];
  for(const pid of hostChildren){try{if((await readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0').includes(resolve(root,'tests/fixtures/automation-acp.mjs')))fixturePids.push(pid);}catch(error){if(error.code!=='ENOENT')throw error;}}
  expect(fixturePids.length).toBeGreaterThan(0);
  process.kill(hostPid,'SIGKILL');
  await page.waitForFunction(()=>!JSON.parse(window.peroDiagnostics.snapshot()).connected);
  // Confirm the fixture children really stopped before making the attestation.
  await expect.poll(async()=>{
   for(const pid of fixturePids){try{const stat=await readFile(`/proc/${pid}/stat`,'utf8');if(!['Z','X'].includes(stat.slice(stat.lastIndexOf(')')+2).split(' ')[0]))return false;}catch(error){if(error.code!=='ENOENT')throw error;}}
   return true;
  }).toBe(true);
  await close();await launch();
  expect((await query()).state.requests.find(value=>value.id===held.id).status.kind).toBe('reconcile');
  await panel.getByRole('button',{name:'Recover held execution',exact:true}).click();
  await panel.getByRole('button',{name:'Review outcome',exact:true}).click();
  const review=panel.getByRole('form',{name:'Review execution outcome'});
  await expect(review).toContainText('Manual attestation, not platform verification');
  await expect(review).toContainText(held.execution_id);
  await expect(review).toContainText(held.snapshot.digest);
  await expect(review.getByLabel('Reported outcome',{exact:true})).toHaveValue('');
  await review.getByLabel('Reported outcome',{exact:true}).selectOption('failed');
  await review.getByLabel('Evidence',{exact:true}).fill('Test-owned Host was killed; fixture child processes stopped; capture shows one prompt and no output side effects.');
  await review.getByRole('button',{name:'Record outcome',exact:true}).click();
  expect((await query()).state.requests.find(value=>value.id===held.id).status.kind).toBe('reconcile');
  await review.getByRole('checkbox',{name:'I checked that this execution and its child processes are no longer running.'}).check();
  await review.getByRole('checkbox',{name:'I checked its outputs and side effects against the reported outcome.'}).check();
  await page.screenshot({path:resolve(output,'automation-review-outcome.png')});
  await review.getByRole('button',{name:'Record outcome',exact:true}).click();
  await expect(review).toBeHidden();
  const reconciled=await query();
  const reviewed=reconciled.state.requests.find(value=>value.id===held.id);
  expect(reviewed.status.kind).toBe('reconciled');
  expect(reviewed.operator_reconciliation.authority).toBe('local_operator');
  expect(reviewed.operator_reconciliation.execution_id).toBe(held.execution_id);
  expect(reconciled.state.controls['Recover held execution'].paused).toBe(true);
  await expect(panel.locator('[data-requests] tbody')).toContainText('Reconciled · operator-reported failed');
  await page.screenshot({path:resolve(output,'automation-reconciled.png')});
  await close();await launch();
  expect((await query()).state.requests.find(value=>value.id===held.id)).toEqual(reviewed);
  await panel.getByRole('button',{name:'Recover held execution',exact:true}).click();
  await panel.getByText('Operator record',{exact:true}).click();
  const operatorRecord=panel.locator('details[open]');
  await expect(operatorRecord).toContainText(reviewed.operator_reconciliation.evidence);
  await expect(operatorRecord).toContainText('local_operator');
  await expect(operatorRecord).toContainText('previous state: reconcile');
  await expect(operatorRecord).toContainText(new Date(reviewed.operator_reconciliation.recorded_at*1000).toISOString());
  expect((await readFile(capture,'utf8')).trim().split('\n')).toHaveLength(3);
  checks.push('real Host crash recovery requires two explicit operator attestations; durable reconciled outcome pauses definition without replay');
 }

 await close();
 expect(errors).toEqual([]);
 await writeFile(resolve(output,'result.json'),JSON.stringify({scope:'local-development-fixture',checks,errors,requestId:request.id,executionId:request.execution_id,exclusions:['live providers','external source resolvers','shared handoff','always-on service','standalone product','signed installer']},null,2));
}catch(error){
 if(page&&!page.isClosed())await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});
 await writeFile(resolve(output,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,errors},null,2));
 throw error;
}finally{await close();await rm(temp,{recursive:true,force:true});}
