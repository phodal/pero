import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {clickNewChat} from './sidebar-controls.mjs';
import {scientificProvider} from '../fixtures/scientific-provider.mjs';

const root=resolve(import.meta.dirname,'../..'), temp=await mkdtemp(join(tmpdir(),'pero-science-'));
const output=resolve(root,process.env.SCIENTIFIC_OUTPUT_DIR||'test-results/scientific-chat'); await mkdir(output,{recursive:true});
const source=process.env.SCIENTIFIC_DATASET ? await readFile(process.env.SCIENTIFIC_DATASET,'utf8') : undefined;
const provider=await scientificProvider(source);
const agents=join(temp,'agents.json'),settings=join(temp,'settings.json');
await writeFile(agents,JSON.stringify([{id:'science-harness',name:'Scientific harness fixture',command:join(root,'target/debug/pero-agent-acp'),args:['--endpoint',provider.endpoint,'--model','fixture','--session-dir',join(temp,'sessions'),'--approval','never'],env:{AGENT_PROVIDER_API_KEY:'loopback-fixture'}}]));
await writeFile(settings,JSON.stringify({chat_agent:'science-harness'}));
const env={...process.env,PERO_DESKTOP_DATA_DIR:join(temp,'profile'),PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:join(temp,'history.jsonl'),PERO_AGENTS_FILE:agents,PERO_LOCALE:'en',PERO_BUILTIN_APPS:'',PERO_REQUIRED_APPS:''};
let app, page;
const errors=[];
const launch=async()=>{
  app=await electron.launch({args:['--use-mock-keychain',join(root,'desktop')],cwd:root,env});
  page=await app.firstWindow(); page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1200,1000));
};
const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
try {
  await launch();
  await clickNewChat(page);
  await expect.poll(async()=>(await state()).chats[0]?.state,{timeout:30000}).toBe('idle');
  const input=(await state()).composerBounds.input;
  await page.mouse.click(input.x+input.width/2,input.y+input.height/2);
  await page.keyboard.insertText('Show the experimental table, chart and scientific equations directly here.'); await page.keyboard.press('Enter');
  await expect.poll(async()=>(await state()).chats[0]?.messages.map(m=>m.text).join(''),{timeout:60000}).toContain('SCIENTIFIC_CHAT_OK');
  const chat=(await state()).chats[0], table=chat.tools.find(t=>t.table)?.table;
  expect(table.rows).toBe(source?JSON.parse(source).length:3);expect(table.total_records).toBe(table.rows);
  if(source) expect(table.source.text).toBe(source);
  else expect(table.source.text).toContain('9007199254740993');
  expect(chat.tools.filter(t=>t.chart)).toHaveLength(1);expect(provider.errors).toEqual([]);
  await page.mouse.move(800,400); await page.mouse.wheel(0,-10000);
  await expect.poll(async()=>(await state()).scroll.y).toBe(0);
  await page.screenshot({path:join(output,'table-light.png'),scale:'css'});
  await page.mouse.wheel(0,600);
  await page.screenshot({path:join(output,'equations-light.png'),scale:'css'});
  if(!source) {
    // Icon-only PDE copy control, inspected in the fixed 1200px fixture viewport.
    await page.mouse.click(1160,405);
    await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toContain(String.raw`\rho\left(`);
  }
  await page.evaluate(()=>window.pero.sessionCommand({method:'settings.workbench',preferences:{...JSON.parse(window.peroDiagnostics.snapshot()).preferences,appearance:'dark'}}));
  await expect.poll(async()=>(await state()).appearance.dark).toBe(true);
  await page.screenshot({path:join(output,'equations-dark.png'),scale:'css'});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(780,950));
  await page.screenshot({path:join(output,'narrow-dark.png'),scale:'css'});
  const requests=provider.calls.length;
  await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy();});await app.close();
  await launch();
  await expect.poll(async()=>(await state()).chats[0]?.tools.find(t=>t.table)?.table.artifact_id,{timeout:30000}).toBe(table.artifact_id);
  expect(provider.calls.length).toBe(requests);expect(errors).toEqual([]);
  await page.mouse.move(800,400);await page.mouse.wheel(0,-10000);
  await expect.poll(async()=>(await state()).scroll.y).toBe(0);
  if(!source){
    const sourceButton=(await state()).tableBounds.find(item=>item.id===table.artifact_id).source;
    await page.mouse.click(sourceButton.x+sourceButton.width/2,sourceButton.y+sourceButton.height/2);
    await expect.poll(async()=>(await state()).documents?.some(doc=>doc.title==='results.json')).toBe(true);
    await page.mouse.click(await page.evaluate(()=>innerWidth-60),54);
    await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe(table.source.text);
    await page.screenshot({path:join(output,'original-records.png'),scale:'css'});
  }
  await writeFile(join(output,'result.json'),JSON.stringify({realHarness:true,realModel:false,requests,table:table.artifact_id,errors},null,2));
  console.log('Scientific conversation: real harness, table, chart, math and restart checked');
}catch(error){if(page){await page.screenshot({path:join(output,'failure.png')});await writeFile(join(output,'failure-state.json'),await page.evaluate(()=>window.peroDiagnostics?.snapshot()||'{}'));}throw error;}
finally{if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy();}).catch(()=>{});await app.close().catch(()=>{});}await new Promise(done=>provider.server.close(done));}
