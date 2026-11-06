// Real Host/filesystem + GPUI/Wasm. Seeded history, no model or Agent execution.
import {mkdir,mkdtemp,writeFile,readFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {clickSessionRow,setAppearance} from './sidebar-controls.mjs';

const root=resolve(import.meta.dirname,'../..');
const temp=await mkdtemp(join(tmpdir(),'pero-workspace-files-'));
const output=join(root,'test-results/workspace-files');await mkdir(output,{recursive:true});
const workspace=join(temp,'molecular-report'), other=join(temp,'other-project');
for(const path of [workspace,other,join(workspace,'runs'),join(workspace,'large'),join(workspace,'empty')])await mkdir(path,{recursive:true});
const request='{"format":"smiles","records":["CCO","C[C@H](O)C(=O)O","invalid@@"]}\n';
const result='{"rows":[{"input":"CCO","MolWt":46.069,"exact":9007199254740993}]}\n';
await writeFile(join(workspace,'request.json'),request);
await writeFile(join(workspace,'result.json'),result);
const markdown='[Open result](runs/result.json)\n\n'+Array.from({length:100},(_,i)=>`Paragraph ${i}`).join('\n\n');
await writeFile(join(workspace,'README.md'),markdown);
await writeFile(join(workspace,'runs','result.json'),result);
await writeFile(join(other,'other-only.txt'),'different workspace');
for(let i=0;i<2050;i++)await writeFile(join(workspace,'large',`record-${String(i).padStart(4,'0')}.json`),'{}');
const events=[];
for(const [thread,dir,title] of [['files-a',workspace,'Molecular report'],['files-b',other,'Other project']]) {
  events.push({version:1,kind:'session_created',request_id:null,text:'',thread_id:thread,data:{agent:'offline',workspace:dir}});
  events.push({version:1,kind:'user_message',request_id:null,text:title,thread_id:thread,data:{}});
}
const history=join(temp,'history.jsonl'),settings=join(temp,'settings.json'),agents=join(temp,'agents.json');
await writeFile(history,events.map(e=>JSON.stringify(e)).join('\n')+'\n');await writeFile(agents,'[]');
await writeFile(settings,JSON.stringify({workbench:{layout:{artifact_pane_width:680},appearance:'light'}}));
const env={...process.env,PERO_DESKTOP_DATA_DIR:join(temp,'profile'),PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:history,PERO_AGENTS_FILE:agents,PERO_LOCALE:'en',PERO_BUILTIN_APPS:'',PERO_REQUIRED_APPS:''};
let app,page;const errors=[];
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
const launch=async()=>{
  app=await electron.launch({args:['--use-mock-keychain',join(root,'desktop')],cwd:root,env});page=await app.firstWindow();
  page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1600,1000));
  await page.evaluate(()=>{window.filesEvents=[];window.pero.onEvent(event=>window.filesEvents.push(event));});
};
const click=async(select)=>{
  let bounds;await expect.poll(async()=>{bounds=select(await state());return !!bounds?.width;},{timeout:10000}).toBe(true);
  await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
};
const control=key=>click(s=>s.files?.browser?.bounds[key]);
const row=path=>control(`row:${path}`);
const hostRequest=async request=>{
  await page.evaluate(request=>window.pero.sessionCommand(request),request);
  await expect.poll(()=>page.evaluate(id=>window.filesEvents.some(e=>e.request_id===id),request.request_id)).toBe(true);
  return page.evaluate(id=>window.filesEvents.find(e=>e.request_id===id),request.request_id);
};
const close=async()=>{await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy();});await app.close();app=null;};
try {
  await launch();await clickSessionRow(page,'files-a');
  await click(s=>s.artifacts?.bounds.toggle);await control('files-tab');
  await expect.poll(async()=>(await state()).files?.browser?.rows.filter(r=>r.entry).length).toBe(6);
  await expect.poll(async()=>(await state()).preferences.layout.resource_tab).toBe('files');
  await row('runs');await expect.poll(async()=>(await state()).files.browser.rows.some(r=>r.path==='runs/result.json')).toBe(true);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect.poll(async()=>(await state()).files.browser.reader?.bytes).toBe(Buffer.byteLength(result));
  await control('copy');await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('runs/result.json');
  const before=(await state()).files.browser.reader;
  await control('artifacts-tab');await control('files-tab');
  expect((await state()).files.browser.reader).toEqual(before);
  await page.screenshot({path:join(output,'files-light.png'),scale:'css'});
  await row('README.md');
  await expect.poll(async()=>(await state()).files.browser.reader?.markdown).toBe(true);
  let markdownBounds;
  await expect.poll(async()=>{markdownBounds=(await state()).files.browser.reader?.bounds;return !!markdownBounds?.width;}).toBe(true);
  await page.screenshot({path:join(output,'markdown-link.png'),scale:'css'});
  await page.mouse.move(markdownBounds.x+100,markdownBounds.y+160);await page.mouse.wheel(0,500);
  await expect.poll(async()=>(await state()).files.browser.reader.previewScroll[1]).toBeLessThan(-100);
  const scroll=(await state()).files.browser.reader.previewScroll;
  await writeFile(join(workspace,'README.md'),markdown+'\n\nNew paragraph');await control('preview-refresh');
  await expect.poll(async()=>(await state()).files.browser.reader.bytes).toBe(Buffer.byteLength(markdown+'\n\nNew paragraph'));
  expect((await state()).files.browser.reader.previewScroll).toEqual(scroll);
  await page.mouse.move(markdownBounds.x+100,markdownBounds.y+160);await page.mouse.wheel(0,-5000);
  await expect.poll(async()=>(await state()).files.browser.reader.previewScroll[1]).toBe(0);

  await page.mouse.click(markdownBounds.x+50,markdownBounds.y+82);
  await expect.poll(async()=>(await state()).files.browser.previewPath).toBe('runs/result.json');
  await expect.poll(async()=>(await state()).files.browser.reader?.bytes).toBe(Buffer.byteLength(result));


  const registered=await hostRequest({method:'artifacts',action:'register_file',request_id:'keep-original',thread_id:'files-a',path:'runs/result.json'});
  expect(registered.kind).toBe('artifact_registered');
  const revised='{"rows":[{"input":"CCO","MolWt":0}]}\n';
  await writeFile(join(workspace,'runs/result.json'),revised);await control('preview-refresh');
  await expect.poll(async()=>(await state()).files.browser.reader?.bytes).toBe(Buffer.byteLength(revised));
  const saved=await hostRequest({method:'artifacts',action:'read',request_id:'read-original',thread_id:'files-a',artifact_id:registered.data.artifact.id,version:1});
  expect(saved.text).toBe(result);

  await clickSessionRow(page,'files-b');await click(s=>s.artifacts?.bounds.toggle);
  await expect.poll(async()=>(await state()).files?.browser?.rows.some(r=>r.path==='other-only.txt')).toBe(true);
  expect((await state()).files.browser.rows.some(r=>r.path==='request.json')).toBe(false);
  await clickSessionRow(page,'files-a');
  expect((await state()).files.browser.expanded).toContain('runs');
  expect((await state()).files.browser.previewPath).toBe('runs/result.json');

  // Show the tree in a narrow pane and exercise virtualized End/Home navigation.
  await page.evaluate(()=>{const s=JSON.parse(window.peroDiagnostics.snapshot());return window.pero.sessionCommand({method:'settings.workbench',preferences:{...s.preferences,layout:{...s.preferences.layout,artifact_pane_width:400}}});});
  await control('back');await row('large');
  await expect.poll(async()=>(await state()).files.browser.rows.filter(r=>r.path.startsWith('large/')&&r.entry).length).toBe(2000);
  const painted=Object.entries((await state()).files.browser.bounds).filter(([key,b])=>key.startsWith('row:large/')&&b?.width).length;
  expect(painted).toBeLessThan(80);
  await page.keyboard.press('End');await page.keyboard.press('Home');
  await expect.poll(async()=>(await state()).files.browser.selected).toBe('empty');
  await row('large'); // collapse cached large directory
  await row('request.json');await expect.poll(async()=>(await state()).files.browser.reader?.bytes).toBe(Buffer.byteLength(request));
  await setAppearance(page,'dark');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,900));
  await page.screenshot({path:join(output,'files-narrow-dark.png'),scale:'css'});
  await control('back');
  await rename(join(workspace,'runs'),join(workspace,'runs-unavailable'));
  await control('refresh');
  await expect.poll(async()=>(await state()).files.browser.rows.some(r=>r.path==='runs-unavailable')).toBe(true);
  expect((await state()).files.browser.expanded).not.toContain('runs');
  const bad=await hostRequest({method:'workspace_files',action:'list',request_id:'outside-workspace',thread_id:'files-a',path:'../other-project'});
  expect(bad.kind).toBe('workspace_files_error');
  const wrong=await hostRequest({method:'workspace_files',action:'list',request_id:'unknown-session',thread_id:'unknown',path:'.'});
  expect(wrong.kind).toBe('workspace_files_error');
  await close();await launch();await clickSessionRow(page,'files-a');
  await expect.poll(async()=>(await state()).files.tab).toBe('files');
  await click(s=>s.artifacts?.bounds.toggle);
  await expect.poll(async()=>(await state()).files.browser.rows.some(r=>r.path==='request.json')).toBe(true);
  await rename(workspace,workspace+'-unavailable');await control('refresh');
  await expect.poll(async()=>(await state()).files.browser.rows.some(r=>r.notice.startsWith('Some(WorkspaceUnavailable'))).toBe(true);
  expect((await state()).files.browser.rows.some(r=>r.path==='request.json')).toBe(true);
  expect(await readFile(history,'utf8')).toBe(events.map(e=>JSON.stringify(e)).join('\n')+'\n');
  expect(errors).toEqual([]);
  await writeFile(join(output,'result.json'),JSON.stringify({workspace,history,renderedRowsFor2000Entries:painted,checks:['real Host and filesystem','session isolation','keyboard','relative Markdown link','reload retains scroll','missing workspace retains rows','retained tabs','snapshot preserved','reload','truncation','narrow dark','restart preference'],errors},null,2));
  console.log('Workspace Files: real Host, lazy tree, preview, keyboard, isolation, immutable artifact and restart passed');
} catch(error) {
  if(page){await page.screenshot({path:join(output,'failure.png')});await writeFile(join(output,'failure.json'),JSON.stringify(await state(),null,2));}
  throw error;
} finally {if(app)await close();}
