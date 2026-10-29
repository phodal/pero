// Project navigation, task scope and Host-owned preferences in actual Electron.
import { expect } from '@playwright/test';
import { electron, focusPage } from './electron.mjs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, appendFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openSettings, setAppearance, setSidebarLocale } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/sidebar');
const temp = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-sidebar-')));
const settings = resolve(temp, 'settings.json');
const history = resolve(temp, 'sessions.jsonl');
const token = randomUUID();
await mkdir(out, {recursive:true});
await writeFile(settings, JSON.stringify({locale:'zh-CN', workbench:{appearance:'light',projects:[]}}));
const tasks = [
  ['task_1','重构 sidebar','pero','draft'],
  ['task_2','优化输入框交互','pero','running'],
  ['task_3','修复远程执行恢复','pero','reconcile'],
  ['task_4','接入 GitHub 来源','pero','succeeded'],
  ['task_5','分析 CICS 导航','point','draft'],
].map(([id,title,project_id,state]) => ({id,title,project_id,state,prompt:'Fixture goal',acceptance:'Fixture checks',agent_id:'fixture',workspace_key:'default'}));
const oldThread='sidebar-history';
const event=(kind,text,data)=>({version:1,kind,request_id:null,text,thread_id:oldThread,...(data?{data}:{})});
await writeFile(history,[event('session_created','',{agent:'fixture',workspace:root}),event('user_message','规划 sidebar 重构'),event('turn_finished','',{stopReason:'end_turn'})].map(value=>JSON.stringify(value)).join('\n')+'\n');
const agents=resolve(temp,'agents.json');
await writeFile(agents,JSON.stringify([{id:'fixture',name:'ACP fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/acp-agent.mjs')]}]));
const requests=[];
const mutations=[];
let holdDetail, holdList, releaseDetail, releaseList, detailWaiting=false, listWaiting=false;
const server=createServer(async(request,response)=>{
  response.setHeader('Content-Type','application/json');
  if(request.headers.authorization!==`Bearer ${token}`){response.writeHead(401);response.end(JSON.stringify({error:'Unauthorized fixture'}));return;}
  const url=new URL(request.url,'http://127.0.0.1');requests.push(url.pathname+url.search);
  if(request.method==='POST')mutations.push(url.pathname);
  const path=url.pathname.replace(/^\/api\/(?:client\/)?v1/,'');
  if(path==='/tasks' && holdList){listWaiting=true;await holdList;}
  if(path==='/tasks/task_1' && holdDetail){detailWaiting=true;await holdDetail;}
  let body;
  if(path==='/me')body={id:'operator',name:'phodal',role:'operator',projects:['pero','point']};
  else if(path==='/workers')body={workers:[]};
  else if(path==='/github/status')body={configured:true,running:false,errors:[],repositories:[{project_id:'pero',owner:'phodal',repo:'pero',auto_dispatch:false,required_label:'pero',partial:false,roadmap_path:'ROADMAP.md'}]};
  else if(path==='/tasks')body=url.searchParams.has('cursor')?{tasks:tasks.slice(2),has_more:false,next_cursor:null}:{tasks:tasks.slice(0,2),has_more:true,next_cursor:'page-two'};
  else if(path.startsWith('/tasks/')){
    const task=tasks.find(task=>task.id===path.split('/')[2]);
    if(!task){response.writeHead(404);body={error:'Missing task'};}
    else body={task,run:null,events:[],events_truncated:false,events_first_seq:null,events_last_seq:null};
  } else {response.writeHead(404);body={error:'Unknown fixture route'};}
  response.end(JSON.stringify(body));
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
let app,page;
const errors=[];
async function launch(){
  const env={...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'profile'),PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:history,PERO_AGENTS_FILE:agents,PERO_LOCALE:'zh-CN',PERO_CLOUD_URL:`http://127.0.0.1:${server.address().port}`,PERO_OPERATOR_TOKEN:token};
  for(const key of ['ELECTRON_RUN_AS_NODE','PERO_CLIENT_TOKEN'])delete env[key];
  app=await electron.launch({args:[...(process.platform==='darwin'?['--use-mock-keychain']:[]),resolve(root,'desktop')],cwd:root,env});
  page=await app.firstWindow();await focusPage(page);page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected,undefined,{timeout:60000});
  await expect.poll(async()=>(await state()).projects?.some(project=>project.shared_id==='pero'&&project.workspace===root)).toBe(true);
  await expect.poll(async()=>(await state()).remote.state.tasks.length).toBeGreaterThanOrEqual(2);
  await frames();
}
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const capture=async(name)=>{await frames();await page.screenshot({path:resolve(out,name+'.png')});};
const clickContent=async(x,y)=>page.mouse.click(x,y+((await state()).contentTabs.length?48:0));
try{
  await launch();
  const inferred = (await state()).projects.filter(project=>project.shared_id==='pero');
  expect(inferred).toHaveLength(1);
  expect(inferred[0].workspace).toBe(root);
  expect((await state()).preferences.projects).toEqual([]);
  expect((await state()).workspaceRepositories).toContainEqual({workspace:root,repository:{host:'github.com',owner:'phodal',name:'pero'}});
  await capture('01-project-tasks');
  await page.mouse.click(100,158);
  await expect.poll(async()=>(await state()).selectedProject).toBe(`workspace:${root}`);
  await expect.poll(async()=>(await state()).remote.state.tasks.length).toBe(tasks.length);
  await capture('02-pero-tasks');
  expect((await state()).activeContent).toEqual({kind:'project',value:`workspace:${root}`});
  await clickContent(425,165);
  await expect.poll(async()=>(await state()).localRoadmap.show_cloud).toBe(true);
  await frames();
  holdDetail=new Promise(resolve=>{releaseDetail=resolve;});
  await clickContent(500,366);
  await expect.poll(()=>detailWaiting).toBe(true);
  // The selected page must remain stable while its HTTP response is pending.
  await frames();
  await expect.poll(async()=>(await state()).remote.state.selected_task_id).toBe('task_1');
  await capture('03-task-loading');
  releaseDetail();holdDetail=undefined;
  await expect.poll(async()=>(await state()).remote.state.loading).toBe(false);
  await capture('03-task-detail');
  expect((await state()).activeContent).toEqual({kind:'task',value:'task_1'});
  await page.mouse.click(await page.evaluate(()=>innerWidth-80),24);
  await expect.poll(async()=>(await state()).chatVisible).toBe(true);
  await capture('03-task-chat');
  await page.mouse.click(await page.evaluate(()=>innerWidth-80),24);
  await expect.poll(async()=>(await state()).chatVisible).toBe(false);
  holdList=new Promise(resolve=>{releaseList=resolve;});
  await clickContent(335,196);
  await expect.poll(()=>listWaiting).toBe(true);
  await frames();
  await expect.poll(async()=>(await state()).remote.state.selected_task_id).toBe(null);
  await capture('03-back-loading');
  releaseList();holdList=undefined;
  await expect.poll(async()=>(await state()).remote.state.loading).toBe(false);
  // A queued task leads to the existing explicit device setup, with its own
  // project/workspace/Agent; browsing setup must not enroll or dispatch.
  tasks[0].state='queued';
  await clickContent(500,366);
  await expect.poll(async()=>(await state()).remote.state.detail?.task?.state).toBe('queued');
  await frames();
  await capture('03-queued-local-execution');
  await clickContent(350,472);
  await expect.poll(async()=>(await state()).navigation).toBe(5);
  expect((await state()).localExecution).toMatchObject({editing:true,project_id:'pero',workspace_key:'default',path:root,agent_id:'fixture',setup:{enabled:false}});
  await capture('03-task-device-setup');
  expect(mutations).toEqual([]);
  await page.mouse.click(100,218);
  await expect.poll(async()=>(await state()).navigation).toBe(3);
  await frames();
  await clickContent(335,196);
  await expect.poll(async()=>(await state()).remote.state.selected_task_id).toBe(null);
  await expect.poll(async()=>(await state()).remote.state.loading).toBe(false);
  await frames();
  await page.mouse.click(100,111);
  await frames();
  await page.keyboard.insertText('point');
  await expect.poll(async()=>(await state()).sidebarSearch).toBe('point');
  await frames();
  await page.mouse.click(100,158);
  await expect.poll(async()=>(await state()).selectedProject).toBe('shared:point');
  await page.mouse.click(100,111);
  await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');await page.keyboard.press('Backspace');
  await expect.poll(async()=>(await state()).selectedProject).toBe('shared:point');
  await clickContent(500,310);
  await expect.poll(async()=>(await state()).remote.state.selected_task_id).toBe('task_5');
  await capture('04-point-task');
  await page.mouse.click(100,158);
  await expect.poll(async()=>(await state()).selectedProject).toBe(`workspace:${root}`);
  await expect.poll(async()=>(await state()).remote.state.selected_task_id).toBe(null);
  await frames();
  await clickContent(530,116);
  await expect.poll(async()=>(await state()).projectTab).toBe('settings');
  await capture('05-project-settings');
  await clickContent(450,254);
  await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');await page.keyboard.press('Backspace');
  await expect.poll(async()=>(await state()).projectBinding).toBe('');
  await frames();
  await page.keyboard.insertText('point');
  await expect.poll(async()=>(await state()).projectBinding).toBe('point');
  expect((await state()).remote.project).toBe('pero');
  await clickContent(320,290);
  await expect.poll(async()=>(await state()).preferences.projects.find(project=>project.workspace===root)?.project_id).toBe('point');
  await expect.poll(async()=>(await state()).preferencesStatus).toBe('saved');
  await clickContent(450,254);
  await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');await page.keyboard.press('Backspace');
  await expect.poll(async()=>(await state()).projectBinding).toBe('');await frames();
  await page.keyboard.insertText('pero');
  await clickContent(320,290);
  await expect.poll(async()=>(await state()).preferences.projects.find(project=>project.workspace===root)?.project_id).toBe('pero');
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
  await expect.poll(async()=>(await state()).projectTab).toBe('tasks');
  await expect.poll(async()=>(await state()).selectedProject).toBe(null);
  // An adapter snapshot is observed data. Only a Workbench action opens content.
  const tabsBeforeObservation=(await state()).contentTabs;
  expect((await state()).activeContent).toBeNull();
  await page.evaluate(()=>window.pero.remoteCommand({action:'remote_select',task_id:'task_5'}));
  await expect.poll(async()=>(await state()).remote.state.selected_task_id).toBe('task_5');
  expect((await state()).activeContent).toBeNull();
  expect((await state()).contentTabs).toEqual(tabsBeforeObservation);
  await capture('05-observed-task-keeps-list');
  await page.mouse.click(100,158);
  await expect.poll(async()=>(await state()).selectedProject).toBe(`workspace:${root}`);
  await page.mouse.click(100,await page.evaluate(()=>innerHeight-116));
  await expect.poll(async()=>(await state()).navigation).toBe(8);
  await capture('05-insights');
  await page.mouse.click(100,158);
  await expect.poll(async()=>(await state()).navigation).toBe(3);
  await openSettings(page);
  await capture('06-settings');
  for(let i=0;i<3;i++)await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await capture('07-appearance-submenu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async()=>(await state()).preferences.appearance).toBe('dark');
  await expect.poll(async()=>(await state()).dark).toBe(true);
  await capture('08-dark');
  await setSidebarLocale(page,'en');
  await expect.poll(async()=>JSON.parse(await readFile(settings,'utf8')).locale).toBe('en');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,760));
  await page.waitForFunction(()=>innerWidth===1000);
  await capture('09-narrow');
  await app.close();app=undefined;
  await launch();
  expect((await state()).dark).toBe(true);
  expect((await state()).locale).toBe('en');
  expect((await state()).chats[0].workspace).toBe(root);
  await setAppearance(page,'system');
  await page.emulateMedia({colorScheme:'light'});
  await expect.poll(async()=>(await state()).dark).toBe(false);
  await page.emulateMedia({colorScheme:'dark'});
  await expect.poll(async()=>(await state()).dark).toBe(true);
  await setAppearance(page,'light');
  await setSidebarLocale(page,'zh-CN');
  await page.mouse.click(100,158);
  await capture('10-final-light');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1586,1024));
  await page.waitForFunction(()=>innerWidth===1586&&innerHeight===992);
  await frames();
  await setAppearance(page,'system');await page.emulateMedia({colorScheme:'light'});
  await expect.poll(async()=>(await state()).dark).toBe(false);
  await openSettings(page);for(let i=0;i<3;i++)await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowRight');
  await capture('design-comparison');
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await setAppearance(page,'light');
  const saved=await readFile(settings,'utf8');
  await writeFile(settings,'invalid');
  await openSettings(page);
  for(let i=0;i<3;i++)await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect.poll(async()=>(await state()).error).toBe('error.preferences');
  expect((await state()).preferences.appearance).toBe('light');
  expect(await readFile(settings,'utf8')).toBe('invalid');
  await capture('11-save-error');
  await writeFile(settings,saved);
  await setAppearance(page,'dark');
  await expect.poll(async()=>(await state()).error).toBe(null);
  await setAppearance(page,'light');
  await openSettings(page);await page.keyboard.press('Escape');
  await page.mouse.click(100,28);
  await expect.poll(async()=>(await state()).navigation).toBe(0);
  await expect.poll(async()=>(await state()).chats.length).toBe(2);
  await capture('12-new-chat');
  expect(requests.some(path=>path.includes('cursor=page-two'))).toBe(true);
  expect(requests.some(path=>path.endsWith('/tasks/task_1'))).toBe(true);
  expect(requests.some(path=>path.endsWith('/tasks/task_5'))).toBe(true);
  // A same-named checkout with a different repository remains a separate Project.
  await app.close();app=undefined;
  const homonym=resolve(temp,'other',basename(root));
  await mkdir(homonym,{recursive:true});
  execFileSync('git',['init','--quiet'],{cwd:homonym});
  execFileSync('git',['config','remote.origin.url','git@github.com:another-owner/pero.git'],{cwd:homonym});
  await appendFile(history,[
    {version:1,kind:'session_created',request_id:null,text:'',thread_id:'other-pero',data:{agent:'fixture',workspace:homonym}},
    {version:1,kind:'user_message',request_id:null,text:'Unrelated same-named checkout',thread_id:'other-pero'},
    {version:1,kind:'turn_finished',request_id:null,text:'',thread_id:'other-pero',data:{stopReason:'end_turn'}},
  ].map(value=>JSON.stringify(value)).join('\n')+'\n');
  await launch();
  expect((await state()).projects.filter(project=>project.name===basename(root))).toHaveLength(2);
  expect((await state()).projects.find(project=>project.workspace===homonym).shared_id).toBe(null);
  await page.evaluate(path=>window.pero.sessionCommand({action:'workspace',path}),homonym);
  await expect.poll(async()=>(await state()).workspaceRepositories?.some(entry=>entry.workspace===homonym&&entry.repository.owner==='another-owner')).toBe(true);
  expect((await state()).projects.find(project=>project.workspace===homonym).shared_id).toBe(null);
  expect((await state()).projects.filter(project=>project.shared_id==='pero')).toHaveLength(1);
  await capture('13-distinct-repository-homonym');
  console.log('Passed: inferred repository grouping without saved bindings, distinct-owner homonym, stable detail/back during held HTTP responses, queued task device setup without enrollment/dispatch, project task scope, Insights, settings keyboard/submenus, language/appearance persistence, system theme, save-error recovery, new chat, light/dark/narrow.');
  await writeFile(resolve(out,'state.json'),JSON.stringify(await state(),null,2));
  expect(errors).toEqual([]);
} catch(error){
  if(page){await capture('failure');console.error('Sidebar state',await state());}
  throw error;
} finally {
  // Release pending fixture replies on an assertion failure as well.
  releaseDetail?.();releaseList?.();holdDetail=undefined;holdList=undefined;
  await app?.close();
  await new Promise(done=>server.close(done));
  if(!process.env.PERO_KEEP_TEST_DATA)await rm(temp,{recursive:true,force:true});
}
