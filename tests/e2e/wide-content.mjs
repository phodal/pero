// Actual nested Worker projection and horizontal virtualization, including source spans.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root=resolve(process.env.PERO_CONTENT_TEST_ROOT||resolve(import.meta.dirname,'../..'));
const out=resolve(import.meta.dirname,'../../test-results/wide-content');
const temp=await mkdtemp(resolve(tmpdir(),'pero-wide-content-'));
await mkdir(out,{recursive:true});
const nested='['+Array.from({length:4000},(_,i)=>`{"number":900719925474099${String(i).padStart(4,'0')},"label":"中 ${i}"}`).join(',')+']';
const fields=Array.from({length:2000},(_,i)=>`"列_${i}":900719925474099${String(i).padStart(4,'0')}`).join(',');
const source=`[{"data":${nested},${fields}}]`;
const content=resolve(temp,'wide.json');await writeFile(content,source);
await writeFile(resolve(temp,'settings.json'),JSON.stringify({chat_agent:'fixture'}));
await writeFile(resolve(temp,'agents.json'),JSON.stringify([{id:'fixture',name:'Wide fixture',command:process.execPath,
  args:[resolve(root,'tests/fixtures/acp-agent.mjs'),`--content-file=${content}`]}]));
const app=await electron.launch({args:['--use-mock-keychain',resolve(root,'desktop')],cwd:root,
  env:{...process.env,PERO_DESKTOP_DATA_DIR:resolve(temp,'desktop'),PERO_LOCALE:'en',PERO_APPS_ROOT:resolve(temp,'apps'),
    PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'history.jsonl'),PERO_AGENTS_FILE:resolve(temp,'agents.json')}});
let page;
try {
  page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const state=()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()));
  const reader=async()=>(await state()).contentReaders[0];
  const paint=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await page.waitForFunction(()=>window.peroDiagnostics&&JSON.parse(window.peroDiagnostics.snapshot()).connected&&!document.getElementById('loading'),undefined,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1488,1086));
  await expect.poll(async()=>(await state()).agents.some(agent=>agent.id==='fixture')).toBe(true);
  await page.mouse.click(100,28);await expect.poll(async()=>(await state()).composerFocused).toBe(true);
  await page.keyboard.type('contentview');await page.keyboard.press('Enter');
  await expect.poll(async()=>(await state()).chats[0].state,{timeout:15000}).toBe('idle');
  await expect.poll(async()=>(await state()).toolBounds[0]?.bounds?.width).toBeGreaterThan(0);
  const toggle=(await state()).toolBounds[0].bounds;await page.mouse.click(toggle.x+80,toggle.y+12);
  await expect.poll(async()=>(await reader())?.columns).toBe(2001);
  await expect.poll(async()=>(await reader()).table?.renderedColumns.end).toBeGreaterThan(0);
  const initial=(await reader()).table.renderedColumns;
  expect(initial.end-initial.start).toBeLessThan(30);
  const modifier=process.platform==='darwin'?'Meta':'Control';
  let grid=(await reader()).table.gridBounds;
  await page.mouse.click(grid.x+100,grid.y+42);await page.keyboard.press('End');
  await expect.poll(async()=>(await reader()).table.selectedCell).toEqual([0,2001]);
  await expect.poll(async()=>(await reader()).table.renderedColumns.end).toBe(2002);
  const last=(await reader()).table.renderedColumns;expect(last.end-last.start).toBeLessThan(30);
  await page.keyboard.press(`${modifier}+c`);
  await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('9007199254740991999');
  const range=(await reader()).table.sourceRange;
  expect(Buffer.from(source).subarray(range.start,range.end).toString()).toBe('9007199254740991999');
  await page.screenshot({scale:'css',path:resolve(out,'last-column.png')});
  await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await paint();
  await expect.poll(async()=>(await reader()).table.selectedCell).toEqual([0,1]);
  const before=await page.evaluate(()=>window.peroContentAnalysisStats.nodeCompleted);
  await page.keyboard.press('Enter');
  await expect.poll(async()=>(await reader()).rows).toBe(4000);
  await expect.poll(()=>page.evaluate(()=>window.peroContentAnalysisStats.nodeCompleted)).toBe(before+1);
  expect((await reader()).columns).toBe(2);
  grid=(await reader()).table.gridBounds;await page.mouse.click(grid.x+100,grid.y+42);
  await page.keyboard.press(`${modifier}+c`);
  await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('9007199254740990000');
  const nestedRange=(await reader()).table.sourceRange;
  expect(Buffer.from(source).subarray(nestedRange.start,nestedRange.end).toString()).toBe('9007199254740990000');
  await page.keyboard.press('Enter');await expect.poll(async()=>(await reader()).source).toBe(true);
  expect((await reader()).selection).toEqual(nestedRange);
  // Return to nested preview, then root, and reopen: the immutable node is cached.
  let bounds=(await reader()).bounds;await page.mouse.click(bounds.x+35,bounds.y+15);
  await expect.poll(async()=>(await reader()).source).toBe(false);
  bounds=(await reader()).bounds;await page.mouse.click(bounds.x+150,bounds.y+15);
  await expect.poll(async()=>(await reader()).rows).toBe(1);
  grid=(await reader()).table.gridBounds;await page.mouse.click(grid.x+100,grid.y+42);
  await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await expect.poll(async()=>(await reader()).rows).toBe(4000);
  expect(await page.evaluate(()=>window.peroContentAnalysisStats.nodeCompleted)).toBe(before+1);
  expect(errors).toEqual([]);
  await writeFile(resolve(out,'result.json'),JSON.stringify({columns:2001,initial,last,nestedRows:4000,nestedRange,analysis:await page.evaluate(()=>window.peroContentAnalysisStats),errors},null,2));
  console.log('Wide content passed: 2001 virtualized columns, exact end-column and nested source spans, real Worker and cached reopen.');
} catch(error) {
  if(page){await page.screenshot({scale:'css',path:resolve(out,'failure.png')});await writeFile(resolve(out,'failure.json'),await page.evaluate(()=>window.peroDiagnostics.snapshot()));}
  throw error;
} finally {await app.close();}
