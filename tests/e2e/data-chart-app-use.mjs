// Import a dataset, then invoke and trace a chart through the real ACP/MCP path.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {clickAppShortcut} from './sidebar-controls.mjs';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';

const root=resolve(import.meta.dirname,'../..');
const distribution=resolve(process.env.PERO_CONTENT_TEST_ROOT||root);
const output=join(root,'test-results/data-chart-app-use');
await mkdir(output,{recursive:true});
const temp=await mkdtemp(join(tmpdir(),'pero-chart-app-use-'));
const fixture=join(temp,'observations.json');
const rows=[{period:'January',value:12},{period:'February',value:17}];
const source=JSON.stringify(rows,null,2);await writeFile(fixture,source);
const agents=join(temp,'agents.json');await writeFile(agents,JSON.stringify([{id:'codex',name:'Chart transport fixture',command:process.execPath,args:[join(root,'tests/fixtures/data-chart-acp.mjs')]}]));
const settings=join(temp,'settings.json');await writeFile(settings,JSON.stringify({chat_agent:'codex'}));
const env={...process.env,PERO_DESKTOP_DATA_DIR:join(temp,'profile'),PERO_SETTINGS_PATH:settings,PERO_HISTORY_PATH:join(temp,'history.jsonl'),PERO_AGENTS_FILE:agents,PERO_LOCALE:'en'};
const app=await electron.launch({args:['--use-mock-keychain',join(distribution,'desktop')],cwd:distribution,env});
let page;const errors=[],logs=[];app.process().stderr?.on('data',data=>logs.push(String(data)));
try {
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
  await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
  await expect.poll(async()=>(await state()).apps?.some(value=>value.name==='data')).toBe(true);
  await clickAppShortcut(page,'data');
  await expect.poll(async()=>(await state()).appsLoading).toBe(false);
  const frame=page.frameLocator('iframe[title="data"]');
  await expect(frame.getByRole('button',{name:'Add data',exact:true})).toBeVisible({timeout:30000});
  await frame.getByRole('button',{name:'Add data',exact:true}).click();
  await frame.getByRole('dialog').locator('input[type=file]').setInputFiles(fixture);
  await frame.getByRole('dialog').getByRole('button',{name:'Import',exact:true}).click();
  await expect(frame.locator('.data-grid tbody tr')).toHaveCount(2);
  await frame.getByRole('button',{name:'Ask Agent',exact:true}).click();
  await expect.poll(async()=>(await state()).attachments?.length).toBe(1);
  // Dock the floating composer so App Use can operate the unobscured panel.
  await expect.poll(async()=>(await state()).floatingChat).toBe(true);
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  await page.mouse.click(viewport.width-51,viewport.height-((await state()).floatingChatExpanded?561:133));
  await expect.poll(async()=>(await state()).floatingChat).toBe(false);
  const edge=await page.locator('#pero-app-surface').evaluate(element=>element.getBoundingClientRect().right);
  await page.mouse.click(edge+120,await page.evaluate(()=>innerHeight-70));await page.keyboard.press('Enter');
  const active=async()=>{const value=await state();return value.chats[value.activeChat];};
  await expect.poll(async()=>(await active()).messages.filter(value=>value.role==='assistant').at(-1)?.text||'',{timeout:30000}).toContain('DATA_CHART_RESULT:');
  const resultText=(await active()).messages.filter(value=>value.role==='assistant').at(-1).text;
  const result=JSON.parse(resultText.slice(resultText.indexOf('DATA_CHART_RESULT:')+'DATA_CHART_RESULT:'.length));
  expect(result.error).toBeUndefined();expect(result.realModel).toBe(false);
  expect(result.chart.dataset).toBe(result.source.dataset);expect(result.chart.records).toBe(2);
  await expect.poll(async()=>(await state()).documents?.some(value=>value.item.value.origin?.app==='data'&&value.reader.source)).toBe(true);
  const opened=(await state()).documents.find(value=>value.item.value.origin?.app==='data');
  expect(opened.reader.editable).toBe(false);
  const start=Buffer.byteLength(source.slice(0,source.indexOf('{')));
  const end=Buffer.byteLength(source.slice(0,source.indexOf('}')+1));
  await expect.poll(async()=>(await state()).documents.find(value=>value.item.value.origin?.app==='data').reader.selection).toEqual({start,end});
  expect(errors).toEqual([]);
  await writeFile(join(output,'result.json'),JSON.stringify({fixture:true,realModel:false,result,errors,logs},null,2));
  console.log('ACP/MCP chart creation, dataset identity and source opening passed.');
} catch(error) {
  await writeFile(join(output,'failure-log.json'),JSON.stringify({errors,logs},null,2));
  if(page){await page.screenshot({path:join(output,'failure.png'),scale:'css'});await writeFile(join(output,'failure-state.json'),await page.evaluate(()=>window.peroDiagnostics?.snapshot()||'{}'));}
  throw error;
} finally {await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();}).catch(()=>{});await app.close();}
