// Actual Electron -> Host -> managed Worker -> ACP over a loopback Cloud fixture.
// Credentials are disposable; no external account, service or workspace is used.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const root=resolve(import.meta.dirname,'../..');
const temp=await mkdtemp(resolve(tmpdir(),'pero-local-execution-'));
const output=resolve(root,'test-results/local-execution');
const workspace=resolve(temp,'workspace');
await mkdir(workspace,{recursive:true});await mkdir(output,{recursive:true});await rm(resolve(output,'failure.png'),{force:true});
const agents=resolve(temp,'agents.json');
await writeFile(agents,JSON.stringify([{id:'fixture',name:'ACP local execution fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/acp-agent.mjs')]}]));
const clientToken=randomUUID();
const otherClientToken=randomUUID();
const requests=[];const events=[];const enrollments=[];const enrollmentAttempts=[];
const sensitiveBody=`UNTRUSTED_BODY_${randomUUID()}`;
let enrollmentFailure=null;
let workerToken='';let worker;let run;let queued=false;let completed=0;
const server=createServer(async(request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');
  let raw='';for await(const part of request)raw+=part;
  const body=raw?JSON.parse(raw):null;
  requests.push({path:url.pathname,method:request.method});
  response.setHeader('Content-Type','application/json');
  const reply=(value,status=200)=>{response.statusCode=status;response.end(JSON.stringify(value));};
  if(url.pathname.startsWith('/api/worker/')){
    if(request.headers.authorization!==`Bearer ${workerToken}` || !workerToken){reply({error:'invalid worker credential'},401);return;}
    if(url.pathname==='/api/worker/v1/claims'){
      if(queued&&!run){queued=false;run={id:'run-fixture',generation:1,instance_id:body.instance_id,status:'running',lease_expires_at:new Date(Date.now()+120000).toISOString(),spec:{title:'Local device acceptance',prompt:'local device fixture acceptance',project_id:'project-fixture',workspace_key:'research',agent_id:'fixture',acceptance:null}};reply({run});}
      else reply({run:null});return;
    }
    if(url.pathname.endsWith('/renew')){reply({cancel_requested:false,lease_expires_at:new Date(Date.now()+120000).toISOString()});return;}
    if(url.pathname.endsWith('/events')){for(const event of body.events)if(!events.some(previous=>previous.seq===event.seq))events.push(event);reply({last_seq:Math.max(0,...events.map(event=>event.seq))});return;}
    if(url.pathname.endsWith('/complete')){run.status=body.outcome;completed++;reply(run);return;}
    if(url.pathname==='/api/worker/v1/runs/run-fixture'){reply(run);return;}
    reply({error:'unknown worker route'},404);return;
  }
  const other=request.headers.authorization===`Bearer ${otherClientToken}`;
  if(!other&&request.headers.authorization!==`Bearer ${clientToken}`){reply({error:'invalid client credential'},401);return;}
  const path=url.pathname.replace('/api/client/v1','');
  if(path==='/me')reply({id:other?'other-client':'client-fixture',name:other?'Other account':'Local device user',role:'client',projects:['project-fixture']});
  else if(path==='/workers'&&request.method==='POST'){
    enrollmentAttempts.push(body);
    if(enrollmentFailure&&enrollmentFailure!=='network'){
      if(enrollmentFailure==='invalid_json'){response.statusCode=200;response.end(`<html>${sensitiveBody}</html>`);return;}
      response.statusCode=enrollmentFailure;
      if(enrollmentFailure===404){response.setHeader('Content-Type','text/html');response.end(`<html>${sensitiveBody}</html>`);}
      else if(enrollmentFailure===405){response.setHeader('Content-Type','text/plain');response.end(`Method Not Allowed ${sensitiveBody}`);}
      else response.end(JSON.stringify({error:sensitiveBody}));
      return;
    }
    if(!enrollments.some(previous=>previous.request_id===body.request_id))enrollments.push(body);
    worker={id:'worker-local-fixture',name:body.name,projects:body.projects,labels:['desktop']};
    workerToken=`${worker.id}.${body.enrollment_secret}`;
    if(enrollmentFailure==='network'){request.socket.destroy();return;}
    reply({worker,token:workerToken});
  }
  else if(path==='/workers')reply({workers:worker&&!other?[worker]:[]});
  else if(path==='/workers/worker-local-fixture/disable')reply({worker});
  else if(path==='/tasks')reply({tasks:[],has_more:false,next_cursor:null});
  else if(path==='/github/status')reply({configured:false,running:false,errors:[],repositories:[]});
  else if(path==='/contributions')reply({contributions:[],has_more:false,next_cursor:null});
  else reply({error:'unknown fixture route'},404);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`;
const errors=[];let app;
async function launch(profile='main'){
  const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,profile),PERO_SETTINGS_PATH:resolve(temp,`${profile}-settings.json`),PERO_HISTORY_PATH:resolve(temp,`${profile}-history.jsonl`),PERO_LOCALE:'en',PERO_AGENTS_FILE:agents,PERO_CLOUD_URL:base};
  for(const name of ['ELECTRON_RUN_AS_NODE','PERO_CLIENT_TOKEN','PERO_OPERATOR_TOKEN','PERO_WORKER_TOKEN','PERO_WORKER_CONFIG'])delete env[name];
  app=await electron.launch({args:[...(process.platform==='darwin'?['--use-mock-keychain']:[]),resolve(root,'desktop')],cwd:root,env});
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  const state=()=>page.evaluate(()=>window.peroDiagnostics?JSON.parse(window.peroDiagnostics.snapshot()):{});
  await expect.poll(async()=>(await state()).localExecution?.setup?.has_connection,{timeout:60000}).not.toBe(undefined);
  await page.waitForFunction(()=>!document.getElementById('loading'));
  const frame=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await frame();
  return{page,state,frame};
}
async function close(){await app.close();app=undefined;}
async function resources(ui){
  await ui.page.mouse.click(100,await ui.page.evaluate(()=>innerHeight-28));
  await ui.page.keyboard.press('ArrowDown');await ui.page.keyboard.press('ArrowDown');await ui.page.keyboard.press('ArrowDown');await ui.page.keyboard.press('Enter');
  await expect.poll(async()=>(await ui.state()).navigation).toBe(5);await ui.frame();
}
async function savedText(directory){
  let text='';for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,entry.name);
    if(entry.isDirectory()&&!['Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache','Local Storage','Session Storage'].includes(entry.name))text+=await savedText(path);
    else if(entry.isFile()&&/\.json(?:l)?$/.test(entry.name))text+=await readFile(path,'utf8');
  }return text;
}
try{
  let ui=await launch('skip');
  expect((await ui.state()).localExecution.setup).toMatchObject({onboarding_complete:false,enabled:false,has_connection:false});
  expect(requests.some(request=>request.path.includes('/auth/desktop'))).toBe(false);
  await ui.page.screenshot({path:resolve(output,'first-run.png')});
  await ui.page.mouse.click(600,205);
  await expect.poll(async()=>(await ui.state()).localExecution.setup.onboarding_complete).toBe(true);
  await close();
  ui=await launch('skip');
  await expect.poll(async()=>(await ui.state()).localExecution.setup.onboarding_complete).toBe(true);
  expect((await ui.state()).localExecution.setup.enabled).toBe(false);
  await ui.page.evaluate(({url,token})=>window.pero.remoteCommand({action:'remote_configure',url,mode:'client',token}),{url:base,token:clientToken});
  await expect.poll(async()=>(await ui.state()).remote.state.identity?.id).toBe('client-fixture');
  await resources(ui);
  await ui.page.screenshot({path:resolve(output,'enable-later.png')});
  await ui.page.mouse.click(370,125);
  await expect.poll(async()=>(await ui.state()).localExecution.editing).toBe(true);
  expect(enrollments).toHaveLength(0);
  await close();

  ui=await launch();
  await ui.page.evaluate(({url,token})=>window.pero.remoteCommand({action:'remote_configure',url,mode:'client',token}),{url:base,token:clientToken});
  await expect.poll(async()=>(await ui.state()).remote.state.identity?.id).toBe('client-fixture');
  await expect.poll(async()=>(await ui.state()).localExecution.setup.has_connection).toBe(true);
  expect(enrollments).toHaveLength(0);
  expect(requests.some(request=>request.path==='/api/worker/v1/claims')).toBe(false);
  await ui.frame();await ui.page.screenshot({path:resolve(output,'device-setup.png')});
  await ui.page.emulateMedia({colorScheme:'dark'});
  await expect.poll(async()=>(await ui.state()).dark).toBe(true);
  await ui.page.screenshot({path:resolve(output,'device-setup-dark.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,788));
  await ui.page.waitForFunction(()=>innerWidth===1000);await ui.frame();
  await ui.page.screenshot({path:resolve(output,'device-setup-narrow.png')});
  await ui.page.emulateMedia({colorScheme:'light'});
  await expect.poll(async()=>(await ui.state()).dark).toBe(false);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
  await ui.page.waitForFunction(()=>innerWidth===1488);await ui.frame();
  // Select the granted project and explicit folder and Agent in the setup form.
  await ui.page.mouse.click(500,254);await ui.page.keyboard.press('ArrowUp');await ui.page.keyboard.press('Enter');
  await expect.poll(async()=>(await ui.state()).localExecution.project_id).toBe('project-fixture');
  await ui.page.mouse.click(500,318);await ui.page.keyboard.press(process.platform==='darwin'?'Meta+a':'Control+a');await ui.page.keyboard.type('research');
  await expect.poll(async()=>(await ui.state()).localExecution.workspace_key).toBe('research');
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},workspace);
  await ui.page.mouse.click(500,414);
  await expect.poll(async()=>(await ui.state()).localExecution.path).toBe(await realpath(workspace));
  await ui.page.mouse.click(500,478);await ui.page.keyboard.press('ArrowUp');await ui.page.keyboard.press('Enter');
  await expect.poll(async()=>(await ui.state()).localExecution.agent_id).toBe('fixture');
  const selected=(await ui.state()).localExecution;
  const enrollment={action:'local_worker_enroll',name:selected.name,project_id:selected.project_id,workspace_key:selected.workspace_key,path:selected.path,agent_id:selected.agent_id};
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click());
  await expect.poll(async()=>(await ui.state()).locale).toBe('zh-CN');
  const diagnostics=[
    [404,'server_unsupported','当前云端服务尚不支持设备注册，请联系管理员升级服务。'],
    [405,'server_unsupported','当前云端服务尚不支持设备注册，请联系管理员升级服务。'],
    [401,'reauthenticate','登录已失效，请重新连接账户后重试。'],
    [403,'permission_denied','当前账户无权为此项目启用设备，请联系项目所有者授权。'],
    [409,'enrollment_conflict','设备注册状态已变化，请重新配置后重试。'],
    [400,'invalid_configuration','设备配置无效，请检查项目、目录和 Agent 后重试。'],
    [503,'server_unavailable','云端服务暂时不可用，请稍后重试。'],
    ['network','network','无法连接云端，请检查网络与服务地址后重试。'],
    ['invalid_json','invalid_response','云端返回了无效的设备信息，请检查服务版本后重试。'],
  ];
  for(const [failure,key,message]of diagnostics){
    enrollmentFailure=failure;
    await ui.page.evaluate(command=>window.pero.sessionCommand(command),enrollment);
    await expect.poll(async()=>(await ui.state()).localExecution.setup.error_key).toBe(`worker.local.error.${key}`);
    const snapshot=await ui.state();
    expect(snapshot.localExecution.setup.error_status).toBe(typeof failure==='number'?failure:null);
    expect(snapshot.localExecution.error_message).toBe(message);
    const publicState=JSON.stringify(snapshot);
    expect(publicState).not.toContain(sensitiveBody);expect(publicState).not.toContain(clientToken);
    expect(publicState).not.toContain(enrollmentAttempts[0].enrollment_secret);
    expect(snapshot.localExecution.setup.enabled).toBe(false);
    expect(snapshot.localExecution.status.status).toBe('stopped');
    if(failure===405){await ui.frame();await ui.page.screenshot({path:resolve(output,'enrollment-405-zh-CN.png')});}
  }
  expect(new Set(enrollmentAttempts.map(attempt=>attempt.device_id)).size).toBe(1);
  expect(new Set(enrollmentAttempts.map(attempt=>attempt.request_id)).size).toBe(1);
  expect(new Set(enrollmentAttempts.map(attempt=>attempt.enrollment_secret)).size).toBe(1);
  enrollmentFailure=null;
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('locale-en').click());
  await expect.poll(async()=>(await ui.state()).locale).toBe('en');
  await ui.page.evaluate(command=>window.pero.sessionCommand(command),enrollment);
  await expect.poll(async()=>(await ui.state()).localExecution.status.status,{timeout:30000}).toBe('idle');
  await expect.poll(()=>enrollments.length).toBe(1);
  expect(enrollments[0]).toMatchObject({projects:['project-fixture'],capabilities:[{project_id:'project-fixture',workspace_key:'research',agent_id:'fixture'}]});
  expect(enrollments[0]).not.toHaveProperty('path');
  expect(enrollments[0].capabilities[0]).not.toHaveProperty('path');
  expect((await ui.state()).localExecution.setup).toMatchObject({onboarding_complete:true,enabled:true});
  await ui.page.screenshot({path:resolve(output,'device-ready.png')});
  queued=true;
  await expect.poll(()=>completed,{timeout:30000}).toBe(1);
  expect(run.status).toBe('succeeded');
  expect(events.some(event=>JSON.stringify(event).includes('Fixture turn 1'))).toBe(true);
  await expect.poll(async()=>(await ui.state()).localExecution.status.status,{timeout:15000}).toBe('idle');
  await ui.page.screenshot({path:resolve(output,'task-complete.png')});
  const snapshot=JSON.stringify(await ui.state());
  expect(snapshot).not.toContain(clientToken);expect(snapshot).not.toContain(workerToken);expect(snapshot).not.toContain(enrollments[0].enrollment_secret);
  const stored=await savedText(temp);
  expect(stored).not.toContain(clientToken);expect(stored).not.toContain(workerToken);expect(stored).not.toContain(enrollments[0].enrollment_secret);
  await close();
  ui=await launch();
  await expect.poll(async()=>(await ui.state()).localExecution.status.status,{timeout:30000}).toBe('idle');
  expect(enrollments).toHaveLength(1);
  expect((await ui.state()).localExecution.setup.enabled).toBe(true);
  // Open Resources from the settings menu and stop without erasing configuration.
  await resources(ui);
  await ui.frame();await ui.page.screenshot({path:resolve(output,'restored-device.png')});
  await ui.page.mouse.click(335,177);
  await expect.poll(async()=>(await ui.state()).localExecution.status.status,{timeout:15000}).toBe('stopped');
  expect((await ui.state()).localExecution.setup.enabled).toBe(false);
  expect((await ui.state()).localExecution.setup.configuration.bindings[0].workspace_key).toBe('research');
  await close();ui=await launch();
  expect((await ui.state()).localExecution.setup.enabled).toBe(false);
  expect((await ui.state()).localExecution.status.status).toBe('stopped');
  expect(enrollments).toHaveLength(1);expect(completed).toBe(1);
  await resources(ui);
  await ui.page.mouse.click(335,177);
  await expect.poll(async()=>(await ui.state()).localExecution.status.status,{timeout:15000}).toBe('idle');
  expect((await ui.state()).localExecution.setup.enabled).toBe(true);
  expect(enrollments).toHaveLength(1);expect(completed).toBe(1);
  await ui.page.evaluate(()=>window.pero.remoteCommand({action:'remote_disconnect'}));
  await expect.poll(async()=>(await ui.state()).localExecution.status.status,{timeout:15000}).toBe('stopped');
  await expect.poll(async()=>(await ui.state()).localExecution.setup.has_connection).toBe(false);
  const claimsBeforeOther=requests.filter(request=>request.path==='/api/worker/v1/claims').length;
  await ui.page.evaluate(({url,token})=>window.pero.remoteCommand({action:'remote_configure',url,mode:'client',token}),{url:base,token:otherClientToken});
  await expect.poll(async()=>(await ui.state()).remote.state.identity?.id).toBe('other-client');
  await expect.poll(async()=>(await ui.state()).localExecution.setup.error_key).toBe('worker.local.error.account_changed');
  expect((await ui.state()).localExecution.status.status).toBe('stopped');
  expect(requests.filter(request=>request.path==='/api/worker/v1/claims')).toHaveLength(claimsBeforeOther);
  await ui.page.screenshot({path:resolve(output,'other-account-blocked.png')});
  await ui.page.evaluate(({url,token})=>window.pero.remoteCommand({action:'remote_configure',url,mode:'client',token}),{url:base,token:clientToken});
  await expect.poll(async()=>(await ui.state()).localExecution.status.status,{timeout:15000}).toBe('idle');
  expect((await ui.state()).localExecution.setup.error).toBe(null);
  await resources(ui);await ui.page.mouse.click(335,177);
  await expect.poll(async()=>(await ui.state()).localExecution.status.status,{timeout:15000}).toBe('stopped');
  expect(enrollments).toHaveLength(1);expect(completed).toBe(1);
  expect(errors).toEqual([]);
  await writeFile(resolve(output,'result.json'),JSON.stringify({checks:['localized-enrollment-errors-404-405-401-403-409-400-503-network-invalid-json','pending-enrollment-recovered-once','first-run-no-auto-login','skip-persisted','enable-later-from-workers','explicit-enable','granted-project-scope','real-worker-acp-turn','encrypted-credentials','restart-restoration','stop-preserves-configuration','resume-without-reenroll','logout-stops-worker','different-account-blocked','original-account-restores','dark-narrow-setup'],enrollments:enrollments.length,completed,events:events.length,state:await ui.state(),errors},null,2));
  console.log(JSON.stringify({checks:'local execution',enrollments:enrollments.length,completed,events:events.length,errors}));
}catch(error){
  if(app){const page=await app.firstWindow();console.error(await page.evaluate(()=>window.peroDiagnostics?.snapshot()).catch(()=>null));await page.screenshot({path:resolve(output,'failure.png')});}
  throw error;
}finally{if(app)await close();await new Promise(done=>server.close(done));}
