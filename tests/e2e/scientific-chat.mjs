import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {clickNewChat} from './sidebar-controls.mjs';
import {createHash} from 'node:crypto';
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
  await expect.poll(async()=>{const s=await state(); return s.chats[0]?.state==='idle' && s.composerBounds.input?.width>0;},{timeout:30000}).toBe(true);
  const input=(await state()).composerBounds.input;
  await page.mouse.click(input.x+input.width/2,input.y+input.height/2);
  await page.keyboard.insertText('Show the experimental table, chart and scientific equations directly here.'); await page.keyboard.press('Enter');
  await expect.poll(async()=>(await state()).chats[0]?.messages.map(m=>m.text).join(''),{timeout:60000}).toContain('SCIENTIFIC_CHAT_OK');
  const chat=(await state()).chats[0], table=chat.tools.find(t=>t.table)?.table;
  expect(table.rows).toBe(source?JSON.parse(source).length:3);expect(table.total_records).toBe(table.rows);
  expect(table.method).toBe('declared sample mean; not a statistical test');
  expect(table.value_origin).toBe('calculated');
  if(source) expect(table.source.text).toBe(source);
  else expect(table.source.text).toContain('9007199254740993');
  const chart=chat.tools.find(t=>t.chart)?.chart;
  expect(chart.document.source.method).toBe('declared line of the supplied values');
  expect(chart.document.source.caveats.join('\n')).toContain('not a scientific check');
  expect(chat.tools.filter(t=>t.chart)).toHaveLength(1);expect(provider.errors).toEqual([]);
  await page.mouse.move(800,400); await page.mouse.wheel(0,-10000);
  await expect.poll(async()=>(await state()).scroll.y).toBe(0);
  await page.screenshot({path:join(output,'table-light.png'),scale:'css'});
  const cite=async()=>(await state()).tableBounds.find(item=>item.id===table.artifact_id)?.cite;
  await expect.poll(async()=>{const box=await cite(); return Boolean(box&&box.width>0);},{timeout:15000}).toBe(true);
  let citeBox=await cite();
  for(let step=0;step<12&&(citeBox.y<80||citeBox.y>860);step++){
    await page.mouse.move(800,400); await page.mouse.wheel(0,citeBox.y>860?360:-360); citeBox=await cite();
  }
  await page.mouse.click(citeBox.x+citeBox.width/2,citeBox.y+citeBox.height/2);
  await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe(`table:${table.artifact_id}`);
  await page.mouse.wheel(0,600);
  await page.screenshot({path:join(output,'equations-light.png'),scale:'css'});
  if(!source) {
    // Icon-only PDE copy control. The table and chart above it move this
    // control down in the fixed 1200px viewport; the point is the icon
    // measured in equations-light.png for that layout.
    await page.mouse.click(1152,507);
    await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toContain(String.raw`\rho\left(`);
    const bibtex='@article{sample, title={Declared source}, doi={10.1000/scientific-chat.1}}';
    const bibtexToken=`bibtex:${createHash('sha256').update(bibtex).digest('hex')}`;
    const paper=`pero-app-location://paper-agent/main/report/${'c'.repeat(64)}/citation/0`;
    const literature=async()=>(await state()).literature??[];
    await expect.poll(async()=>(await literature()).map(item=>item.token).sort()).toEqual(['doi:10.1000/scientific-chat.1', bibtexToken, paper].sort());
    const doi=(await literature()).find(item=>item.token.startsWith('doi:'));
    const savedPaper=(await literature()).find(item=>item.paper);
    const savedBibtex=(await literature()).find(item=>item.token.startsWith('bibtex:'));
    expect(doi.open).toBe('https://doi.org/10.1000/scientific-chat.1');
    expect(savedPaper.open).toBe(paper);
    expect(savedPaper.paper).toBe(true);
    expect(savedBibtex.open).toBe(doi.open);
    const clickBound=async(read)=>{
      await expect.poll(async()=>{const box=await read(); return Boolean(box&&box.width>0);},{timeout:15000}).toBe(true);
      let box=await read();
      for(let step=0;step<16&&(box.y<80||box.y>860);step++){
        await page.mouse.move(800,400); await page.mouse.wheel(0,box.y>860?400:-400); box=await read();
      }
      await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    };
    await clickBound(async()=>(await literature()).find(item=>item.token===doi.token)?.copy);
    await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe(doi.token);
    await clickBound(async()=>(await literature()).find(item=>item.token===paper)?.openBounds);
    expect(errors).toEqual([]);
    await page.screenshot({path:join(output,'literature-light.png'),scale:'css'});
    await page.mouse.move(800,400); await page.mouse.wheel(0,-4000);
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
    const bibtex='@article{sample, title={Declared source}, doi={10.1000/scientific-chat.1}}';
    const paper=`pero-app-location://paper-agent/main/report/${'c'.repeat(64)}/citation/0`;
    expect((await state()).literature.map(item=>item.token).sort()).toEqual(['doi:10.1000/scientific-chat.1', `bibtex:${createHash('sha256').update(bibtex).digest('hex')}`, paper].sort());
    const sourceButton=(await state()).tableBounds.find(item=>item.id===table.artifact_id).source;
    await page.mouse.click(sourceButton.x+sourceButton.width/2,sourceButton.y+sourceButton.height/2);
    await expect.poll(async()=>(await state()).documents?.some(doc=>doc.title==='results.json')).toBe(true);
    const copy=async()=>(await state()).documents.find(doc=>doc.title==='results.json')?.reader?.copy;
    await expect.poll(async()=>{const box=await copy(); return Boolean(box&&box.width>0);},{timeout:15000}).toBe(true);
    const copyBox=await copy();
    await page.mouse.click(copyBox.x+copyBox.width/2,copyBox.y+copyBox.height/2);
    await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe(table.source.text);
    await page.screenshot({path:join(output,'original-records.png'),scale:'css'});
  }
  const tableTool=chat.tools.find(t=>t.table), chartTool=chat.tools.find(t=>t.chart);
  await writeFile(join(output,'table-receipt.json'), tableTool.content);
  await writeFile(join(output,'chart-receipt.json'), chartTool.content);
  await writeFile(join(output,'result.json'),JSON.stringify({realHarness:true,realModel:false,requests,table:table.artifact_id,chart:chart.artifact_id,tableMethod:table.method,valueOrigin:table.value_origin,chartMethod:chart.document.source.method,errors},null,2));
  console.log('Scientific conversation: real harness, table, chart, math and restart checked');
}catch(error){if(page){await page.screenshot({path:join(output,'failure.png')});await writeFile(join(output,'failure-state.json'),await page.evaluate(()=>window.peroDiagnostics?.snapshot()||'{}'));}throw error;}
finally{if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy();}).catch(()=>{});await app.close().catch(()=>{});}await new Promise(done=>provider.server.close(done));}
